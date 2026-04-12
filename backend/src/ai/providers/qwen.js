function requireAnyEnv(names) {
  for (const name of names) {
    const v = process.env[name];
    if (v) return { name, value: v };
  }
  const err = new Error("PROVIDER_NOT_CONFIGURED");
  err.status = 501;
  err.details = { provider: "qwen", missingAnyOf: names };
  throw err;
}

function normalizeApiKey(raw) {
  const k = String(raw || "").trim();
  if (!k) return k;
  return k.replace(/^Bearer\s+/i, "").trim();
}

function normalizeBaseUrl(raw) {
  const b = String(raw || "").trim().replace(/\/$/, "");
  // Default to DashScope OpenAI-compatible endpoint base (international).
  // Users can override with:
  // - https://dashscope.aliyuncs.com/compatible-mode/v1   (CN)
  // - https://dashscope-us.aliyuncs.com/compatible-mode/v1 (US)
  // - https://dashscope-intl.aliyuncs.com/compatible-mode/v1 (INTL)
  if (!b) return "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
  return b;
}

function buildUrl(baseUrl) {
  // Accept full endpoint or base.
  if (baseUrl.endsWith("/chat/completions")) return baseUrl;
  return `${baseUrl}/chat/completions`;
}

function sseParseLines(buffer) {
  const normalized = String(buffer || "").replace(/\r/g, "");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() || "";
  return { frames: parts, rest };
}

let QWEN_SUPPORTS_PROMPT_CACHING = null;

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
    provider: "qwen",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };

  if (process.env.DEBUG_AI === "1") {
    console.error("[qwen] error", {
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
  const add = (x) => {
    const v = String(x || "").trim();
    if (v && !out.includes(v)) out.push(v);
  };

  // Common Qwen naming variants across DashScope accounts/regions.
  if (id === "qwen3.5-flash" || id === "qwen3 5 flash" || id === "qwen3.5 flash") {
    add("qwen3.5-flash");
    add("qwen-flash");
    add("qwen-flash-latest");
    add("qwen-turbo");
  }
  if (id === "qwen3.5-plus" || id === "qwen3 5 plus" || id === "qwen3.5 plus") {
    add("qwen3.5-plus");
    add("qwen-plus");
    add("qwen-plus-latest");
  }
  if (id === "qwen3-max" || id === "qwen3 max") {
    add("qwen3-max");
    add("qwen-max");
    add("qwen-max-latest");
    add("qwen-plus");
  }
  if (id === "qwen-max" || id === "qwen-max-latest") {
    add("qwen-max");
    add("qwen3-max");
    add("qwen-max-latest");
    add("qwen-plus");
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

async function streamOnce({ url, apiKey, remoteModel, messages, onDelta, signal }) {
  const cachingEnabled = String(process.env.QWEN_PROMPT_CACHING || "1") !== "0";
  const promptCacheRetention = String(process.env.QWEN_PROMPT_CACHE_RETENTION || "").trim();
  const promptCacheKey =
    String(process.env.QWEN_PROMPT_CACHE_KEY || "").trim() ||
    `coreai:v1:qwen:${String(remoteModel || "").trim() || "unknown"}`;

  let supportsPromptCaching = QWEN_SUPPORTS_PROMPT_CACHING !== false;

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

    // Optional knobs (only if set) — avoids breaking providers that don't support them.
    if (process.env.QWEN_ENABLE_THINKING === "0") body.enable_thinking = false;
    if (process.env.QWEN_ENABLE_THINKING === "1") body.enable_thinking = true;

    return fetch(url, {
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
      QWEN_SUPPORTS_PROMPT_CACHING = false;
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
  const { value: rawKey } = requireAnyEnv(["QWEN_API_KEY", "DASHSCOPE_API_KEY"]);
  const apiKey = normalizeApiKey(rawKey);
  const baseUrl = normalizeBaseUrl(process.env.QWEN_BASE_URL || process.env.DASHSCOPE_BASE_URL);
  const url = buildUrl(baseUrl);

  if (process.env.DEBUG_AI === "1") {
    console.error("[qwen] request", {
      remoteModel,
      baseUrl,
      url,
      keyLen: apiKey.length,
      keyLast4: apiKey.slice(-4),
    });
  }

  const ids = modelVariants(remoteModel);
  let lastErr = null;
  for (const modelId of ids) {
    try {
      const out = await streamOnce({ url, apiKey, remoteModel: modelId, messages, onDelta, signal });
      if (process.env.DEBUG_AI === "1" && modelId !== remoteModel) {
        console.error("[qwen] model fallback", { from: remoteModel, to: modelId });
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
