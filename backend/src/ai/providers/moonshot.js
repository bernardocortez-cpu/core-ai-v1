function requireAnyEnv(names) {
  for (const name of names) {
    const v = process.env[name];
    if (v) return { name, value: v };
  }
  const err = new Error("PROVIDER_NOT_CONFIGURED");
  err.status = 501;
  err.details = { provider: "moonshot", missingAnyOf: names };
  throw err;
}

function normalizeApiKey(raw) {
  const k = String(raw || "").trim();
  if (!k) return k;
  // Users sometimes paste "Bearer <key>" into .env
  return k.replace(/^Bearer\s+/i, "").trim();
}

function sseParseLines(buffer) {
  // OpenAI-compatible streaming uses SSE frames separated by \n\n (or \r\n\r\n).
  const normalized = String(buffer || "").replace(/\r/g, "");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() || "";
  return { frames: parts, rest };
}

let MOONSHOT_SUPPORTS_PROMPT_CACHING = null;

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
    provider: "moonshot",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };

  if (process.env.DEBUG_AI === "1") {
    console.error("[moonshot] error", {
      status: err.status,
      code: err.details.code,
      message: err.details.message,
      body: err.details.body,
    });
  }
  return err;
}

function normalizeBaseUrl(raw) {
  const b = String(raw || "").trim().replace(/\/$/, "");
  // Default to the official Moonshot API host; override if needed.
  if (!b) return "https://api.moonshot.cn/v1";
  // Allow setting MOONSHOT_BASE_URL="https://api.moonshot.ai" (without /v1)
  if (/\/v\d+(?:beta)?$/.test(b)) return b;
  return `${b}/v1`;
}

function modelVariants(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return [];
  const out = [id];
  const add = (x) => {
    const v = String(x || "").trim();
    if (v && !out.includes(v)) out.push(v);
  };

  // The K2.5 model naming can be previewed/dated. Keep a few common variants.
  if (id === "kimi-k2-5" || id === "kimi-k2.5" || id.startsWith("kimi-k2")) {
    add("kimi-k2.5");
    add("kimi-k2.5-preview");
    add("kimi-k2-5");
    add("kimi-k2");
  }

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
  const cachingEnabled = String(process.env.MOONSHOT_PROMPT_CACHING || "1") !== "0";
  const promptCacheRetention = String(process.env.MOONSHOT_PROMPT_CACHE_RETENTION || "").trim();
  const promptCacheKey =
    String(process.env.MOONSHOT_PROMPT_CACHE_KEY || "").trim() ||
    `coreai:v1:moonshot:${String(remoteModel || "").trim() || "unknown"}`;

  let supportsPromptCaching = MOONSHOT_SUPPORTS_PROMPT_CACHING !== false;

  const parseUnsupportedParam = (text) => {
    try {
      const j = JSON.parse(text || "{}");
      const p = String(j?.error?.param || "").trim();
      return p || null;
    } catch {
      return null;
    }
  };

  const doRequest = async ({ includeUsage, includeCaching } = {}) => {
    const body = {
      model: remoteModel,
      messages,
      stream: true,
    };
    if (includeUsage) body.stream_options = { include_usage: true };
    if (includeCaching && cachingEnabled && supportsPromptCaching) {
      body.prompt_cache_key = promptCacheKey;
      if (promptCacheRetention) body.prompt_cache_retention = promptCacheRetention;
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
  };

  let resp = await doRequest({ includeUsage: true, includeCaching: true });
  if (!resp.ok && resp.status === 400) {
    const text = await resp.text().catch(() => "");
    const lower = text.toLowerCase();
    const param = parseUnsupportedParam(text);

    const mentionsStreamOptions = lower.includes("stream_options") || param === "stream_options";
    const mentionsCaching =
      lower.includes("prompt_cache") ||
      lower.includes("prompt cache") ||
      lower.includes("cache_retention") ||
      lower.includes("cache_key") ||
      (param && param.startsWith("prompt_cache_"));

    if (mentionsCaching) {
      supportsPromptCaching = false;
      MOONSHOT_SUPPORTS_PROMPT_CACHING = false;
    }

    const retryPlan = [];
    if (mentionsStreamOptions && mentionsCaching) retryPlan.push({ includeUsage: false, includeCaching: false });
    if (mentionsStreamOptions) retryPlan.push({ includeUsage: false, includeCaching: true });
    if (mentionsCaching) retryPlan.push({ includeUsage: true, includeCaching: false });
    retryPlan.push({ includeUsage: false, includeCaching: false });

    for (const attempt of retryPlan) {
      resp = await doRequest(attempt);
      if (resp.ok) break;
      if (resp.status !== 400) break;
    }

    if (!resp.ok && resp.status === 400) {
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

        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          fullText += delta;
          if (typeof onDelta === "function") onDelta(delta);
        }
      }
    }
  }

  return { text: fullText, usage };
}

async function streamChat({ remoteModel, messages, onDelta, signal }) {
  const { name: keyName, value: rawKey } = requireAnyEnv(["MOONSHOT_API_KEY", "KIMI_API_KEY"]);
  const apiKey = normalizeApiKey(rawKey);
  const baseUrl = normalizeBaseUrl(process.env.MOONSHOT_BASE_URL || process.env.KIMI_BASE_URL);

  if (process.env.DEBUG_AI === "1") {
    console.error("[moonshot] request", {
      remoteModel,
      baseUrl,
      keyName,
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
        console.error("[moonshot] model fallback", { from: remoteModel, to: modelId });
      }
      return out;
    } catch (e) {
      lastErr = e;
      if (isModelishError(e)) continue;
      throw e;
    }
  }

  throw lastErr;
}

module.exports = { streamChat };
