const prisma = require("../lib/prisma");
const planService = require("./plan.service");
const conversationService = require("./conversation.service");
const {
  normalizePlan,
  getCreativeModelCreditCost,
  getMonthlyCreativeCreditLimit,
  isPaidPlan,
} = require("../config/plans");
const { getCreativeModel } = require("../ai/creativeModels");
const { getProvider } = require("../ai/providers");
const { runInProviderQueue, assertDailyLimitOrThrow } = require("../ai/queues");
const fs = require("fs");
const path = require("path");

const CREATIVE_BUDGET_AI_REQUEST_MODES = [
  "creative_studio",
  "creative_studio_img2img",
  "creative_studio_video",
  "creative_studio_i2v",
  "creative_studio_v2v",
  "creative_studio_music",
  "creative_studio_music_from_image",
];

// Approximate internal cost per generated image at 1024x1024.
// We keep this intentionally simple: this is for internal monthly cost tracking,
// not provider billing reconciliation.
const CREATIVE_MODEL_INTERNAL_PRICING_USD = {
  "gpt-image-1.5": 0.08,
  "gpt-image-1": 0.06,
  "dall-e-3": 0.08,
  "dall-e-2": 0.02,
  "nano-banana-2": 0.04,
  "nano-banana-pro": 0.055,
  "nano-banana": 0.03,
  "gemini-3.1-flash-image-preview": 0.04,
  "gemini-3-pro-image-preview": 0.055,
  "gemini-2.5-flash-image": 0.03,
  "flux-2-pro": 0.05,
  "flux-2": 0.03,
  "flux-2-flex": 0.03,
  "ideogram-3": 0.045,
  "seedream-5-lite": 0.035,
  "seedream-5-0-260128": 0.035,
  "seedream-4.5": 0.045,
  "seedream-4-5-251128": 0.045,
  "grok-image": 0.05,
  "grok-imagine-image": 0.05,
  "veo-3.1": 0.45,
  "veo-3.1-generate-preview": 0.45,
  "wan-2.6": 0.12,
  "hailuo-2.3": 0.28,
  "alibaba/wan-2.6/text-to-video": 0.12,
  "alibaba/wan-2.6/image-to-video": 0.12,
  "minimax/hailuo-2.3/t2v-standard": 0.28,
  "minimax/hailuo-2.3/i2v-standard": 0.28,
  "seedance-2": 0.15,
  "seedance-1-5-pro-251215": 0.15,
  "kling-3": 0.18,
  "kwaivgi/kling-v3.0-std/text-to-video": 0.18,
  "kwaivgi/kling-v3.0-std/image-to-video": 0.18,
  "vidu-q3": 0.18,
  "runway-gen-4.5": 0.18,
  "vidu/q3/text-to-video": 0.18,
  "vidu/q3/image-to-video": 0.18,
  "vidu/q3/reference-to-video": 0.18,
  "lyria-3": 0.1,
  "lyria-3-clip-preview": 0.1,
  "lyria-3-pro": 0.3,
  "lyria-3-pro-preview": 0.3,
};

const CREATIVE_PROVIDER_DEFAULT_INTERNAL_PRICING_USD = {
  openai: 0.06,
  gemini: 0.035,
  flux: 0.04,
  ideogram: 0.045,
  seedream: 0.04,
  grok: 0.05,
  qwen: 0.12,
  seedance: 0.15,
  atlascloud: 0.18,
};

function getUtcMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function asFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getCreativeSizeMultiplier(size) {
  const raw = String(size || "").trim().toLowerCase();
  if (!raw) return 1;
  if (raw === "small") return 0.75;
  if (raw === "medium") return 1;
  if (raw === "large") return 1.35;

  const match = raw.match(/^(\d+)\s*x\s*(\d+)$/);
  if (!match) return 1;

  const width = asFiniteNumber(match[1]);
  const height = asFiniteNumber(match[2]);
  if (width <= 0 || height <= 0) return 1;

  const baseArea = 1024 * 1024;
  const ratio = (width * height) / baseArea;
  return Number(Math.max(0.5, Math.min(2, ratio)).toFixed(4));
}

function estimateCreativeCostUsd({ modelId, remoteModel, provider, size, imageCount = 1 }) {
  const normalizedRemoteModel = String(remoteModel || "").trim().toLowerCase();
  const normalizedModelId = String(modelId || "").trim().toLowerCase();
  const normalizedProvider = String(provider || "").trim().toLowerCase();

  const unitCost =
    CREATIVE_MODEL_INTERNAL_PRICING_USD[normalizedRemoteModel] ??
    CREATIVE_MODEL_INTERNAL_PRICING_USD[normalizedModelId] ??
    CREATIVE_PROVIDER_DEFAULT_INTERNAL_PRICING_USD[normalizedProvider] ??
    null;

  if (unitCost == null) return null;

  const safeImageCount = Math.max(1, Math.round(asFiniteNumber(imageCount)) || 1);
  const total = unitCost * getCreativeSizeMultiplier(size) * safeImageCount;

  return Number.isFinite(total) ? Number(total.toFixed(6)) : null;
}

async function getMonthlyCreativeSpendUsd({ userId, periodStart }) {
  const agg = await prisma.aIRequest.aggregate({
    where: {
      userId,
      mode: { in: CREATIVE_BUDGET_AI_REQUEST_MODES },
      status: "succeeded",
      createdAt: { gte: periodStart },
    },
    _sum: {
      estimatedCostUsd: true,
    },
  });

  return asFiniteNumber(agg?._sum?.estimatedCostUsd);
}

async function refreshMonthlyCreativeBudgetSummary({
  userId,
  normalizedPlan,
  periodStart,
}) {
  if (!userId || !periodStart) return;

  try {
    const [user, monthSpendUsd, creditsSnapshot] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, plan: true },
      }),
      getMonthlyCreativeSpendUsd({ userId, periodStart }),
      prisma.creativeBudgetMonth.findUnique({
        where: { userId_periodStart: { userId, periodStart } },
        select: { creditsUsed: true },
      }),
    ]);

    if (!user?.email) return;

    const effectivePlan = normalizePlan(normalizedPlan || user.plan);

    await prisma.creativeBudgetMonth.upsert({
      where: {
        userId_periodStart: {
          userId,
          periodStart,
        },
      },
      create: {
        userId,
        userEmail: user.email,
        plan: effectivePlan,
        periodStart,
        creativeCostUsd: monthSpendUsd,
        creditsUsed: creditsSnapshot?.creditsUsed || 0,
        creditsLimit: getMonthlyCreativeCreditLimit(effectivePlan),
      },
      update: {
        userEmail: user.email,
        plan: effectivePlan,
        creativeCostUsd: monthSpendUsd,
        creditsUsed: creditsSnapshot?.creditsUsed || 0,
        creditsLimit: getMonthlyCreativeCreditLimit(effectivePlan),
      },
    });
  } catch (e) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[creative-budget] summary refresh error", {
        message: e?.message || String(e),
        userId,
      });
    }
  }
}

function parseCsvList(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isModelUnavailableError(e) {
  const code = String(e?.details?.code || e?.message || "").toLowerCase();
  const msg = `${e?.details?.message || ""} ${e?.details?.body || ""}`.toLowerCase();
  return (
    code === "model_not_found" ||
    code === "not_found" ||
    msg.includes("model_not_found") ||
    msg.includes("does not have access") ||
    msg.includes("not have access") ||
    msg.includes("you must be a member") ||
    (e?.status === 404 && msg.includes("model"))
  );
}

async function getOpenAIImageFallbackCandidates({ provider, primaryRemoteModel, signal }) {
  // Backwards-compatible single fallback (highest priority).
  const single = String(process.env.OPENAI_IMAGE_FALLBACK_REMOTE_MODEL || "").trim();

  // Preferred: an ordered list of model ids to try when the chosen image model isn't available.
  const list = parseCsvList(process.env.OPENAI_IMAGE_FALLBACK_REMOTE_MODELS);

  let candidates = [];
  if (single) candidates.push(single);
  if (list.length) candidates.push(...list);

  // Sensible defaults. (Many projects have DALL·E but not GPT Image.)
  if (candidates.length === 0) {
    candidates = ["gpt-image-1", "dall-e-3", "dall-e-2"];
  }

  // If the UI model is "gpt-image-1.5", make sure we try "gpt-image-1" too.
  if (String(primaryRemoteModel || "").trim() === "gpt-image-1.5" && !candidates.includes("gpt-image-1")) {
    candidates.unshift("gpt-image-1");
  }

  // If the provider supports listing models, filter candidates to those that exist (best-effort).
  if (provider && typeof provider.listModels === "function") {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    try {
      const models = await provider.listModels({ signal: ctrl.signal });
      const available = new Set((models || []).map((m) => String(m?.id || "").trim()).filter(Boolean));
      const filtered = candidates.filter((m) => available.has(m));
      if (filtered.length) candidates = filtered;
    } catch {
      // ignore discovery failures (gateway may not support /models)
    } finally {
      clearTimeout(t);
    }
  }

  // Remove duplicates + the primary model (we already tried it).
  const seen = new Set();
  return candidates.filter((m) => {
    const id = String(m || "").trim();
    if (!id) return false;
    if (id === String(primaryRemoteModel || "").trim()) return false;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function getPublicApiBaseUrl() {
  const rawCandidates = [
    process.env.PUBLIC_API_URL,
    process.env.API_PUBLIC_URL,
    process.env.BACKEND_PUBLIC_URL,
    process.env.PUBLIC_BACKEND_URL,
    // Common existing envs in this codebase:
    process.env.API_URL, // e.g. https://getcoreai.io/api
    process.env.APP_URL, // e.g. https://getcoreai.io
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);

  for (const raw of rawCandidates) {
    try {
      const u = new URL(raw);
      // If someone passes an API base like https://domain.tld/api, we want https://domain.tld
      // because media is served at /media (not /api/media).
      const pathname = (u.pathname || "").replace(/\/+$/, "");
      if (pathname.toLowerCase() === "/api") u.pathname = "/";
      // Some deployments may have /api/v1, keep it simple and only strip the last /api segment.
      if (pathname.toLowerCase().endsWith("/api")) u.pathname = pathname.slice(0, -4) || "/";

      // Remove any trailing slash for stable concatenation.
      return u.toString().replace(/\/$/, "");
    } catch {
      // ignore invalid URL candidates
    }
  }

  const port = process.env.PORT || 4000;
  return `http://localhost:${port}`;
}

function decodeDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  try {
    return { mime, buf: Buffer.from(b64, "base64") };
  } catch {
    return null;
  }
}

function extFromMime(mime) {
  const m = String(mime || "").toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("webm")) return "webm";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav") || m.includes("wave")) return "wav";
  if (m.includes("x-m4a") || m.includes("m4a") || m.includes("mp4a") || m.includes("aac")) return "m4a";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  return "png";
}

async function persistInputMediaForRemoteFetch({ mime, buf, requestId, kind = "image" }) {
  if (!buf || !requestId) return null;

  const uploadsRoot = path.join(process.cwd(), "uploads");
  const inputDir = path.join(uploadsRoot, kind === "video" ? "creative-video-input" : "creative-input");
  await fs.promises.mkdir(inputDir, { recursive: true });

  const ext = extFromMime(mime);
  const filename = `${requestId}.${ext}`;
  const abs = path.join(inputDir, filename);
  await fs.promises.writeFile(abs, buf);

  const baseUrl = getPublicApiBaseUrl();
  return `${baseUrl}/media/${kind === "video" ? "creative-video-input" : "creative-input"}/${filename}`;
}

async function persistInputImageForRemoteFetch({ mime, buf, requestId }) {
  return persistInputMediaForRemoteFetch({ mime, buf, requestId, kind: "image" });
}

function isPublicUrlForProviders(url) {
  const u = String(url || "").trim();
  if (!u) return false;
  if (!/^https?:\/\//i.test(u)) return false;
  // Providers cannot access localhost/private URLs.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\b/i.test(u)) return false;
  return true;
}

async function persistGeneratedImages({ images, requestId }) {
  const items = Array.isArray(images) ? images : [];
  if (items.length === 0) return [];

  const uploadsRoot = path.join(process.cwd(), "uploads");
  const creativeDir = path.join(uploadsRoot, "creative");
  await fs.promises.mkdir(creativeDir, { recursive: true });

  const baseUrl = getPublicApiBaseUrl();
  const out = [];

  for (let i = 0; i < items.length; i += 1) {
    const img = items[i] || {};
    const decoded = img.dataUrl ? decodeDataUrl(img.dataUrl) : null;

    if (!decoded) {
      // If the provider returned a URL already, keep it.
      if (img.url) out.push({ mime: img.mime || "image/png", url: img.url });
      continue;
    }

    const ext = extFromMime(decoded.mime || img.mime);
    const filename = `${requestId}-${i + 1}.${ext}`;
    const abs = path.join(creativeDir, filename);
    await fs.promises.writeFile(abs, decoded.buf);

    out.push({
      mime: decoded.mime || img.mime || "image/png",
      url: `${baseUrl}/media/creative/${filename}`,
    });
  }

  return out;
}

async function persistGeneratedVideos({ videos, requestId }) {
  const items = Array.isArray(videos) ? videos : [];
  if (items.length === 0) return [];

  const uploadsRoot = path.join(process.cwd(), "uploads");
  const creativeDir = path.join(uploadsRoot, "creative-video");
  await fs.promises.mkdir(creativeDir, { recursive: true });

  const baseUrl = getPublicApiBaseUrl();
  const out = [];

  for (let i = 0; i < items.length; i += 1) {
    const video = items[i] || {};
    const decoded = video.dataUrl ? decodeDataUrl(video.dataUrl) : null;

    if (!decoded) {
      if (video.url) out.push({ mime: video.mime || "video/mp4", url: video.url });
      continue;
    }

    const ext = extFromMime(decoded.mime || video.mime);
    const filename = `${requestId}-${i + 1}.${ext}`;
    const abs = path.join(creativeDir, filename);
    await fs.promises.writeFile(abs, decoded.buf);

    out.push({
      mime: decoded.mime || video.mime || "video/mp4",
      url: `${baseUrl}/media/creative-video/${filename}`,
    });
  }

  return out;
}

async function persistGeneratedAudios({ audios, requestId }) {
  const items = Array.isArray(audios) ? audios : [];
  if (items.length === 0) return [];

  const uploadsRoot = path.join(process.cwd(), "uploads");
  const creativeDir = path.join(uploadsRoot, "creative-audio");
  await fs.promises.mkdir(creativeDir, { recursive: true });

  const baseUrl = getPublicApiBaseUrl();
  const out = [];

  for (let i = 0; i < items.length; i += 1) {
    const audio = items[i] || {};
    const decoded = audio.dataUrl ? decodeDataUrl(audio.dataUrl) : null;

    if (!decoded) {
      if (audio.url) out.push({ mime: audio.mime || "audio/mpeg", url: audio.url });
      continue;
    }

    const ext = extFromMime(decoded.mime || audio.mime);
    const filename = `${requestId}-${i + 1}.${ext}`;
    const abs = path.join(creativeDir, filename);
    await fs.promises.writeFile(abs, decoded.buf);

    out.push({
      mime: decoded.mime || audio.mime || "audio/mpeg",
      url: `${baseUrl}/media/creative-audio/${filename}`,
    });
  }

  return out;
}

async function createAIRequest({ userId, mode, provider, model }) {
  return prisma.aIRequest.create({
    data: {
      userId,
      conversationId: null,
      messageId: null,
      mode: mode || "creative_studio",
      provider,
      model,
      selectionMode: "manual",
      status: "queued",
    },
  });
}

async function updateAIRequest(id, data) {
  return prisma.aIRequest.update({ where: { id }, data });
}

function looksLikeDataUrlImage(s) {
  const v = String(s || "");
  return v.startsWith("data:image/") && v.includes(";base64,");
}

function looksLikeDataUrlVideo(s) {
  const v = String(s || "");
  return v.startsWith("data:video/") && v.includes(";base64,");
}

function looksLikeImageUrl(s) {
  const v = String(s || "").toLowerCase();
  if (!v) return false;
  if (v.startsWith("data:image/")) return true;
  if (v.startsWith("http://") || v.startsWith("https://")) return true;
  if (v.startsWith("/")) return true;
  return /\.(png|jpg|jpeg|webp)(\?.*)?$/.test(v);
}

function looksLikeVideoUrl(s) {
  const v = String(s || "").toLowerCase();
  if (!v) return false;
  if (v.startsWith("data:video/")) return true;
  if (v.startsWith("http://") || v.startsWith("https://")) return true;
  if (v.startsWith("/")) return true;
  return /\.(mp4|webm|mov)(\?.*)?$/.test(v);
}

function extractInputMediaFromAny({ inputMedia, inputImage, inputVideo, attachments, content } = {}) {
  const pick = (x) => {
    if (!x) return null;
    if (typeof x === "string") {
      const s = x.trim();
      if (!s) return null;
      if (looksLikeDataUrlImage(s)) return { kind: "image", dataUrl: s };
      if (looksLikeDataUrlVideo(s)) return { kind: "video", dataUrl: s };
      if (looksLikeImageUrl(s)) return { kind: "image", url: s };
      if (looksLikeVideoUrl(s)) return { kind: "video", url: s };
      return null;
    }
    if (typeof x !== "object") return null;

    if (typeof x.dataUrl === "string") {
      if (looksLikeDataUrlImage(x.dataUrl)) return { kind: "image", dataUrl: x.dataUrl, mime: x.mime };
      if (looksLikeDataUrlVideo(x.dataUrl)) return { kind: "video", dataUrl: x.dataUrl, mime: x.mime };
    }

    const mediaUrl =
      (x.image_url && typeof x.image_url.url === "string" ? x.image_url.url : null) ||
      (x.video_url && typeof x.video_url.url === "string" ? x.video_url.url : null) ||
      (typeof x.url === "string" ? x.url : null) ||
      (typeof x.imageUrl === "string" ? x.imageUrl : null) ||
      (typeof x.videoUrl === "string" ? x.videoUrl : null) ||
      (typeof x.href === "string" ? x.href : null);

    if (mediaUrl && looksLikeImageUrl(mediaUrl)) return { kind: "image", url: mediaUrl, mime: x.mime };
    if (mediaUrl && looksLikeVideoUrl(mediaUrl)) return { kind: "video", url: mediaUrl, mime: x.mime };
    return null;
  };

  const scan = (list) => {
    const arr = Array.isArray(list) ? list : [];
    for (const item of arr) {
      const got = pick(item);
      if (got) return got;
    }
    return null;
  };

  return (
    pick(inputMedia) ||
    pick(inputVideo) ||
    pick(inputImage) ||
    scan(attachments) ||
    scan(content) ||
    null
  );
}

function extractInputImageFromAny({ inputImage, attachments, content } = {}) {
  const out = extractInputMediaFromAny({ inputImage, attachments, content });
  return out?.kind === "image" ? out : null;
}

function extractInputVideoFromAny({ inputVideo, attachments, content } = {}) {
  const out = extractInputMediaFromAny({ inputVideo, attachments, content });
  return out?.kind === "video" ? out : null;
}

async function fetchInputImageAsBuffer({ dataUrl, url, signal } = {}) {
  return fetchInputMediaAsBuffer({ dataUrl, url, signal, expectedKind: "image" });
}

async function fetchInputMediaAsBuffer({ dataUrl, url, signal, expectedKind = "image" } = {}) {
  const maxBytes =
    Math.max(
      50_000,
      Number.parseInt(
        expectedKind === "video"
          ? process.env.CREATIVE_INPUT_VIDEO_MAX_BYTES || "30000000"
          : process.env.CREATIVE_INPUT_IMAGE_MAX_BYTES || "10000000",
        10
      ) || (expectedKind === "video" ? 30_000_000 : 10_000_000)
    );

  if (dataUrl) {
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) {
      const err = new Error("INVALID_INPUT_IMAGE");
      err.status = 400;
      throw err;
    }
    if (decoded.buf.length > maxBytes) {
      const err = new Error("INPUT_IMAGE_TOO_LARGE");
      err.status = 413;
      err.details = { maxBytes };
      throw err;
    }
    if (expectedKind === "image" && !String(decoded.mime || "").startsWith("image/")) {
      const err = new Error("INPUT_MEDIA_KIND_MISMATCH");
      err.status = 400;
      err.details = { expectedKind, mime: decoded.mime || null };
      throw err;
    }
    if (expectedKind === "video" && !String(decoded.mime || "").startsWith("video/")) {
      const err = new Error("INPUT_MEDIA_KIND_MISMATCH");
      err.status = 400;
      err.details = { expectedKind, mime: decoded.mime || null };
      throw err;
    }
    return { mime: decoded.mime || "image/png", buf: decoded.buf };
  }

  if (!url) {
    const err = new Error("INVALID_INPUT_IMAGE");
    err.status = 400;
    throw err;
  }

  const u = String(url).trim();
  const base = getPublicApiBaseUrl();

  // SSRF guard:
  // - We only allow fetching images from our own public origin by default.
  // - This keeps "image-to-image" safe without turning the backend into a generic URL fetcher.
  // - If you explicitly need external URLs (e.g. Cloudinary), set CREATIVE_INPUT_IMAGE_ALLOWED_HOSTS
  //   to a comma-separated list of hostnames (exact match).
  function allowedHostsFromEnv() {
    return String(process.env.CREATIVE_INPUT_IMAGE_ALLOWED_HOSTS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function getHostnameSafe(rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      return String(parsed.hostname || "").toLowerCase();
    } catch {
      return "";
    }
  }

  const absolute = (() => {
    if (u.startsWith("http://") || u.startsWith("https://")) return u;
    return `${base}${u.startsWith("/") ? "" : "/"}${u}`;
  })();

  try {
    const target = new URL(absolute);
    const baseUrl = new URL(base);

    const targetHost = String(target.hostname || "").toLowerCase();
    const baseHost = String(baseUrl.hostname || "").toLowerCase();

    const extraAllowed = new Set(allowedHostsFromEnv());
    const isAllowedHost = targetHost === baseHost || extraAllowed.has(targetHost);

    if (!isAllowedHost) {
      const err = new Error("INPUT_IMAGE_REMOTE_URL_NOT_ALLOWED");
      err.status = 400;
      err.details = { host: targetHost, allowedHosts: [baseHost, ...Array.from(extraAllowed)].slice(0, 20) };
      throw err;
    }
  } catch (e) {
    if (e?.message === "INPUT_IMAGE_REMOTE_URL_NOT_ALLOWED") throw e;
    // If URL parsing fails, treat as invalid input.
    const err = new Error("INVALID_INPUT_IMAGE_URL");
    err.status = 400;
    err.details = { url: absolute, host: getHostnameSafe(absolute) || null };
    throw err;
  }

  const resp = await fetch(absolute, { method: "GET", signal });
  if (!resp.ok) {
    const err = new Error("INPUT_IMAGE_FETCH_FAILED");
    err.status = 400;
    err.details = { url: absolute, status: resp.status };
    throw err;
  }

  const lenHeader = resp.headers.get("content-length");
  const len = lenHeader ? Number.parseInt(lenHeader, 10) : NaN;
  if (Number.isFinite(len) && len > maxBytes) {
    const err = new Error("INPUT_IMAGE_TOO_LARGE");
    err.status = 413;
    err.details = { maxBytes };
    throw err;
  }

  const mime = resp.headers.get("content-type") || "image/png";
  const ab = await resp.arrayBuffer();
  const buf = Buffer.from(ab);
  if (buf.length > maxBytes) {
    const err = new Error("INPUT_IMAGE_TOO_LARGE");
    err.status = 413;
    err.details = { maxBytes };
    throw err;
  }

  if (expectedKind === "image" && !String(mime || "").startsWith("image/")) {
    const err = new Error("INPUT_MEDIA_KIND_MISMATCH");
    err.status = 400;
    err.details = { expectedKind, mime };
    throw err;
  }
  if (expectedKind === "video" && !String(mime || "").startsWith("video/")) {
    const err = new Error("INPUT_MEDIA_KIND_MISMATCH");
    err.status = 400;
    err.details = { expectedKind, mime };
    throw err;
  }

  return { mime, buf };
}

function buildImg2ImgEditPrompt(userPrompt) {
  const p = String(userPrompt || "").trim();

  return [
    "Edit the provided image. Use the input image as the primary source, not as loose inspiration.",
    "Keep the same main subject and overall identity unless the user explicitly asks to change them.",
    "Keep the same background, framing, camera angle, lighting, and composition unless the user explicitly asks to change them.",
    "Do not invent body changes, age changes, extra people, extra objects, text, logos, or scene changes unless explicitly requested.",
    "Apply only the requested edit.",
    "If the request is broad or stylistic, make a subtle enhancement rather than a major transformation.",
    `User request: ${p || "No change."}`,
  ].join("\n");
}

function buildGrokImg2ImgPrompt(userPrompt) {
  const p = String(userPrompt || "").trim();
  // xAI applies an internal prompt-rewrite. Keeping this short improves adherence to the input image.
  // Avoid long bullet lists that the rewriter may collapse into a generic text-to-image prompt.
  return (
    "Edit the input image (do not generate a new image). Keep the same main subject and same scene unless the user explicitly asks to change them. " +
    "If the request is broad or stylistic, make a subtle enhancement. Apply only this change: " +
    (p || "No change.")
  ).trim();
}

function resolveCreativeVideoRemoteModel(model, inputKind) {
  if (!model) return "";
  const modeKey = inputKind === "video" ? "video" : inputKind === "image" ? "image" : "text";
  const byMode = model.remoteByMode && typeof model.remoteByMode === "object" ? model.remoteByMode : null;
  if (byMode && typeof byMode[modeKey] === "string" && byMode[modeKey].trim()) {
    return byMode[modeKey].trim();
  }
  return String(model.remoteModel || "").trim();
}

async function generateImage({ userId, plan, modelId, prompt, size, inputImage, attachments, content, signal }) {
  const normalizedPlan = normalizePlan(plan);
  const creditCost = getCreativeModelCreditCost(modelId);

  const model = getCreativeModel(modelId);
  if (!model) {
    const err = new Error("UNKNOWN_CREATIVE_MODEL");
    err.status = 400;
    err.details = { modelId };
    throw err;
  }

  if (model.type !== "image") {
    const err = new Error("CREATIVE_MODEL_TYPE_MISMATCH");
    err.status = 400;
    err.details = { modelId, type: model.type };
    throw err;
  }

  if (!model.implemented) {
    const err = new Error("CREATIVE_MODEL_NOT_IMPLEMENTED");
    err.status = 501;
    err.details = { modelId, provider: model.provider };
    throw err;
  }

  const provider = getProvider(model.provider);
  if (!provider || typeof provider.generateImage !== "function") {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: model.provider };
    throw err;
  }

  const input = extractInputImageFromAny({ inputImage, attachments, content });
  const wantsImageToImage = Boolean(input);
  const seedreamImg2ImgFallbackModel =
    wantsImageToImage && model.provider === "seedream" && model.id === "seedream-5-lite"
      ? getCreativeModel("seedream-4.5")
      : null;
  const initialRemoteModel =
    seedreamImg2ImgFallbackModel?.provider === "seedream" && seedreamImg2ImgFallbackModel?.remoteModel
      ? seedreamImg2ImgFallbackModel.remoteModel
      : model.remoteModel;
  const initialFallbackFrom = initialRemoteModel !== model.remoteModel ? model.remoteModel : null;

  // Hard daily cost protection (simple in-memory guardrail).
  // Run this before monthly consumption so users aren't charged for blocked requests.
  assertDailyLimitOrThrow("image");

  // Paid plans now consume creative credits. FREE keeps the previous simple generation cap
  // until the credit UI/flows are fully rolled out end-to-end.
  let consumed = false;
  let consumedCredits = 0;
  if (isPaidPlan(normalizedPlan)) {
    const usage = await planService.assertAndConsumeCreativeCredits({
      userId,
      plan: normalizedPlan,
      modelId,
      credits: creditCost,
    });
    consumedCredits = usage?.requested || creditCost || 0;
  } else {
    await planService.assertAndConsumeCreativeGeneration({ userId });
  }
  consumed = true;

  const startedAt = Date.now();
  const reqRow = await createAIRequest({
    userId,
    mode: wantsImageToImage ? "creative_studio_img2img" : "creative_studio",
    provider: model.provider,
    model: initialRemoteModel,
  });

  await updateAIRequest(reqRow.id, { status: "running" });

  try {
    let usedRemoteModel = initialRemoteModel;
    let fallbackFrom = initialFallbackFrom;
    let out = null;
    let preparedInput = null;
    let inputImageUrl = null;

    try {
      if (wantsImageToImage) {
        preparedInput = await fetchInputImageAsBuffer({
          dataUrl: input?.dataUrl,
          url: input?.url,
          signal,
        });

        // Some providers require a publicly reachable URL for img2img. If the app is configured
        // with a public base URL (not localhost), persist the input image and pass a URL.
        if (model.provider === "grok" || model.provider === "seedream") {
          const baseUrl = getPublicApiBaseUrl();
          if (isPublicUrlForProviders(baseUrl)) {
            inputImageUrl = await persistInputImageForRemoteFetch({
              mime: preparedInput.mime,
              buf: preparedInput.buf,
              requestId: reqRow.id,
            });
          }
        }

        if (typeof provider.transformImage !== "function") {
          const err = new Error("IMG2IMG_NOT_SUPPORTED");
          err.status = 501;
          err.details = { provider: model.provider, modelId: model.id };
          throw err;
        }

        out = await runInProviderQueue(
          model.provider,
          ({ signal: qSignal }) =>
            provider.transformImage({
              remoteModel: usedRemoteModel,
              prompt: model.provider === "grok" ? buildGrokImg2ImgPrompt(prompt) : buildImg2ImgEditPrompt(prompt),
              size,
              inputImage: preparedInput.buf,
              inputMime: preparedInput.mime,
              inputImageUrl,
              signal: qSignal,
            }),
          { type: "image", plan: normalizedPlan, signal, maxRetries: 1 }
        );
      } else {
        out = await runInProviderQueue(
          model.provider,
          ({ signal: qSignal }) =>
            provider.generateImage({
              remoteModel: usedRemoteModel,
              prompt,
              size,
              signal: qSignal,
            }),
          { type: "image", plan: normalizedPlan, signal, maxRetries: 1 }
        );
      }
    } catch (e) {
      // OpenAI image model ids (and access) vary by account/project. If the model isn't
      // available, retry with a configurable fallback chain (e.g. DALL·E).
      const isOpenAI = model.provider === "openai";
      const isUnavailable = isModelUnavailableError(e);

      if (!isOpenAI || !isUnavailable) throw e;

      const candidates = await getOpenAIImageFallbackCandidates({
        provider,
        primaryRemoteModel: usedRemoteModel,
        signal,
      });

      if (!candidates.length) throw e;

      let lastErr = e;
      for (const candidate of candidates) {
        try {
          if (!fallbackFrom) fallbackFrom = usedRemoteModel;
          usedRemoteModel = candidate;

          // Keep request logs accurate.
          await updateAIRequest(reqRow.id, { model: usedRemoteModel });

          if (wantsImageToImage) {
            if (typeof provider.transformImage !== "function") {
              const err = new Error("IMG2IMG_NOT_SUPPORTED");
              err.status = 501;
              err.details = { provider: model.provider, modelId: model.id };
              throw err;
            }

            out = await runInProviderQueue(
              model.provider,
              ({ signal: qSignal }) =>
                provider.transformImage({
                  remoteModel: usedRemoteModel,
                  prompt: buildImg2ImgEditPrompt(prompt),
                  size,
                  inputImage: preparedInput.buf,
                  inputMime: preparedInput.mime,
                  inputImageUrl,
                  signal: qSignal,
                }),
              { type: "image", plan: normalizedPlan, signal, maxRetries: 1 }
            );
          } else {
            out = await runInProviderQueue(
              model.provider,
              ({ signal: qSignal }) =>
                provider.generateImage({
                  remoteModel: usedRemoteModel,
                  prompt,
                  size,
                  signal: qSignal,
                }),
              { type: "image", plan: normalizedPlan, signal, maxRetries: 1 }
            );
          }

          lastErr = null;
          break;
        } catch (e2) {
          lastErr = e2;
          // Only keep trying on "unavailable model" style errors.
          if (!isModelUnavailableError(e2)) break;
        }
      }

      if (lastErr) throw lastErr;
    }

    // Persist generated image bytes to disk and return stable URLs so the frontend can
    // store them in chat history without dumping base64 into Message.content.
    const persistedImages = await persistGeneratedImages({
      images: out?.images || [],
      requestId: reqRow.id,
    });

    const estimatedCostUsd = estimateCreativeCostUsd({
      modelId: model.id,
      remoteModel: usedRemoteModel,
      provider: model.provider,
      size,
      imageCount: persistedImages.length,
    });
    const latencyMs = Date.now() - startedAt;
    const budgetWindowStart = getUtcMonthStart(new Date(startedAt));

    await updateAIRequest(reqRow.id, {
      status: "succeeded",
      latencyMs,
      errorCode: null,
      errorMessage: null,
      estimatedCostUsd,
    });

    await refreshMonthlyCreativeBudgetSummary({
      userId,
      normalizedPlan,
      periodStart: budgetWindowStart,
    });

    return {
      requestId: reqRow.id,
      plan: normalizedPlan,
      creditCost,
      provider: model.provider,
      model: model.id,
      remoteModel: usedRemoteModel,
      fallbackFrom,
      estimatedCostUsd,
      images: persistedImages,
      revisedPrompt: out?.revisedPrompt || null,
    };
  } catch (e) {
    // If the provider isn't configured (missing API key/base URL), refund the generation so users
    // don't burn quota due to admin/config mistakes.
    if (consumed && (e?.message === "PROVIDER_NOT_CONFIGURED" || e?.status === 501)) {
      try {
        if (isPaidPlan(normalizedPlan)) {
          await planService.refundCreativeCredits({ userId, credits: consumedCredits || creditCost });
        } else {
          await planService.refundCreativeGeneration({ userId });
        }
      } catch {
        // ignore refund failures
      }
    }

    await updateAIRequest(reqRow.id, {
      status: "failed",
      latencyMs: Date.now() - startedAt,
      errorCode: e?.message || "ERROR",
      errorMessage: String(e?.details?.body || e?.details?.missing || e?.message || "ERROR").slice(0, 1000),
    });
    throw e;
  }
}

async function generateVideo({ userId, plan, conversationId, modelId, prompt, size, inputImage, inputVideo, attachments, content, signal }) {
  const normalizedPlan = normalizePlan(plan);
  const creditCost = getCreativeModelCreditCost(modelId);

  const model = getCreativeModel(modelId);
  if (!model) {
    const err = new Error("UNKNOWN_CREATIVE_MODEL");
    err.status = 400;
    err.details = { modelId };
    throw err;
  }

  if (model.type !== "video") {
    const err = new Error("CREATIVE_MODEL_TYPE_MISMATCH");
    err.status = 400;
    err.details = { modelId, type: model.type };
    throw err;
  }

  if (!model.implemented) {
    const err = new Error("CREATIVE_MODEL_NOT_IMPLEMENTED");
    err.status = 501;
    err.details = { modelId, provider: model.provider };
    throw err;
  }

  const provider = getProvider(model.provider);
  if (!provider || typeof provider.generateVideo !== "function") {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: model.provider };
    throw err;
  }

  const inputMedia =
    extractInputVideoFromAny({ inputVideo, attachments, content }) ||
    extractInputImageFromAny({ inputImage, attachments, content });
  const inputKind = inputMedia?.kind || (inputMedia && inputMedia.dataUrl ? (String(inputMedia.dataUrl).startsWith("data:video/") ? "video" : "image") : null);
  const usedRemoteModel = resolveCreativeVideoRemoteModel(model, inputKind);

  let consumed = false;
  let consumedCredits = 0;
  if (isPaidPlan(normalizedPlan)) {
    const usage = await planService.assertAndConsumeCreativeCredits({
      userId,
      plan: normalizedPlan,
      modelId,
      credits: creditCost,
    });
    consumedCredits = usage?.requested || creditCost || 0;
  } else {
    await planService.assertAndConsumeCreativeGeneration({ userId });
  }
  consumed = true;

  const startedAt = Date.now();
  const reqRow = await createAIRequest({
    userId,
    mode:
      inputKind === "video"
        ? "creative_studio_v2v"
        : inputKind === "image"
          ? "creative_studio_i2v"
          : "creative_studio_video",
    provider: model.provider,
    model: usedRemoteModel,
  });

  await updateAIRequest(reqRow.id, { status: "running" });

  try {
    let preparedInput = null;
    let inputImageUrl = null;
    let inputVideoUrl = null;

    if (inputMedia) {
      preparedInput = await fetchInputMediaAsBuffer({
        dataUrl: inputMedia.dataUrl,
        url: inputMedia.url,
        signal,
        expectedKind: inputKind === "video" ? "video" : "image",
      });

      if (inputKind === "video") {
        const baseUrl = getPublicApiBaseUrl();
        if (isPublicUrlForProviders(baseUrl)) {
          inputVideoUrl = await persistInputMediaForRemoteFetch({
            mime: preparedInput.mime,
            buf: preparedInput.buf,
            requestId: reqRow.id,
            kind: "video",
          });
        }
      } else if (inputKind === "image") {
        const baseUrl = getPublicApiBaseUrl();
        if (isPublicUrlForProviders(baseUrl)) {
          inputImageUrl = await persistInputMediaForRemoteFetch({
            mime: preparedInput.mime,
            buf: preparedInput.buf,
            requestId: reqRow.id,
            kind: "image",
          });
        }
      }
    }

    const out = await runInProviderQueue(
      model.provider,
      ({ signal: qSignal }) =>
        provider.generateVideo({
          remoteModel: usedRemoteModel,
          prompt,
          size,
          inputImage: inputKind === "image" ? preparedInput?.buf : null,
          inputImageMime: inputKind === "image" ? preparedInput?.mime : null,
          inputImageUrl,
          inputVideo: inputKind === "video" ? preparedInput?.buf : null,
          inputVideoMime: inputKind === "video" ? preparedInput?.mime : null,
          inputVideoUrl,
          signal: qSignal,
        }),
      { type: "video", plan: normalizedPlan, signal, maxRetries: 1 }
    );

    const persistedVideos = await persistGeneratedVideos({
      videos: out?.videos || [],
      requestId: reqRow.id,
    });
    console.info("[creative-video] completed", {
      requestId: reqRow.id,
      provider: model.provider,
      modelId: model.id,
      remoteModel: usedRemoteModel,
      returnedVideos: Array.isArray(out?.videos) ? out.videos.length : 0,
      persistedVideos: persistedVideos.length,
      firstVideoUrl: persistedVideos?.[0]?.url || null,
    });
    let persistedMessage = null;
    if (conversationId && persistedVideos.length > 0) {
      try {
        persistedMessage = await conversationService.addMessage({
          userId,
          conversationId,
          role: "assistant",
          content: "Video generated.",
          attachments: persistedVideos.map((video, index) => ({
            id: `${reqRow.id}-video-${index + 1}`,
            name: `video-${index + 1}.mp4`,
            type: video?.mime || "video/mp4",
            isVideo: true,
            isImage: false,
            url: video?.url || null,
            previewUrl: video?.url || null,
          })),
        });
      } catch (persistErr) {
        console.error("[creative-video] message persist error", {
          requestId: reqRow.id,
          conversationId,
          message: persistErr?.message || String(persistErr),
        });
      }
    }

    const estimatedCostUsd = estimateCreativeCostUsd({
      modelId: model.id,
      remoteModel: usedRemoteModel,
      provider: model.provider,
      size,
    });
    const latencyMs = Date.now() - startedAt;
    const budgetWindowStart = getUtcMonthStart(new Date(startedAt));

    await updateAIRequest(reqRow.id, {
      status: "succeeded",
      latencyMs,
      errorCode: null,
      errorMessage: null,
      estimatedCostUsd,
    });

    await refreshMonthlyCreativeBudgetSummary({
      userId,
      normalizedPlan,
      periodStart: budgetWindowStart,
    });

    return {
      requestId: reqRow.id,
      plan: normalizedPlan,
      creditCost,
      provider: model.provider,
      model: model.id,
      remoteModel: usedRemoteModel,
      estimatedCostUsd,
      videos: persistedVideos,
      message: persistedMessage,
    };
  } catch (e) {
    if (consumed && (e?.message === "PROVIDER_NOT_CONFIGURED" || e?.status === 501)) {
      try {
        if (isPaidPlan(normalizedPlan)) {
          await planService.refundCreativeCredits({ userId, credits: consumedCredits || creditCost });
        } else {
          await planService.refundCreativeGeneration({ userId });
        }
      } catch {
        // ignore refund failures
      }
    }

    await updateAIRequest(reqRow.id, {
      status: "failed",
      latencyMs: Date.now() - startedAt,
      errorCode: e?.message || "ERROR",
      errorMessage: String(e?.details?.body || e?.details?.message || e?.message || "ERROR").slice(0, 1000),
    });
    throw e;
  }
}

async function generateMusic({ userId, plan, conversationId, modelId, prompt, inputImage, attachments, content, signal }) {
  const normalizedPlan = normalizePlan(plan);
  const creditCost = getCreativeModelCreditCost(modelId);

  const model = getCreativeModel(modelId);
  if (!model) {
    const err = new Error("UNKNOWN_CREATIVE_MODEL");
    err.status = 400;
    err.details = { modelId };
    throw err;
  }

  if (model.type !== "music") {
    const err = new Error("CREATIVE_MODEL_TYPE_MISMATCH");
    err.status = 400;
    err.details = { modelId, type: model.type };
    throw err;
  }

  if (!model.implemented) {
    const err = new Error("CREATIVE_MODEL_NOT_IMPLEMENTED");
    err.status = 501;
    err.details = { modelId, provider: model.provider };
    throw err;
  }

  const provider = getProvider(model.provider);
  if (!provider || typeof provider.generateMusic !== "function") {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: model.provider };
    throw err;
  }

  const input = extractInputImageFromAny({ inputImage, attachments, content });

  let consumed = false;
  let consumedCredits = 0;
  if (isPaidPlan(normalizedPlan)) {
    const usage = await planService.assertAndConsumeCreativeCredits({
      userId,
      plan: normalizedPlan,
      modelId,
      credits: creditCost,
    });
    consumedCredits = usage?.requested || creditCost || 0;
  } else {
    await planService.assertAndConsumeCreativeGeneration({ userId });
  }
  consumed = true;

  const startedAt = Date.now();
  const reqRow = await createAIRequest({
    userId,
    mode: input ? "creative_studio_music_from_image" : "creative_studio_music",
    provider: model.provider,
    model: model.remoteModel,
  });

  await updateAIRequest(reqRow.id, { status: "running" });

  try {
    let preparedInput = null;
    if (input) {
      preparedInput = await fetchInputImageAsBuffer({
        dataUrl: input.dataUrl,
        url: input.url,
        signal,
      });
    }

    const out = await runInProviderQueue(
      model.provider,
      ({ signal: qSignal }) =>
        provider.generateMusic({
          remoteModel: model.remoteModel,
          prompt,
          inputImage: preparedInput?.buf || null,
          inputImageMime: preparedInput?.mime || null,
          signal: qSignal,
        }),
      { type: "video", plan: normalizedPlan, signal, maxRetries: 1 }
    );

    const persistedAudios = await persistGeneratedAudios({
      audios: out?.audios || [],
      requestId: reqRow.id,
    });

    let persistedMessage = null;
    if (conversationId && persistedAudios.length > 0) {
      try {
        persistedMessage = await conversationService.addMessage({
          userId,
          conversationId,
          role: "assistant",
          content: out?.text || "Music generated.",
          attachments: persistedAudios.map((audio, index) => ({
            id: `${reqRow.id}-audio-${index + 1}`,
            name: `music-${index + 1}.${extFromMime(audio?.mime || "audio/mpeg")}`,
            type: audio?.mime || "audio/mpeg",
            isAudio: true,
            isImage: false,
            isVideo: false,
            url: audio?.url || null,
            previewUrl: audio?.url || null,
          })),
        });
      } catch (persistErr) {
        console.error("[creative-music] message persist error", {
          requestId: reqRow.id,
          conversationId,
          message: persistErr?.message || String(persistErr),
        });
      }
    }

    const estimatedCostUsd = estimateCreativeCostUsd({
      modelId: model.id,
      remoteModel: model.remoteModel,
      provider: model.provider,
    });
    const latencyMs = Date.now() - startedAt;
    const budgetWindowStart = getUtcMonthStart(new Date(startedAt));

    await updateAIRequest(reqRow.id, {
      status: "succeeded",
      latencyMs,
      errorCode: null,
      errorMessage: null,
      estimatedCostUsd,
    });

    await refreshMonthlyCreativeBudgetSummary({
      userId,
      normalizedPlan,
      periodStart: budgetWindowStart,
    });

    return {
      requestId: reqRow.id,
      plan: normalizedPlan,
      creditCost,
      provider: model.provider,
      model: model.id,
      remoteModel: model.remoteModel,
      estimatedCostUsd,
      audios: persistedAudios,
      text: out?.text || null,
      message: persistedMessage,
    };
  } catch (e) {
    if (consumed && (e?.message === "PROVIDER_NOT_CONFIGURED" || e?.status === 501)) {
      try {
        if (isPaidPlan(normalizedPlan)) {
          await planService.refundCreativeCredits({ userId, credits: consumedCredits || creditCost });
        } else {
          await planService.refundCreativeGeneration({ userId });
        }
      } catch {
        // ignore refund failures
      }
    }

    await updateAIRequest(reqRow.id, {
      status: "failed",
      latencyMs: Date.now() - startedAt,
      errorCode: e?.message || "ERROR",
      errorMessage: String(e?.details?.body || e?.details?.message || e?.message || "ERROR").slice(0, 1000),
    });
    throw e;
  }
}

module.exports = {
  generateImage,
  generateVideo,
  generateMusic,
};
