function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "openrouter", missing: name };
    throw err;
  }
  return v;
}

function normalizeApiKey(raw) {
  const k = String(raw || "").trim();
  if (!k) return k;
  return k.replace(/^Bearer\s+/i, "").trim();
}

function normalizeBaseUrl(raw) {
  const b = String(raw || "").trim().replace(/\/$/, "");
  if (!b) return "https://openrouter.ai/api/v1";
  if (/\/api\/v\d+(?:beta)?$/.test(b) || /\/v\d+(?:beta)?$/.test(b)) return b;
  return `${b}/api/v1`;
}

function isNemotronSuperModel(remoteModel) {
  const id = String(remoteModel || "").trim().toLowerCase();
  return id.includes("nemotron-3-super-120b-a12b");
}

function isMiniMaxModel(remoteModel) {
  const id = String(remoteModel || "").trim().toLowerCase();
  return id.startsWith("minimax/");
}

function buildHeaders({ apiKey }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
  };

  const referer = String(process.env.OPENROUTER_HTTP_REFERER || process.env.APP_URL || "").trim();
  const title = String(process.env.OPENROUTER_TITLE || "Core AI").trim();

  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;

  return headers;
}

function sseParseLines(buffer) {
  const normalized = String(buffer || "").replace(/\r/g, "");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() || "";
  return { frames: parts, rest };
}

function extractTextFromValue(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";

  const out = [];
  for (const item of value) {
    if (typeof item === "string") {
      if (item) out.push(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const type = String(item.type || "").trim().toLowerCase();
    const text =
      typeof item.text === "string"
        ? item.text
        : typeof item.content === "string"
          ? item.content
          : "";
    if (!text) continue;
    if (!type || type === "text" || type === "output_text" || type === "input_text") out.push(text);
  }

  return out.join("");
}

function extractDeltaText(json) {
  const choice = json?.choices?.[0] || null;
  if (!choice || typeof choice !== "object") return "";

  const deltaText = extractTextFromValue(choice?.delta?.content);
  if (deltaText) return deltaText;

  const messageText = extractTextFromValue(choice?.message?.content);
  if (messageText) return messageText;

  return "";
}

function buildProviderError({ status, text }) {
  let code = "PROVIDER_ERROR";
  let message = "";
  try {
    const j = JSON.parse(text || "{}");
    const maybeCode = j?.error?.code;
    if (typeof maybeCode === "string" && maybeCode) code = maybeCode;
    else if (typeof j?.error?.type === "string" && j.error.type) code = j.error.type;
    message = j?.error?.message || "";
  } catch {
    // ignore
  }

  const err = new Error(code || "PROVIDER_ERROR");
  err.status = status || 500;
  err.details = {
    provider: "openrouter",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };

  if (process.env.DEBUG_AI === "1") {
    console.error("[openrouter] error", {
      status: err.status,
      code: err.details.code,
      message: err.details.message,
      body: err.details.body,
    });
  }

  return err;
}

function modelVariants(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return [];
  const out = [id];
  return out;
}

function isModelishError(err) {
  if (!err) return false;
  const status = Number(err.status || 0);
  const code = String(err.details?.code || err.message || "").toLowerCase();
  const msg = String(err.details?.message || err.details?.body || "").toLowerCase();
  if (status === 404) return true;
  if (status === 400 && msg.includes("model")) return true;
  if (code.includes("model")) return true;
  return false;
}

async function streamOnce({ baseUrl, apiKey, remoteModel, messages, onDelta, signal }) {
  const doRequest = async ({ includeUsage, includeReasoning } = {}) => {
    const body = {
      model: remoteModel,
      messages,
      stream: true,
    };
    if (includeUsage) body.stream_options = { include_usage: true };
    if (includeReasoning && (isNemotronSuperModel(remoteModel) || isMiniMaxModel(remoteModel))) {
      body.reasoning = { effort: "none", exclude: true };
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: buildHeaders({ apiKey }),
      body: JSON.stringify(body),
      signal,
    });
  };

  const parseUnsupportedParam = (text) => {
    try {
      const j = JSON.parse(text || "{}");
      const p = String(j?.error?.param || "").trim();
      return p || null;
    } catch {
      return null;
    }
  };

  let resp = await doRequest({ includeUsage: true, includeReasoning: true });
  if (!resp.ok && resp.status === 400) {
    const text = await resp.text().catch(() => "");
    const lower = text.toLowerCase();
    const param = parseUnsupportedParam(text);

    const mentionsStreamOptions = lower.includes("stream_options") || param === "stream_options";
    const mentionsReasoning =
      lower.includes("reasoning") ||
      lower.includes("effort") ||
      lower.includes("exclude") ||
      param === "reasoning" ||
      param === "effort";

    const retryPlan = [];
    if (mentionsStreamOptions && mentionsReasoning) {
      retryPlan.push({ includeUsage: false, includeReasoning: false });
    }
    if (mentionsStreamOptions) retryPlan.push({ includeUsage: false, includeReasoning: true });
    if (mentionsReasoning) retryPlan.push({ includeUsage: true, includeReasoning: false });
    retryPlan.push({ includeUsage: false, includeReasoning: false });

    let recovered = false;
    for (const attempt of retryPlan) {
      resp = await doRequest(attempt);
      if (resp.ok) {
        recovered = true;
        break;
      }
      if (resp.status !== 400) break;
    }

    if (!recovered && !resp.ok) {
      throw buildProviderError({ status: 400, text });
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let acc = "";
  let fullText = "";
  let usage = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    acc += decoder.decode(value, { stream: true });
    const { frames, rest } = sseParseLines(acc);
    acc = rest;

    for (const frame of frames) {
      const lines = frame.split("\n").map((l) => l.trim());
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") return { text: fullText, usage };

        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }

        if (json.usage) usage = json.usage;

        const delta = extractDeltaText(json);
        if (typeof delta === "string" && delta.length > 0) {
          fullText += delta;
          if (typeof onDelta === "function") onDelta(delta);
        }
      }
    }
  }

  return { text: fullText, usage, usedTransport: "stream" };
}

async function streamChat({ remoteModel, messages, onDelta, signal }) {
  const apiKey = normalizeApiKey(requireEnv("OPENROUTER_API_KEY"));
  const baseUrl = normalizeBaseUrl(process.env.OPENROUTER_BASE_URL);

  if (process.env.DEBUG_AI === "1") {
    console.error("[openrouter] request", {
      remoteModel,
      baseUrl,
      keyLen: apiKey.length,
      keyLast4: apiKey.slice(-4),
    });
  }

  const ids = modelVariants(remoteModel);
  let lastErr = null;
  for (const modelId of ids) {
    try {
      const out = await streamOnce({
        baseUrl,
        apiKey,
        remoteModel: modelId,
        messages,
        onDelta,
        signal,
      });
      if (process.env.DEBUG_AI === "1" && modelId !== remoteModel) {
        console.error("[openrouter] model fallback", { from: remoteModel, to: modelId });
      }
      return out;
    } catch (e) {
      lastErr = e;
      if (isModelishError(e)) continue;
      throw e;
    }
  }

  throw lastErr || new Error("PROVIDER_ERROR");
}

module.exports = { streamChat };
