function requireAnyEnv(names) {
  for (const name of names) {
    const v = process.env[name];
    if (v) return { name, value: v };
  }
  const err = new Error("PROVIDER_NOT_CONFIGURED");
  err.status = 501;
  err.details = { provider: "seedance", missingAnyOf: names };
  throw err;
}

function normalizeApiKey(raw) {
  return String(raw || "").trim().replace(/^Bearer\s+/i, "").trim();
}

function normalizeBaseUrl(raw) {
  const b = String(raw || "").trim().replace(/\/$/, "");
  if (b) return b;
  return "https://ark.ap-southeast.bytepluses.com/api/v3";
}

function buildProviderError({ status, text, endpoint, modelId, taskId } = {}) {
  let code = "PROVIDER_ERROR";
  let message = "";
  try {
    const j = JSON.parse(String(text || "{}"));
    code = j?.error?.code || j?.code || code;
    message = j?.error?.message || j?.message || "";
  } catch {
    // ignore
  }

  const err = new Error(code || "PROVIDER_ERROR");
  err.status = status || 500;
  err.details = {
    provider: "seedance",
    endpoint: endpoint || null,
    modelId: modelId || null,
    taskId: taskId || null,
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };
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

function normalizeRemoteModel(remoteModel) {
  const raw = String(remoteModel || "").trim();
  if (!raw) return "seedance-1-5-pro-251215";
  const key = raw.toLowerCase();
  const aliases = {
    "seedance-2": "seedance-1-5-pro-251215",
    "seedance-2.0": "seedance-1-5-pro-251215",
    "seedance": "seedance-1-5-pro-251215",
    "seedance-1.5": "seedance-1-5-pro-251215",
    "seedance-1.5-pro": "seedance-1-5-pro-251215",
  };
  return aliases[key] || raw;
}

function inferVideoSpec(size) {
  const raw = String(size || "").trim().toLowerCase();
  if (raw === "small") return { resolution: "480p", ratio: "1:1" };
  if (raw === "medium") return { resolution: "720p", ratio: "16:9" };
  if (raw === "large") return { resolution: "1080p", ratio: "16:9" };

  const match = raw.match(/^(\d+)\s*x\s*(\d+)$/);
  if (!match) return { resolution: "720p", ratio: "16:9" };

  const width = Number(match[1]);
  const height = Number(match[2]);
  const larger = Math.max(width, height);
  const smaller = Math.max(1, Math.min(width, height));

  let resolution = "720p";
  if (larger >= 1600) resolution = "1080p";
  else if (larger <= 900) resolution = "480p";

  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  const d = gcd(width, height) || 1;
  const rw = Math.round(width / d);
  const rh = Math.round(height / d);
  const ratio = `${rw}:${rh}`;
  return { resolution, ratio };
}

async function generateVideo({
  remoteModel,
  prompt,
  size,
  inputImage,
  inputImageMime,
  inputImageUrl,
  inputVideo,
  inputVideoUrl,
  signal,
} = {}) {
  const { value: rawKey } = requireAnyEnv(["SEEDREAM_API_KEY", "ARK_API_KEY"]);
  const apiKey = normalizeApiKey(rawKey);
  const baseUrl = normalizeBaseUrl(process.env.SEEDANCE_BASE_URL || process.env.SEEDREAM_BASE_URL || process.env.ARK_BASE_URL);
  const createUrl = `${baseUrl}/contents/generations/tasks`;
  const modelId = normalizeRemoteModel(remoteModel || process.env.SEEDANCE_2_REMOTE_MODEL);

  if (inputVideo || inputVideoUrl) {
    const err = new Error("VIDEO_TO_VIDEO_NOT_SUPPORTED");
    err.status = 400;
    err.details = { provider: "seedance", model: modelId };
    throw err;
  }

  const spec = inferVideoSpec(size);
  const duration = Math.max(4, Number.parseInt(process.env.SEEDANCE_DEFAULT_DURATION || "5", 10) || 5);
  const watermark = String(process.env.SEEDANCE_WATERMARK || "false").trim().toLowerCase() === "true";
  const generateAudio = String(process.env.SEEDANCE_GENERATE_AUDIO || "false").trim().toLowerCase() === "true";
  const cameraFixed = String(process.env.SEEDANCE_CAMERA_FIXED || "false").trim().toLowerCase() === "true";

  const content = [];
  const trimmedPrompt = String(prompt || "").trim();
  if (trimmedPrompt) {
    content.push({
      type: "text",
      text: trimmedPrompt,
    });
  }

  if (inputImageUrl) {
    content.push({
      type: "image_url",
      role: "first_frame",
      image_url: { url: String(inputImageUrl) },
    });
  } else if (inputImage) {
    const mime = String(inputImageMime || "image/png");
    content.push({
      type: "image_url",
      role: "first_frame",
      image_url: {
        url: `data:${mime};base64,${Buffer.from(inputImage).toString("base64")}`,
      },
    });
  }

  if (content.length === 0) {
    const err = new Error("EMPTY_VIDEO_PROMPT");
    err.status = 400;
    err.details = { provider: "seedance", model: modelId };
    throw err;
  }

  const createResp = await fetch(createUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      content,
      resolution: spec.resolution,
      ratio: spec.ratio,
      duration,
      camera_fixed: cameraFixed,
      watermark,
      generate_audio: generateAudio,
    }),
    signal,
  });

  if (!createResp.ok) {
    const text = await createResp.text().catch(() => "");
    throw buildProviderError({ status: createResp.status, text, endpoint: createUrl, modelId });
  }

  const created = await createResp.json().catch(() => ({}));
  const taskId = created?.id || created?.task_id || null;
  if (!taskId) {
    const err = new Error("VIDEO_TASK_ID_MISSING");
    err.status = 502;
    err.details = { provider: "seedance", model: modelId };
    throw err;
  }

  const pollUrl = `${baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`;
  const timeoutMs = Math.max(30_000, Number.parseInt(process.env.CREATIVE_VIDEO_TIMEOUT_MS || "420000", 10) || 420_000);
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      const err = new Error("VIDEO_GENERATION_TIMEOUT");
      err.status = 504;
      err.details = { provider: "seedance", model: modelId, taskId };
      throw err;
    }

    const pollResp = await fetch(pollUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal,
    });

    if (!pollResp.ok) {
      const text = await pollResp.text().catch(() => "");
      throw buildProviderError({ status: pollResp.status, text, endpoint: pollUrl, modelId, taskId });
    }

    const json = await pollResp.json().catch(() => ({}));
    const status = String(json?.status || "").trim().toLowerCase();

    if (status === "failed" || status === "canceled" || status === "cancelled") {
      throw buildProviderError({ status: 502, text: JSON.stringify(json), endpoint: pollUrl, modelId, taskId });
    }

    if (status !== "succeeded") {
      await sleep(3000, signal);
      continue;
    }

    const videoUrl = json?.content?.video_url || json?.content?.file_url || null;
    if (!videoUrl) {
      const err = new Error("EMPTY_VIDEO_RESPONSE");
      err.status = 502;
      err.details = { provider: "seedance", model: modelId, taskId };
      throw err;
    }

    return {
      videos: [
        {
          mime: "video/mp4",
          url: String(videoUrl),
        },
      ],
      usage: json?.usage || null,
      providerMeta: {
        taskId,
        lastFrameUrl: json?.content?.last_frame_url || null,
      },
    };
  }
}

module.exports = {
  generateVideo,
};
