function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "deepseek", missing: name };
    throw err;
  }
  return v;
}

function sseParseLines(buffer) {
  // OpenAI-compatible streaming uses SSE frames separated by \n\n (or \r\n\r\n).
  const normalized = String(buffer || "").replace(/\r/g, "");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() || "";
  return { frames: parts, rest };
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
    provider: "deepseek",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };

  if (process.env.DEBUG_AI === "1") {
    console.error("[deepseek] error", {
      status: err.status,
      code: err.details.code,
      message: err.details.message,
      body: err.details.body,
    });
  }
  return err;
}

function extractNonStreamText(json) {
  const text = json?.choices?.[0]?.message?.content;
  return typeof text === "string" ? text : "";
}

async function nonStreamChat({ baseUrl, apiKey, remoteModel, messages, signal }) {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model: remoteModel,
      messages,
      stream: false,
    }),
    signal,
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) throw buildProviderError({ status: resp.status, text });

  let json;
  try {
    json = JSON.parse(text || "{}");
  } catch {
    throw buildProviderError({ status: 502, text });
  }

  return {
    text: extractNonStreamText(json),
    usage: json?.usage || null,
    finishReason: json?.choices?.[0]?.finish_reason || null,
    meta: json,
  };
}

function modelVariants(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return [];
  const out = [id];
  const add = (x) => {
    const v = String(x || "").trim();
    if (v && !out.includes(v)) out.push(v);
  };

  // Common DeepSeek ids (official).
  if (id === "deepseek-chat" || id === "deepseek-reasoner" || id.startsWith("deepseek-")) {
    add("deepseek-chat");
    add("deepseek-reasoner");
  }

  // Legacy / UI-friendly ids that might accidentally reach the adapter.
  if (id === "deepseek-v3.2" || id === "deepseek-v3" || id === "deepseek-v3.1") add("deepseek-chat");
  if (id === "deepseek-r1") add("deepseek-reasoner");

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
  // Prefer include_usage, but retry without it on 400.
  const doRequest = async ({ includeUsage } = {}) => {
    const body = {
      model: remoteModel,
      messages,
      stream: true,
    };
    if (includeUsage) body.stream_options = { include_usage: true };

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

  let resp = await doRequest({ includeUsage: true });
  if (!resp.ok && resp.status === 400) {
    const text = await resp.text().catch(() => "");
    if (text.toLowerCase().includes("stream_options") || text.toLowerCase().includes("unknown parameter")) {
      resp = await doRequest({ includeUsage: false });
    } else {
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
  let sawReasoning = false;
  let sawContent = false;
  let finishReason = null;

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
        if (data === "[DONE]") return { text: fullText, usage, sawReasoning, sawContent, finishReason };

        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }

        if (json.usage) usage = json.usage;

        const fr = json?.choices?.[0]?.finish_reason;
        if (typeof fr === "string" && fr) finishReason = fr;

        const delta = json?.choices?.[0]?.delta || null;
        const content = delta && typeof delta.content === "string" ? delta.content : "";
        const reasoning = delta && typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";

        if (reasoning) sawReasoning = true;
        if (content) {
          sawContent = true;
          fullText += content;
          if (typeof onDelta === "function") onDelta(content);
        }
      }
    }
  }

  return { text: fullText, usage, sawReasoning, sawContent, finishReason };
}

async function streamChat({ remoteModel, messages, onDelta, signal }) {
  const apiKey = requireEnv("DEEPSEEK_API_KEY");
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");

  if (process.env.DEBUG_AI === "1") {
    console.error("[deepseek] request", {
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

      // Some DeepSeek reasoning models may stream only `reasoning_content` and send the final answer at the end.
      // If we ended up with an empty visible answer, fall back to a single non-stream request to get the final content.
      if (!String(out?.text || "").trim()) {
        if (out?.sawReasoning && process.env.DEBUG_AI === "1") {
          console.error("[deepseek] stream had reasoning but no content; falling back to non-stream", { modelId });
        }
        const ns = await nonStreamChat({ baseUrl, apiKey, remoteModel: modelId, messages, signal });
        const text = String(ns?.text || "");
        if (typeof onDelta === "function" && text) onDelta(text);
        return { text, usage: ns?.usage || out?.usage || null, finishReason: ns?.finishReason || out?.finishReason || null };
      }

      if (process.env.DEBUG_AI === "1" && modelId !== remoteModel) {
        console.error("[deepseek] model fallback", { from: remoteModel, to: modelId });
      }

      return { text: out.text, usage: out.usage || null, finishReason: out.finishReason || null };
    } catch (e) {
      lastErr = e;
      if (isModelishError(e)) continue;
      throw e;
    }
  }

  throw lastErr;
}

module.exports = { streamChat };

