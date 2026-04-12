function requireEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (value) return value;
  const err = new Error("PROVIDER_NOT_CONFIGURED");
  err.status = 501;
  err.details = { provider: "atlascloud", missing: name };
  throw err;
}

function normalizeBaseUrl(raw) {
  const value = String(raw || "").trim().replace(/\/$/, "");
  if (!value) return "https://api.atlascloud.ai/api/v1";
  if (/\/api\/v1$/i.test(value)) return value;
  return `${value}/api/v1`;
}

function buildProviderError({ status, text, endpoint, modelId, taskId } = {}) {
  let code = "PROVIDER_ERROR";
  let message = "";
  try {
    const json = JSON.parse(String(text || "{}"));
    const payload = json?.data || json;
    code = payload?.error?.code || payload?.code || code;
    message = payload?.error?.message || payload?.error || payload?.message || "";
  } catch {
    // ignore
  }

  const err = new Error(code || "PROVIDER_ERROR");
  err.status = status || 500;
  err.details = {
    provider: "atlascloud",
    endpoint: endpoint || null,
    modelId: modelId || null,
    taskId: taskId || null,
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };
  console.error("[atlascloud] error", {
    status: err.status,
    endpoint: err.details.endpoint,
    modelId: err.details.modelId,
    taskId: err.details.taskId,
    code: err.details.code,
    message: err.details.message,
    body: err.details.body,
  });
  return err;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      const err = new Error("AbortError");
      err.name = "AbortError";
      reject(err);
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function firstUrlCandidate(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = firstUrlCandidate(item);
      if (candidate) return candidate;
    }
    return null;
  }
  if (typeof value === "object") {
    return (
      firstUrlCandidate(value.video_url) ||
      firstUrlCandidate(value.videoUrl) ||
      firstUrlCandidate(value.file_url) ||
      firstUrlCandidate(value.fileUrl) ||
      firstUrlCandidate(value.download_url) ||
      firstUrlCandidate(value.downloadUrl) ||
      firstUrlCandidate(value.url) ||
      firstUrlCandidate(value.get) ||
      firstUrlCandidate(value.download) ||
      firstUrlCandidate(value.src) ||
      null
    );
  }
  return null;
}

async function fetchJsonWithFallback({ urls, apiKey, modelId, taskId, signal }) {
  let lastError = null;
  for (const endpoint of urls) {
    const resp = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
    });

    if (resp.ok) {
      const json = await resp.json().catch(() => ({}));
      return { endpoint, json };
    }

    const text = await resp.text().catch(() => "");
    const err = buildProviderError({ status: resp.status, text, endpoint, modelId, taskId });
    lastError = err;

    // AtlasCloud docs are inconsistent here; try the alternate result endpoint on 404.
    if (resp.status !== 404) throw err;
  }

  throw lastError || new Error("PROVIDER_ERROR");
}

function inferVideoSpec(size) {
  const raw = String(size || "").trim().toLowerCase();
  if (!raw || raw === "medium") {
    return { size: "1280*720", aspectRatio: "16:9", duration: 5, fps: 24 };
  }
  if (raw === "small") {
    return { size: "720*1280", aspectRatio: "9:16", duration: 5, fps: 24 };
  }
  if (raw === "large") {
    return { size: "1280*720", aspectRatio: "16:9", duration: 10, fps: 24 };
  }

  const match = raw.match(/^(\d+)\s*x\s*(\d+)$/);
  if (!match) {
    return { size: "1280*720", aspectRatio: "16:9", duration: 5, fps: 24 };
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { size: "1280*720", aspectRatio: "16:9", duration: 5, fps: 24 };
  }

  return {
    size: `${Math.max(256, Math.min(1920, Math.round(width)))}*${Math.max(256, Math.min(1920, Math.round(height)))}`,
    aspectRatio: width === height ? "1:1" : width > height ? "16:9" : "9:16",
    duration: 5,
    fps: 24,
  };
}

function inferWanResolution(size) {
  const raw = String(size || "").trim().toLowerCase();
  if (!raw || raw === "medium" || raw === "small") return "720P";
  if (raw === "large") return "1080P";

  const match = raw.match(/^(\d+)\s*x\s*(\d+)$/);
  if (!match) return "720P";

  const width = Number(match[1]);
  const height = Number(match[2]);
  const maxSide = Math.max(width, height);
  return maxSide > 1280 ? "1080P" : "720P";
}

function resolveAtlasVideoTimeoutMs(modelId) {
  const rawModelId = String(modelId || "").trim().toLowerCase();
  const fromEnv = (name) => {
    const parsed = Number.parseInt(String(process.env[name] || ""), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  if (rawModelId.includes("/wan-2.6/")) {
    return (
      fromEnv("ATLASCLOUD_WAN_VIDEO_TIMEOUT_MS") ||
      fromEnv("ATLASCLOUD_VIDEO_TIMEOUT_MS") ||
      fromEnv("CREATIVE_VIDEO_TIMEOUT_MS") ||
      540_000
    );
  }

  return (
    fromEnv("ATLASCLOUD_VIDEO_TIMEOUT_MS") ||
    fromEnv("CREATIVE_VIDEO_TIMEOUT_MS") ||
    420_000
  );
}

async function uploadMedia({ baseUrl, apiKey, inputBuffer, inputMime, kind = "image", signal }) {
  if (!inputBuffer) return null;

  const form = new FormData();
  const mime = String(inputMime || (kind === "video" ? "video/mp4" : "image/png"));
  const ext = mime.includes("jpeg") || mime.includes("jpg")
    ? "jpg"
    : mime.includes("webp")
      ? "webp"
      : mime.includes("mp4")
        ? "mp4"
        : mime.includes("webm")
          ? "webm"
          : mime.includes("quicktime") || mime.includes("mov")
            ? "mov"
            : "png";
  form.append("file", new Blob([inputBuffer], { type: mime }), `creative-input.${ext}`);

  const endpoint = `${baseUrl}/model/uploadMedia`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text, endpoint });
  }

  const json = await resp.json().catch(() => ({}));
  const uploadedUrl = json?.url || json?.data?.url || json?.data?.download_url || json?.download_url || null;
  if (!uploadedUrl) {
    const err = new Error("UPLOAD_URL_MISSING");
    err.status = 502;
    err.details = { provider: "atlascloud", endpoint };
    throw err;
  }

  return String(uploadedUrl);
}

async function generateVideo({
  remoteModel,
  prompt,
  size,
  inputImage,
  inputImageMime,
  inputImageUrl,
  inputVideo,
  inputVideoMime,
  inputVideoUrl,
  signal,
} = {}) {
  const apiKey = requireEnv("ATLASCLOUD_API_KEY");
  const baseUrl = normalizeBaseUrl(process.env.ATLASCLOUD_BASE_URL);
  const modelId = String(remoteModel || "").trim();

  if (!modelId) {
    const err = new Error("MODEL_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "atlascloud" };
    throw err;
  }

  const lowerModel = modelId.toLowerCase();
  const isKling = lowerModel.includes("kling");
  const isLuma = lowerModel.includes("luma/");
  const isVidu = lowerModel.includes("vidu/");
  const isWan = lowerModel.includes("/wan-2.6/");
  const isHailuo = lowerModel.includes("minimax/hailuo-2.3/");

  if ((inputVideo || inputVideoUrl) && !isVidu) {
    const err = new Error("VIDEO_TO_VIDEO_NOT_SUPPORTED");
    err.status = 400;
    err.details = { provider: "atlascloud", model: modelId };
    throw err;
  }

  const imageMediaUrl =
    inputImageUrl ||
    (inputImage
      ? await uploadMedia({
          baseUrl,
          apiKey,
          inputBuffer: inputImage,
          inputMime: inputImageMime,
          kind: "image",
          signal,
        })
      : null);
  const videoMediaUrl =
    inputVideoUrl ||
    (inputVideo
      ? await uploadMedia({
          baseUrl,
          apiKey,
          inputBuffer: inputVideo,
          inputMime: inputVideoMime,
          kind: "video",
          signal,
        })
      : null);

  const spec = inferVideoSpec(size);
  const endpoint = `${baseUrl}/model/generateVideo`;
  const payload = {
    model: modelId,
  };
  const trimmedPrompt = String(prompt || "").trim();
  if (trimmedPrompt) payload.prompt = trimmedPrompt;

  if (imageMediaUrl) {
    payload.image = imageMediaUrl;
    payload.image_url = imageMediaUrl;
  }
  if (videoMediaUrl) {
    payload.video = videoMediaUrl;
    payload.video_url = videoMediaUrl;
  }

  if (isKling) {
    payload.duration = spec.duration;
    if (!imageMediaUrl && !videoMediaUrl) payload.aspect_ratio = spec.aspectRatio;
  } else if (isWan) {
    payload.duration = spec.duration;
    payload.resolution = inferWanResolution(size);
    if (!imageMediaUrl && !videoMediaUrl) payload.aspect_ratio = spec.aspectRatio;
  } else if (isHailuo) {
    payload.duration = spec.duration;
    if (!imageMediaUrl && !videoMediaUrl) payload.aspect_ratio = spec.aspectRatio;
  } else if (isLuma) {
    payload.size = spec.size;
    payload.duration = String(spec.duration);
  } else if (isVidu) {
    payload.duration = spec.duration;
    if (!imageMediaUrl && !videoMediaUrl) {
      payload.aspect_ratio = spec.aspectRatio;
    }
  } else {
    payload.duration = spec.duration;
  }

  const createResp = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!createResp.ok) {
    const text = await createResp.text().catch(() => "");
    throw buildProviderError({ status: createResp.status, text, endpoint, modelId });
  }

  const created = await createResp.json().catch(() => ({}));
  const taskId = created?.predictionId || created?.id || created?.data?.id || null;
  if (!taskId) {
    const err = new Error("VIDEO_TASK_ID_MISSING");
    err.status = 502;
    err.details = { provider: "atlascloud", model: modelId };
    throw err;
  }

  const pollUrls = [
    `${baseUrl}/model/result/${encodeURIComponent(taskId)}`,
    `${baseUrl}/model/getResult?predictionId=${encodeURIComponent(taskId)}`,
  ];
  const timeoutMs = Math.max(30_000, resolveAtlasVideoTimeoutMs(modelId));
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      const err = new Error("VIDEO_GENERATION_TIMEOUT");
      err.status = 504;
      err.details = { provider: "atlascloud", model: modelId, taskId };
      throw err;
    }

    const { endpoint: pollEndpoint, json } = await fetchJsonWithFallback({
      urls: pollUrls,
      apiKey,
      modelId,
      taskId,
      signal,
    });
    const data = json?.data || json || {};
    const status = String(data?.status || "").trim().toLowerCase();

    if (status === "failed" || status === "canceled" || status === "cancelled") {
      throw buildProviderError({ status: 502, text: JSON.stringify(json), endpoint: pollEndpoint, modelId, taskId });
    }

    if (status !== "completed" && status !== "succeeded") {
      await sleep(3000, signal);
      continue;
    }

    const videoUrl =
      firstUrlCandidate(data?.output) ||
      firstUrlCandidate(data?.outputs) ||
      firstUrlCandidate(data?.urls) ||
      firstUrlCandidate(json?.urls) ||
      firstUrlCandidate(data?.artifacts) ||
      firstUrlCandidate(data?.url) ||
      firstUrlCandidate(json?.output) ||
      firstUrlCandidate(json?.outputs) ||
      firstUrlCandidate(json?.artifacts) ||
      firstUrlCandidate(json?.url) ||
      null;
    if (!videoUrl) {
      const err = new Error("EMPTY_VIDEO_RESPONSE");
      err.status = 502;
      err.details = { provider: "atlascloud", model: modelId, taskId };
      throw err;
    }

    return {
      videos: [{ mime: "video/mp4", url: String(videoUrl) }],
      providerMeta: {
        taskId,
        predictTime: data?.metrics?.predict_time || null,
      },
    };
  }
}

module.exports = {
  generateVideo,
};
