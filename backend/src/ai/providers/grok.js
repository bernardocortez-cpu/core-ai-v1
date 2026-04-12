function requireAnyEnv(names) {
  for (const name of names) {
    const v = process.env[name];
    if (v) return { name, value: v };
  }
  const err = new Error("PROVIDER_NOT_CONFIGURED");
  err.status = 501;
  err.details = { provider: "grok", missingAnyOf: names };
  throw err;
}

function sseParseLines(buffer) {
  // OpenAI-compatible streaming uses SSE frames separated by \n\n (or \r\n\r\n).
  const normalized = String(buffer || "").replace(/\r/g, "");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() || "";
  return { frames: parts, rest };
}

let GROK_SUPPORTS_PROMPT_CACHING = null;
const GROK_WORKING_MODEL_BY_REQUESTED = new Map();
const GROK_BAD_MODELS = new Set();

function buildProviderError({ status, text }) {
  // xAI is OpenAI-compatible, so error payloads are usually:
  // { error: { message, type, code } }
  let code = "PROVIDER_ERROR";
  let message = "";
  try {
    const j = JSON.parse(text || "{}");
    // Some APIs put a numeric HTTP-ish code in `error.code`. Prefer string codes/types for UX.
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
    provider: "grok",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };

  if (process.env.DEBUG_AI === "1") {
    console.error("[grok] error", {
      status: err.status,
      code: err.details.code,
      message: err.details.message,
      body: err.details.body,
    });
  }
  return err;
}

function parseCsvList(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function gcd(a, b) {
  let x = Math.abs(Number(a) || 0);
  let y = Math.abs(Number(b) || 0);
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function parseSize(size) {
  const s = String(size || "").trim();
  const m = s.match(/^(\d{2,5})x(\d{2,5})$/i);
  if (!m) return null;
  const w = Number.parseInt(m[1], 10);
  const h = Number.parseInt(m[2], 10);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}

function aspectRatioFromSize(size) {
  const parsed = parseSize(size);
  if (!parsed) return null;
  const d = gcd(parsed.w, parsed.h);
  const a = Math.max(1, Math.round(parsed.w / d));
  const b = Math.max(1, Math.round(parsed.h / d));
  return `${a}:${b}`;
}

function resolutionFromSize(size) {
  const parsed = parseSize(size);
  if (!parsed) return null;
  const max = Math.max(parsed.w, parsed.h);
  if (max <= 1024) return "1k";
  if (max <= 2048) return "2k";
  return "2k";
}

function dataUrlFromBuffer(buf, mime) {
  // Keep the data URL mime clean (no charset/params), since some providers are picky.
  const m = String(mime || "image/png")
    .split(";")[0]
    .trim() || "image/png";
  const b64 = Buffer.isBuffer(buf) ? buf.toString("base64") : Buffer.from(buf || "").toString("base64");
  return `data:${m};base64,${b64}`;
}

function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

function guessMimeFromBase64(b64) {
  const head = String(b64 || "").slice(0, 16);
  // JPEG: FF D8 FF => "/9j/" in base64
  if (head.startsWith("/9j/")) return "image/jpeg";
  // PNG: 89 50 4E 47 => "iVBORw0KGgo" in base64
  if (head.startsWith("iVBORw0KGgo")) return "image/png";
  // WEBP: "RIFF" => "UklGR" in base64
  if (head.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

async function fetchAsDataUrl(url, signal) {
  const resp = await fetch(url, { method: "GET", signal });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
  }
  const mime = resp.headers.get("content-type") || "image/png";
  const ab = await resp.arrayBuffer();
  const b64 = Buffer.from(ab).toString("base64");
  return { mime, dataUrl: `data:${mime};base64,${b64}` };
}

function parseImageResponse({ provider, remoteModel, json } = {}) {
  const item = Array.isArray(json?.data) ? json.data[0] : null;
  const b64 = typeof item?.b64_json === "string" ? item.b64_json : null;
  const url = typeof item?.url === "string" ? item.url : null;
  const itemImage = typeof item?.image === "string" ? item.image : null;

  if (b64) {
    const mime = guessMimeFromBase64(b64);
    return {
      images: [{ mime, dataUrl: `data:${mime};base64,${b64}` }],
      revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : null,
    };
  }

  if (url) {
    return {
      images: [{ mime: "image/png", url }],
      revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : null,
    };
  }

  if (itemImage) {
    const parsed = itemImage.startsWith("data:") ? parseDataUrl(itemImage) : null;
    const base64 = parsed?.base64 || itemImage;
    const mime = parsed?.mime || guessMimeFromBase64(base64);
    return { images: [{ mime, dataUrl: `data:${mime};base64,${base64}` }], revisedPrompt: null };
  }

  const topUrl = typeof json?.url === "string" ? json.url : null;
  const topImage = typeof json?.image === "string" ? json.image : null;
  if (topUrl) return { images: [{ mime: "image/png", url: topUrl }], revisedPrompt: null };
  if (topImage) {
    const parsed = topImage.startsWith("data:") ? parseDataUrl(topImage) : null;
    const base64 = parsed?.base64 || topImage;
    const mime = parsed?.mime || guessMimeFromBase64(base64);
    return { images: [{ mime, dataUrl: `data:${mime};base64,${base64}` }], revisedPrompt: null };
  }

  const err = new Error("EMPTY_IMAGE_RESPONSE");
  err.status = 502;
  err.details = { provider, remoteModel, body: JSON.stringify(json || {}).slice(0, 2000) };
  throw err;
}

async function generateImage({ remoteModel, prompt, size, signal } = {}) {
  const { value: apiKey } = requireAnyEnv(["XAI_API_KEY", "GROK_API_KEY"]);
  const baseUrlRaw = (process.env.GROK_BASE_URL || process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(
    /\/$/,
    ""
  );
  const baseUrl = /\/v\d+(?:beta)?$/.test(baseUrlRaw) ? baseUrlRaw : `${baseUrlRaw}/v1`;

  const desiredFormat = String(process.env.GROK_IMAGE_RESPONSE_FORMAT || process.env.XAI_IMAGE_RESPONSE_FORMAT || "b64_json").trim();
  const candidates = [
    String(remoteModel || "").trim(),
    // Common xAI image model ids seen in the wild/docs.
    "grok-imagine-image",
    "grok-2-image-1212",
    "grok-2-image",
    ...parseCsvList(process.env.GROK_IMAGE_MODEL_VARIANTS),
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  const seen = new Set();
  const modelIds = candidates.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });

  const doRequest = async ({ modelId, includeFormat } = {}) => {
    const body = {
      model: modelId,
      prompt: String(prompt || "").slice(0, 4000),
      n: 1,
    };

    // NOTE: xAI docs prefer aspect_ratio/resolution. We ignore `size` to avoid unknown_parameter errors.
    // (The UI currently always sends size="1024x1024".)
    void size;

    if (includeFormat && desiredFormat) body.response_format = desiredFormat;

    return fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  };

  let lastErr = null;
  for (const modelId of modelIds) {
    // Try with response_format first, then retry without if the gateway rejects it.
    let resp = await doRequest({ modelId, includeFormat: true });
    if (!resp.ok && resp.status === 400 && desiredFormat) {
      const text = await resp.text().catch(() => "");
      if (text.toLowerCase().includes("unknown parameter") && text.toLowerCase().includes("response_format")) {
        resp = await doRequest({ modelId, includeFormat: false });
      } else {
        lastErr = buildProviderError({ status: resp.status, text });
        // If it's a model/access error, try the next model id.
        const code = String(lastErr.details?.code || lastErr.message || "").toLowerCase();
        const msg = String(lastErr.details?.message || lastErr.details?.body || "").toLowerCase();
        if (resp.status === 404 || code.includes("model") || msg.includes("model")) continue;
        throw lastErr;
      }
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      lastErr = buildProviderError({ status: resp.status, text });
      const code = String(lastErr.details?.code || lastErr.message || "").toLowerCase();
      const msg = String(lastErr.details?.message || lastErr.details?.body || "").toLowerCase();
      if (resp.status === 404 || code.includes("model") || msg.includes("model")) continue;
      throw lastErr;
    }

    const json = await resp.json().catch(() => ({}));
    return parseImageResponse({ provider: "grok", remoteModel: modelId, json });
  }

  throw lastErr || Object.assign(new Error("PROVIDER_ERROR"), { status: 502, details: { provider: "grok" } });
}

async function transformImage({ remoteModel, prompt, size, inputImage, inputMime, inputImageUrl, signal } = {}) {
  const { value: apiKey } = requireAnyEnv(["XAI_API_KEY", "GROK_API_KEY"]);
  const baseUrlRaw = (process.env.GROK_BASE_URL || process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(
    /\/$/,
    ""
  );
  const baseUrl = /\/v\d+(?:beta)?$/.test(baseUrlRaw) ? baseUrlRaw : `${baseUrlRaw}/v1`;

  if (!inputImage) {
    const err = new Error("INVALID_INPUT_IMAGE");
    err.status = 400;
    err.details = { provider: "grok" };
    throw err;
  }

  const imageUrl =
    typeof inputImageUrl === "string" && /^https?:\/\//i.test(inputImageUrl)
      ? inputImageUrl.trim()
      : dataUrlFromBuffer(inputImage, inputMime);

  if (process.env.DEBUG_AI === "1" && imageUrl.startsWith("data:")) {
    console.warn(
      "[grok] note: using data: URI for input image. If Grok img2img seems to ignore the image, set PUBLIC_API_URL to a public HTTPS URL so we can pass a real URL instead."
    );
  }
  const desiredFormat = String(process.env.GROK_IMAGE_RESPONSE_FORMAT || process.env.XAI_IMAGE_RESPONSE_FORMAT || "b64_json").trim();
  const wantsBase64 = desiredFormat.toLowerCase().includes("b64") || desiredFormat.toLowerCase().includes("base64");
  const aspectRatio = aspectRatioFromSize(size);
  const resolution = resolutionFromSize(size);
  const responseFormat = desiredFormat === "url" ? "url" : wantsBase64 ? "b64_json" : null;

  const primary = String(remoteModel || "").trim();
  // Prefer the "imagine" image model for img2img (best compatibility across xAI docs).
  const candidates = ["grok-imagine-image", primary, "grok-2-image-1212", "grok-2-image", ...parseCsvList(process.env.GROK_IMAGE_MODEL_VARIANTS)]
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  const seen = new Set();
  const modelIds = candidates.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });

  // Per xAI docs, image editing is performed via the same image generation endpoint
  // by adding `image_url` (single) or `image_urls` (multiple). The API requires JSON.
  const endpoint = "/images/generations";
  const imageBase64 = String(imageUrl.split(",")[1] || "").trim();

  const imagePayloads = [
    // Documented by xAI (preferred)
    { name: "image_url:datauri", fn: () => ({ image_url: imageUrl }) },
    { name: "image_urls:datauri", fn: () => ({ image_urls: [imageUrl] }) },
    // Best-effort fallbacks (some gateways accept these shapes)
    { name: "image_url:object", fn: () => ({ image_url: { url: imageUrl } }) },
    { name: "image:b64", fn: () => ({ image: imageBase64 }) },
    { name: "input_image:b64", fn: () => ({ input_image: imageBase64 }) },
  ];

  const doRequest = async ({
    modelId,
    includeImageFormat,
    includeSizeHints,
    payload,
  } = {}) => {
    const body = {
      model: modelId,
      prompt: String(prompt || "").slice(0, 4000),
      ...(payload && typeof payload.fn === "function" ? payload.fn() : {}),
    };

    if (includeSizeHints) {
      if (aspectRatio) body.aspect_ratio = aspectRatio;
      if (resolution) body.resolution = resolution;
    }

    // xAI docs: `image_format="base64"` returns base64 output.
    if (includeImageFormat && wantsBase64) body.image_format = "base64";

    if (process.env.DEBUG_AI === "1") {
      console.error("[grok] img2img request", {
        modelId,
        baseUrl,
        endpoint,
        payload: payload?.name || null,
        inputMime: String(inputMime || "").split(";")[0] || null,
        inputBytes: Buffer.isBuffer(inputImage) ? inputImage.length : null,
        dataUriLen: typeof imageUrl === "string" ? imageUrl.length : null,
        source: imageUrl && imageUrl.startsWith("data:") ? "datauri" : "url",
        hasAspectRatio: Boolean(body.aspect_ratio),
        hasResolution: Boolean(body.resolution),
        imageFormat: body.image_format || null,
        responseFormat: responseFormat || null,
        imageKey:
          body?.image_url
            ? "image_url"
            : body?.image_urls
              ? "image_urls"
              : body?.image
                ? "image"
                : body?.input_image
                  ? "input_image"
                  : null,
      });
    }

    return fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  };

  let lastErr = null;
  for (const modelId of modelIds) {
    const paramAttempts = [
      { includeImageFormat: true, includeSizeHints: true },
      { includeImageFormat: true, includeSizeHints: false },
      { includeImageFormat: false, includeSizeHints: true },
      { includeImageFormat: false, includeSizeHints: false },
    ];

    for (const payload of imagePayloads) {
      for (const a of paramAttempts) {
        const resp = await doRequest({ modelId, payload, ...a });

          if (resp.ok) {
            const json = await resp.json().catch(() => ({}));
            if (process.env.DEBUG_AI === "1") {
              const data0 = Array.isArray(json?.data) ? json.data[0] : null;
              const revised = typeof data0?.revised_prompt === "string" ? data0.revised_prompt : null;
              console.error("[grok] img2img response", {
                endpoint,
                model: json?.model || null,
                keys: json && typeof json === "object" ? Object.keys(json).slice(0, 25) : null,
                hasDataArray: Array.isArray(json?.data),
                data0Keys: data0 && typeof data0 === "object" ? Object.keys(data0).slice(0, 25) : null,
                hasTopUrl: typeof json?.url === "string",
                hasTopImage: typeof json?.image === "string",
                revisedPromptLen: revised ? revised.length : null,
                revisedPromptSnippet: revised ? revised.slice(0, 220) : null,
                respectModeration:
                  typeof json?.respect_moderation === "boolean"
                    ? json.respect_moderation
                    : typeof json?.respectModeration === "boolean"
                      ? json.respectModeration
                    : null,
            });
          }

          const respect =
            typeof json?.respect_moderation === "boolean"
              ? json.respect_moderation
              : typeof json?.respectModeration === "boolean"
                ? json.respectModeration
                : null;
          if (respect === false) {
            const err = new Error("PROVIDER_CONTENT_FILTERED");
            err.status = 400;
            err.details = { provider: "grok", code: "content_filtered" };
            throw err;
          }

          let parsed = parseImageResponse({ provider: "grok", remoteModel: modelId, json });
          const first = Array.isArray(parsed?.images) ? parsed.images[0] : null;
          if (first && first.url && !first.dataUrl) {
            const img = await fetchAsDataUrl(first.url, signal);
            parsed = { ...parsed, images: [img] };
          }
          return parsed;
        }

        const text = await resp.text().catch(() => "");
        lastErr = buildProviderError({ status: resp.status, text });
        const code = String(lastErr.details?.code || lastErr.message || "").toLowerCase();
        const msg = String(lastErr.details?.message || lastErr.details?.body || "").toLowerCase();

        if (resp.status === 400 && msg.includes("unknown") && msg.includes("parameter")) continue;
        if (resp.status === 404) break; // try next model id
        if (code.includes("model") || msg.includes("model")) break; // try next model id
        throw lastErr;
      }
    }
  }

  throw lastErr || Object.assign(new Error("PROVIDER_ERROR"), { status: 502, details: { provider: "grok" } });
}

async function streamChat({ remoteModel, messages, onDelta, signal }) {
  const { value: apiKey } = requireAnyEnv(["XAI_API_KEY", "GROK_API_KEY"]);
  const baseUrlRaw = (process.env.GROK_BASE_URL || process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(
    /\/$/,
    ""
  );
  // Allow users to set GROK_BASE_URL="https://api.x.ai" (without /v1).
  const baseUrl = /\/v\d+(?:beta)?$/.test(baseUrlRaw) ? baseUrlRaw : `${baseUrlRaw}/v1`;

  if (process.env.DEBUG_AI === "1") {
    console.error("[grok] request", {
      remoteModel,
      baseUrl,
      keyLen: apiKey.length,
      keyLast4: apiKey.slice(-4),
    });
  }

  const cachingEnabled = String(process.env.GROK_PROMPT_CACHING || "1") !== "0";
  const promptCacheRetention = String(process.env.GROK_PROMPT_CACHE_RETENTION || "").trim();
  const promptCacheKey =
    String(process.env.GROK_PROMPT_CACHE_KEY || "").trim() ||
    `coreai:v1:grok:${String(remoteModel || "").trim() || "unknown"}`;

  let supportsPromptCaching = GROK_SUPPORTS_PROMPT_CACHING !== false;

  const parseUnsupportedParam = (text) => {
    try {
      const j = JSON.parse(text || "{}");
      const p = String(j?.error?.param || "").trim();
      return p || null;
    } catch {
      return null;
    }
  };

  const doRequest = async ({ includeUsage, includeCaching, modelId } = {}) => {
    const body = {
      model: modelId || remoteModel,
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

  function modelVariants(modelId) {
    const id = String(modelId || "").trim();
    if (!id) return [];
    const out = [id];
    const add = (x) => {
      const v = String(x || "").trim();
      if (v && !out.includes(v)) out.push(v);
    };

    // Handle the common fast/rapid naming differences we see.
    if (id.includes("grok-4-1")) {
      add("grok-4-1-rapid-reasoning");
      add("grok-4-1-rapid-non-reasoning");
      add("grok-4-1-fast-reasoning");
      add("grok-4-1-fast-non-reasoning");
      add("grok-4-1");
    }
    if (id.includes("grok-4-2")) {
      add("grok-4-2-rapid-reasoning");
      add("grok-4-2-rapid-non-reasoning");
      add("grok-4-2-fast-reasoning");
      add("grok-4-2-fast-non-reasoning");
      add("grok-4-2");
    }
    if (id.startsWith("grok-4")) {
      add("grok-4-rapid-reasoning");
      add("grok-4-rapid-non-reasoning");
      add("grok-4-0709");
      add("grok-4");
    }

    return out;
  }

  function isModelishError(err) {
    if (!err) return false;
    const status = Number(err.status || 0);
    const code = String(err.details?.code || err.message || "").toLowerCase();
    const msg = String(err.details?.message || err.details?.body || "").toLowerCase();
    if (status === 404) return true;
    if (code.includes("model")) return true;
    if (msg.includes("model")) return true;
    return false;
  }

  async function callWithModelId(modelId) {
    let resp = await doRequest({ includeUsage: true, includeCaching: true, modelId });
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
        GROK_SUPPORTS_PROMPT_CACHING = false;
      }

      const retryPlan = [];
      if (mentionsStreamOptions && mentionsCaching)
        retryPlan.push({ includeUsage: false, includeCaching: false, modelId });
      if (mentionsStreamOptions) retryPlan.push({ includeUsage: false, includeCaching: true, modelId });
      if (mentionsCaching) retryPlan.push({ includeUsage: true, includeCaching: false, modelId });
      retryPlan.push({ includeUsage: false, includeCaching: false, modelId });

      let ok = false;
      for (const attempt of retryPlan) {
        resp = await doRequest(attempt);
        if (resp.ok) {
          ok = true;
          break;
        }
        if (resp.status !== 400) break;
      }

      if (!ok && !resp.ok && resp.status === 400) {
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

  const ids = modelVariants(remoteModel);
  const requestedKey = String(remoteModel || "").trim();
  const preferred = GROK_WORKING_MODEL_BY_REQUESTED.get(requestedKey);
  const ordered = [];
  const add = (x) => {
    const v = String(x || "").trim();
    if (!v) return;
    if (GROK_BAD_MODELS.has(v)) return;
    if (!ordered.includes(v)) ordered.push(v);
  };
  if (preferred) add(preferred);
  for (const id of ids) add(id);
  let lastErr = null;
  for (const modelId of ordered) {
    try {
      const out = await callWithModelId(modelId);
      // If we had to switch to a fallback model id, log it (debug only).
      if (process.env.DEBUG_AI === "1" && modelId !== remoteModel) {
        console.error("[grok] model fallback", { from: remoteModel, to: modelId });
      }
      GROK_WORKING_MODEL_BY_REQUESTED.set(requestedKey, modelId);
      return { ...out, usedRemoteModel: modelId };
    } catch (e) {
      lastErr = e;
      if (isModelishError(e)) {
        GROK_BAD_MODELS.add(modelId);
        continue;
      }
      throw e;
    }
  }

  throw lastErr;
}

module.exports = { streamChat, generateImage, transformImage };
