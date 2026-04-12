const { requireEnv } = require("./openaiCompatImages");

function buildProviderError({ status, text }) {
  let message = null;
  let code = "PROVIDER_ERROR";
  try {
    const j = JSON.parse(String(text || "{}"));
    if (typeof j?.detail === "string") message = j.detail;
    if (typeof j?.message === "string") message = j.message;
    if (typeof j?.error === "string") message = j.error;
    if (typeof j?.code === "string") code = j.code;
  } catch {
    // ignore
  }
  const err = new Error(code || "PROVIDER_ERROR");
  err.status = status || 500;
  err.details = {
    provider: "ideogram",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };
  return err;
}

function buildProviderErrorWithContext({ status, text, endpoint }) {
  const err = buildProviderError({ status, text });
  err.details = { ...(err.details || {}), endpoint: endpoint || null };
  return err;
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
  void remoteModel; // Ideogram v3 endpoint selects the model; keep param for compatibility.

  const apiKey = requireEnv("IDEOGRAM_API_KEY", "ideogram");
  const base = String(process.env.IDEOGRAM_BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "ideogram", missing: "IDEOGRAM_BASE_URL" };
    throw err;
  }

  const endpoint = `${base}/v1/ideogram-v3/generate`;

  // Ideogram expects multipart/form-data.
  const form = new FormData();
  form.append("prompt", String(prompt || "").slice(0, 8000));
  form.append("num_images", "1");
  const renderingSpeed = String(process.env.IDEOGRAM_RENDERING_SPEED || "TURBO").trim();
  if (renderingSpeed) form.append("rendering_speed", renderingSpeed);

  const s = String(size || "").trim();
  if (/^\d{2,5}x\d{2,5}$/.test(s)) {
    // The API accepts a resolution string like "1024x1024".
    form.append("resolution", s);
  }

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
    },
    body: form,
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
  }

  const json = await resp.json().catch(() => ({}));
  const item = Array.isArray(json?.data) ? json.data[0] : null;
  const url = typeof item?.url === "string" ? item.url : null;
  if (!url) {
    const err = new Error("EMPTY_IMAGE_RESPONSE");
    err.status = 502;
    err.details = { provider: "ideogram", body: JSON.stringify(json).slice(0, 2000) };
    throw err;
  }

  const img = await fetchAsDataUrl(url, signal);
  return { images: [img], revisedPrompt: null };
}

function fileFromImageInput({ inputImage, inputMime } = {}) { 
  const mime = String(inputMime || "image/png").trim() || "image/png"; 
  if (!inputImage) return null; 
 
  if (Buffer.isBuffer(inputImage)) { 
    const blob = new Blob([inputImage], { type: mime }); 
    return { blob, filename: `input.${mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png"}` }; 
  } 
 
  try { 
    const buf = Buffer.from(inputImage); 
    const blob = new Blob([buf], { type: mime }); 
    return { blob, filename: `input.${mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : "png"}` }; 
  } catch { 
    return null; 
  } 
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
  return `${a}x${b}`; 
} 
 
async function transformImage({ remoteModel, prompt, size, inputImage, inputMime, signal } = {}) { 
  // Some Ideogram deployments accept a model string; keep as optional. 
  const modelId = String(remoteModel || "").trim(); 
 
  const apiKey = requireEnv("IDEOGRAM_API_KEY", "ideogram");
  const base = String(process.env.IDEOGRAM_BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "ideogram", missing: "IDEOGRAM_BASE_URL" };
    throw err;
  }

  const file = fileFromImageInput({ inputImage, inputMime });
  if (!file) {
    const err = new Error("INVALID_INPUT_IMAGE");
    err.status = 400;
    err.details = { provider: "ideogram" };
    throw err;
  }

  const endpoints = [ 
    // Preferred: dedicated remix endpoint. 
    `${base}/v1/ideogram-v3/remix`, 
    // Fallback: some gateways may reuse generate for remix when an image is provided. 
    `${base}/v1/ideogram-v3/generate`, 
  ]; 
 
  const aspectRatio = aspectRatioFromSize(size); 
  // Ideogram docs accept aspect_ratio; `resolution` is an enum and varies by API version, 
  // so we only send it if the user explicitly sets it. 
  const resolution = String(process.env.IDEOGRAM_RESOLUTION || "").trim(); 
  const renderingSpeed = String(process.env.IDEOGRAM_RENDERING_SPEED || "DEFAULT").trim(); 
  // Higher defaults improve identity preservation for remix-style edits. 
  const imageWeight = String(process.env.IDEOGRAM_IMAGE_WEIGHT || "80").trim(); 
 
  const attempts = [ 
    { imageField: "image", includeResolution: true, includeModel: true }, 
    { imageField: "image_file", includeResolution: true, includeModel: true }, 
    { imageField: "image", includeResolution: false, includeModel: true }, 
    { imageField: "image_file", includeResolution: false, includeModel: true }, 
    { imageField: "image", includeResolution: true, includeModel: false }, 
    { imageField: "image_file", includeResolution: true, includeModel: false }, 
    { imageField: "image", includeResolution: false, includeModel: false }, 
    { imageField: "image_file", includeResolution: false, includeModel: false }, 
    // Some APIs expect a single JSON field with generation params. 
    { imageField: "image_file", includeResolution: true, includeModel: true, useImageRequest: true }, 
    { imageField: "image_file", includeResolution: false, includeModel: true, useImageRequest: true }, 
    { imageField: "image_file", includeResolution: true, includeModel: false, useImageRequest: true }, 
    { imageField: "image_file", includeResolution: false, includeModel: false, useImageRequest: true }, 
  ]; 
 
  let lastErr = null; 
  for (const endpoint of endpoints) { 
    for (const a of attempts) { 
      const form = new FormData(); 
      form.append(a.imageField, file.blob, file.filename); 
 
      if (a.useImageRequest) { 
        const req = { 
          prompt: String(prompt || "").slice(0, 8000), 
          num_images: 1, 
        }; 
        if (renderingSpeed) req.rendering_speed = renderingSpeed; 
        if (imageWeight) req.image_weight = imageWeight; 
        if (a.includeModel && modelId) req.model = modelId; 
        if (aspectRatio) req.aspect_ratio = aspectRatio; 
        if (a.includeResolution && resolution) req.resolution = resolution; 
 
        // For generate endpoint fallback. 
        if (endpoint.endsWith("/generate")) { 
          const mode = String(process.env.IDEOGRAM_GENERATE_MODE || "remix").trim(); 
          if (mode) req.mode = mode; 
        } 
 
        form.append("image_request", JSON.stringify(req)); 
      } else { 
        form.append("prompt", String(prompt || "").slice(0, 8000)); 
        form.append("num_images", "1"); 
        if (renderingSpeed) form.append("rendering_speed", renderingSpeed); 
        if (imageWeight) form.append("image_weight", imageWeight); 
        if (a.includeModel && modelId) form.append("model", modelId); 
        if (aspectRatio) form.append("aspect_ratio", aspectRatio); 
        if (a.includeResolution && resolution) form.append("resolution", resolution); 
 
        if (endpoint.endsWith("/generate")) { 
          const mode = String(process.env.IDEOGRAM_GENERATE_MODE || "remix").trim(); 
          if (mode) form.append("mode", mode); 
        } 
      } 
 
      const resp = await fetch(endpoint, { 
        method: "POST", 
        headers: { 
          "Api-Key": apiKey, 
        }, 
        body: form, 
        signal, 
      }); 
 
      if (!resp.ok) { 
        const text = await resp.text().catch(() => ""); 
        lastErr = buildProviderErrorWithContext({ status: resp.status, text, endpoint }); 
 
        // Retry other shapes on 400 (unknown parameters) and 404 (endpoint mismatch). 
        if (resp.status === 400) continue; 
        if (resp.status === 404) break; 
        throw lastErr; 
      } 
 
      const json = await resp.json().catch(() => ({})); 
      const item = Array.isArray(json?.data) ? json.data[0] : null; 
      const url = typeof item?.url === "string" ? item.url : null; 
      if (!url) { 
        const err = new Error("EMPTY_IMAGE_RESPONSE"); 
        err.status = 502; 
        err.details = { provider: "ideogram", endpoint, body: JSON.stringify(json).slice(0, 2000) }; 
        throw err; 
      } 
 
      if (process.env.DEBUG_AI === "1") { 
        console.error("[ideogram] img2img ok", { 
          endpoint, 
          imageField: a.imageField, 
          useImageRequest: Boolean(a.useImageRequest), 
          hasAspectRatio: Boolean(aspectRatio), 
          hasResolution: Boolean(resolution), 
          hasModel: Boolean(a.includeModel && modelId), 
          renderingSpeed: renderingSpeed || null, 
          imageWeight: imageWeight || null, 
        }); 
      } 
 
      const img = await fetchAsDataUrl(url, signal); 
      return { images: [img], revisedPrompt: null }; 
    } 
  } 
 
  throw lastErr || Object.assign(new Error("PROVIDER_ERROR"), { status: 502, details: { provider: "ideogram" } });
}

module.exports = { generateImage, transformImage };
