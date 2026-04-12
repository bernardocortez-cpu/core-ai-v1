const { requireEnv } = require("./openaiCompatImages");

function buildProviderError({ status, text, endpoint, modelId }) {
  // Many OpenAI-compatible gateways return: { error: { message, type, code } }
  let code = "PROVIDER_ERROR";
  let message = null;
  try {
    const j = JSON.parse(String(text || "{}"));
    const maybeCode = j?.error?.code || j?.error?.type || j?.code;
    if (typeof maybeCode === "string" && maybeCode) code = maybeCode;
    const maybeMsg = j?.error?.message || j?.message || j?.detail;
    if (typeof maybeMsg === "string" && maybeMsg) message = maybeMsg;
  } catch {
    // ignore
  }

  const err = new Error(code || "PROVIDER_ERROR");
  err.status = status || 500;
  err.details = {
    provider: "seedream",
    endpoint: endpoint || null,
    modelId: modelId || null,
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };
  return err;
}

function parseCsvList(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveImagesEndpoint(rawBaseUrl) {
  const raw = String(rawBaseUrl || "").trim().replace(/\/$/, "");
  if (!raw) return "";

  // If the user provided the full endpoint, keep it.
  if (raw.endsWith("/images/generations")) return raw;

  // ModelArk uses /api/v3
  if (raw.endsWith("/api/v3")) return `${raw}/images/generations`;

  // OpenAI-ish /v1 base
  if (/\/v\d+(?:beta)?$/.test(raw)) return `${raw}/images/generations`;

  // Otherwise assume they gave the host; append /api/v3/images/generations (best-effort default).
  return `${raw}/api/v3/images/generations`;
}

function resolveEditsEndpoint(rawBaseUrl) {
  const raw = String(rawBaseUrl || "").trim().replace(/\/$/, "");
  if (!raw) return "";

  if (raw.endsWith("/images/edits")) return raw;
  if (raw.endsWith("/images/generations")) return raw.replace(/\/images\/generations$/, "/images/edits");
  if (raw.endsWith("/api/v3")) return `${raw}/images/edits`;
  if (/\/v\d+(?:beta)?$/.test(raw)) return `${raw}/images/edits`;
  return `${raw}/api/v3/images/edits`;
}

function normalizeSeedreamSize(size) {
  const s = String(size || "").trim();
  const def = String(process.env.SEEDREAM_DEFAULT_SIZE || "2K").trim();
  return s || def || "";
}

function getSequentialImageGenerationValue() {
  return String(process.env.SEEDREAM_SEQUENTIAL_IMAGE_GENERATION || "disabled").trim() || "disabled";
}

function normalizeRemoteModel(remoteModel) {
  const raw = String(remoteModel || "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase();
  const aliases = {
    "seedream-5-lite": "seedream-5-0-260128",
    "seedream-5.0-lite": "seedream-5-0-260128",
    "seedream-5-0-lite": "seedream-5-0-260128",
    "seedream-5": "seedream-5-0-260128",
    "seedream-5.0": "seedream-5-0-260128",
    "seedream-5-0": "seedream-5-0-260128",
    "seedream-4.5": "seedream-4-5-251128",
    "seedream-4-0": "seedream-4-0-250828",
    "seedream-4.0": "seedream-4-0-250828",
    "seedream-3.0": "seedream-3-0-t2i-250415",
    "seedream-3-0": "seedream-3-0-t2i-250415",
  };
  return aliases[key] || raw;
}

function isSeedream5FamilyModel(remoteModel) {
  const id = normalizeRemoteModel(remoteModel);
  return /^seedream-5-0/i.test(String(id || "").trim());
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

async function generateImage({ remoteModel, prompt, size, signal } = {}) {
  // BytePlus ModelArk naming is usually ARK_*; keep our SEEDREAM_* but support aliases.
  const apiKey =
    String(process.env.SEEDREAM_API_KEY || "").trim() || String(process.env.ARK_API_KEY || "").trim() || null;
  if (!apiKey) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "seedream", missing: "SEEDREAM_API_KEY" };
    throw err;
  }

  const endpoint = resolveImagesEndpoint(process.env.SEEDREAM_BASE_URL || process.env.ARK_BASE_URL);
  if (!endpoint) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "seedream", missing: "SEEDREAM_BASE_URL" };
    throw err;
  }

  // BytePlus/ModelArk example uses response_format="url". We'll request URL and then download to base64
  // so creative.service can persist it to our own /media URLs.
  const desiredFormat = String(process.env.SEEDREAM_IMAGE_RESPONSE_FORMAT || "url").trim();
  const watermarkEnabled = String(process.env.SEEDREAM_WATERMARK || "false").trim().toLowerCase() === "true";
  const normalizedSize = normalizeSeedreamSize(size);

  const candidates = [
    normalizeRemoteModel(remoteModel),
    // ModelArk public model ids seen in docs.
    "seedream-5-0-260128",
    "seedream-5-0-lite-260128",
    "seedream-4-5-251128",
    "seedream-4-0-250828",
    // Seedream 3.0 model ids include task/version suffix.
    "seedream-3-0-t2i-250415",
    ...parseCsvList(process.env.SEEDREAM_MODEL_VARIANTS),
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  const seen = new Set();
  const modelIds = candidates.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });

  const doRequest = async ({ modelId, includeFormat, includeSize } = {}) => {
    const body = {
      model: modelId,
      prompt: String(prompt || "").slice(0, 4000),
      sequential_image_generation: getSequentialImageGenerationValue(),
    };

    if (includeSize && normalizedSize) body.size = String(normalizedSize);
    if (includeFormat && desiredFormat) body.response_format = desiredFormat;
    // watermark is optional; include only when explicitly enabled to reduce incompatibilities.
    if (watermarkEnabled) body.watermark = true;

    return fetch(endpoint, {
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
  let bestErr = null;

  for (const modelId of modelIds) {
    const attempts = [
      { includeFormat: true, includeSize: true },
      { includeFormat: false, includeSize: true },
      { includeFormat: true, includeSize: false },
      { includeFormat: false, includeSize: false },
    ];

    for (const a of attempts) {
      const resp = await doRequest({ modelId, ...a });
      if (resp.ok) {
        const json = await resp.json().catch(() => ({}));
        const item = Array.isArray(json?.data) ? json.data[0] : null;
        const b64 = typeof item?.b64_json === "string" ? item.b64_json : null;
        const url = typeof item?.url === "string" ? item.url : null;

        if (b64) {
          return {
            images: [{ mime: "image/png", dataUrl: `data:image/png;base64,${b64}` }],
            revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : null,
          };
        }

        if (url) {
          // Convert signed URLs to base64 so we can persist them to our own storage.
          const img = await fetchAsDataUrl(url, signal);
          return {
            images: [img],
            revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : null,
          };
        }

        const err = new Error("EMPTY_IMAGE_RESPONSE");
        err.status = 502;
        err.details = { provider: "seedream", modelId, body: JSON.stringify(json).slice(0, 2000) };
        throw err;
      }

      const text = await resp.text().catch(() => "");
      lastErr = buildProviderError({ status: resp.status, text, endpoint, modelId });
      if (!bestErr) bestErr = lastErr;
      const lower = String(lastErr.details?.message || lastErr.details?.body || "").toLowerCase();
      const code = String(lastErr.details?.code || lastErr.message || "").toLowerCase();

      // Retry by removing optional params on 400s.
      if (resp.status === 400) {
        // If it smells like a model/endpoint issue, stop stripping params and try next model id.
        if (code.includes("invalidendpoint") || lower.includes("endpoint") || lower.includes("model")) break;
        continue;
      }

      // Try next model id when it looks like a model/access issue.
      // ModelArk commonly returns codes like "ModelNotOpen" when the account doesn't have access to a model id.
      const looksLikeModelIssue =
        resp.status === 403 ||
        resp.status === 404 ||
        code.includes("model") ||
        code.includes("permission") ||
        code.includes("notopen") ||
        lower.includes("model") ||
        lower.includes("endpoint") ||
        lower.includes("not open") ||
        lower.includes("not enabled") ||
        lower.includes("permission");

      if (looksLikeModelIssue) break;

      throw lastErr;
    }
  }

  throw (
    bestErr ||
    lastErr ||
    Object.assign(new Error("PROVIDER_ERROR"), { status: 502, details: { provider: "seedream", endpoint } })
  );
}

function dataUrlFromBuffer(buf, mime) {
  const m = String(mime || "image/png").trim() || "image/png";
  const b64 = Buffer.isBuffer(buf) ? buf.toString("base64") : Buffer.from(buf || "").toString("base64");
  return `data:${m};base64,${b64}`;
}

async function transformImage({ remoteModel, prompt, size, inputImage, inputMime, inputImageUrl, signal } = {}) {
  const apiKey =
    String(process.env.SEEDREAM_API_KEY || "").trim() || String(process.env.ARK_API_KEY || "").trim() || null;
  if (!apiKey) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "seedream", missing: "SEEDREAM_API_KEY" };
    throw err;
  }

  const baseUrl = process.env.SEEDREAM_BASE_URL || process.env.ARK_BASE_URL;
  const generationsEndpoint = resolveImagesEndpoint(baseUrl);
  const editsEndpoint = resolveEditsEndpoint(baseUrl);
  const endpoints = (
    isSeedream5FamilyModel(remoteModel) ? [generationsEndpoint] : [generationsEndpoint, editsEndpoint]
  )
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  if (endpoints.length === 0) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "seedream", missing: "SEEDREAM_BASE_URL" };
    throw err;
  }

  if (!inputImage) {
    const err = new Error("INVALID_INPUT_IMAGE");
    err.status = 400;
    err.details = { provider: "seedream" };
    throw err;
  }

  const desiredFormat = String(process.env.SEEDREAM_IMAGE_RESPONSE_FORMAT || "url").trim();
  const watermarkEnabled = String(process.env.SEEDREAM_WATERMARK || "false").trim().toLowerCase() === "true";
  const sequentialImageGeneration = getSequentialImageGenerationValue();

  // Many providers recommend `size="adaptive"` for editing; keep UI size only if explicitly set.
  const normalizedSize =
    String(size || "").trim() ||
    String(process.env.SEEDREAM_EDIT_SIZE || "").trim() ||
    String(process.env.SEEDREAM_DEFAULT_SIZE || "adaptive").trim();

  const image = dataUrlFromBuffer(inputImage, inputMime);
  const imageBase64 = String(image.split(",")[1] || "").trim();
  const publicImageUrl =
    typeof inputImageUrl === "string" && /^https?:\/\//i.test(inputImageUrl.trim()) ? inputImageUrl.trim() : null;

  const candidates = [
    normalizeRemoteModel(remoteModel),
    // Optional: add extra model ids if your account uses different Seedream/SeedEdit ids for i2i.
    String(process.env.SEEDREAM_I2I_REMOTE_MODEL || "").trim(),
    ...parseCsvList(process.env.SEEDREAM_I2I_MODEL_VARIANTS),
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  const seen = new Set();
  const modelIds = candidates.filter((m) => {
    if (seen.has(m)) return false;
    seen.add(m);
    return true;
  });

  const payloadAttempts = [
    // ModelArk Seedream officially supports image-to-image from the image generation API.
    // Seedream 5 appears stricter than 4.5, so prefer a public URL when available.
    ...(publicImageUrl
      ? [
          { extra: { image: publicImageUrl } },
          { extra: { image_url: publicImageUrl } },
          { extra: { images: [publicImageUrl] } },
          { extra: { reference_images: [publicImageUrl] } },
        ]
      : []),
    // Then try inline variants for accounts/gateways that accept them.
    { extra: { image } },
    { extra: { image: imageBase64 } },
    { extra: { image_url: image } },
    { extra: { input_image: imageBase64 } },
    { extra: { images: [image] } },
    { extra: { images: [imageBase64] } },
    { extra: { reference_images: [image] } },
    { extra: { reference_images: [imageBase64] } },
  ];

  const doRequest = async ({ endpoint, modelId, includeFormat, includeSize, extra } = {}) => {
    const body = {
      model: modelId,
      prompt: String(prompt || "").slice(0, 4000),
      sequential_image_generation: sequentialImageGeneration,
      ...(extra && typeof extra === "object" ? extra : {}),
    };

    if (includeSize && normalizedSize) body.size = String(normalizedSize);
    if (includeFormat && desiredFormat) body.response_format = desiredFormat;
    if (watermarkEnabled) body.watermark = true;

    return fetch(endpoint, {
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
  let bestErr = null;

  for (const modelId of modelIds) {
    const attempts = [
      { includeFormat: true, includeSize: true },
      { includeFormat: false, includeSize: true },
      { includeFormat: true, includeSize: false },
      { includeFormat: false, includeSize: false },
    ];

    for (const endpoint of endpoints) {
      for (const payload of payloadAttempts) {
        for (const a of attempts) {
          const resp = await doRequest({
            endpoint,
            modelId,
            extra: payload.extra,
            ...a,
          });

          if (resp.ok) {
            const json = await resp.json().catch(() => ({}));
            const item = Array.isArray(json?.data) ? json.data[0] : null;
            const b64 = typeof item?.b64_json === "string" ? item.b64_json : null;
            const url = typeof item?.url === "string" ? item.url : null;

            if (b64) {
              return {
                images: [{ mime: "image/png", dataUrl: `data:image/png;base64,${b64}` }],
                revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : null,
              };
            }

            if (url) {
              const img = await fetchAsDataUrl(url, signal);
              return {
                images: [img],
                revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : null,
              };
            }

            const err = new Error("EMPTY_IMAGE_RESPONSE");
            err.status = 502;
            err.details = { provider: "seedream", endpoint, modelId, body: JSON.stringify(json).slice(0, 2000) };
            throw err;
          }

          const text = await resp.text().catch(() => "");
          lastErr = buildProviderError({ status: resp.status, text, endpoint, modelId });
          if (!bestErr) bestErr = lastErr;
          const lower = String(lastErr.details?.message || lastErr.details?.body || "").toLowerCase();
          const code = String(lastErr.details?.code || lastErr.message || "").toLowerCase();

          if (resp.status === 400) {
            if (code.includes("invalidendpoint") || lower.includes("endpoint") || lower.includes("model")) break;
            continue;
          }

          const looksLikeModelIssue =
            resp.status === 403 ||
            resp.status === 404 ||
            code.includes("model") ||
            code.includes("permission") ||
            code.includes("notopen") ||
            lower.includes("model") ||
            lower.includes("endpoint") ||
            lower.includes("not open") ||
            lower.includes("not enabled") ||
            lower.includes("permission");

          if (looksLikeModelIssue) break;
          throw lastErr;
        }
      }
    }
  }

  throw lastErr || bestErr || Object.assign(new Error("PROVIDER_ERROR"), { status: 502, details: { provider: "seedream" } });
}

module.exports = { generateImage, transformImage };
