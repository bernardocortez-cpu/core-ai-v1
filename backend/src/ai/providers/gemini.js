function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { missing: name };
    throw err;
  }
  return v;
}

function buildProviderError({ status, text }) {
  let code = null;
  let message = null;
  let googleStatus = null;

  try {
    const j = JSON.parse(text || "{}");
    const e = j?.error || j;
    if (e && typeof e === "object") {
      code = e.code != null ? String(e.code) : null;
      message = e.message != null ? String(e.message) : null;
      googleStatus = e.status != null ? String(e.status) : null;
    }
  } catch {
    // ignore
  }

  const err = new Error("PROVIDER_ERROR");
  err.status = status || 500;
  err.details = {
    provider: "gemini",
    code,
    status: googleStatus,
    message,
    body: String(text || "").slice(0, 2000),
  };
  if (process.env.DEBUG_AI === "1") {
    console.error("[gemini] error", {
      status: err.status,
      code,
      googleStatus,
      body: err.details.body,
    });
  }
  return err;
}

const GEMINI_WORKING_MODEL_BY_REQUESTED = new Map();
const GEMINI_BAD_MODELS = new Set();
const GEMINI_MODEL_CAPS = new Map(); // modelId -> { preferStream?: boolean|null, preferredApiVersion?: "v1beta"|"v1"|null, systemMode?: string|null }

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const out = [];
    for (const p of content) {
      if (!p || typeof p !== "object") continue;
      const t = String(p.type || "");
      if (t === "text" || t === "input_text") {
        const v =
          typeof p.text === "string"
            ? p.text
            : typeof p.content === "string"
              ? p.content
              : "";
        if (v) out.push(v);
      }
    }
    return out.join("");
  }
  return "";
}

function parseDataUrl(url) {
  const raw = String(url || "").trim();
  if (!raw.startsWith("data:")) return null;
  const comma = raw.indexOf(",");
  if (comma === -1) return null;
  const meta = raw.slice(5, comma);
  const data = raw.slice(comma + 1);
  const isBase64 = /;base64/i.test(meta);
  const mime = meta.split(";")[0] || "application/octet-stream";
  if (!isBase64) return null;
  if (!data) return null;
  return { mime, base64: data };
}

function toGeminiParts(content) {
  if (typeof content === "string") return [{ text: content }];
  if (!Array.isArray(content)) return [];

  const parts = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    const t = String(p.type || "");

    if (t === "text" || t === "input_text") {
      const v =
        typeof p.text === "string"
          ? p.text
          : typeof p.content === "string"
            ? p.content
            : "";
      if (v) parts.push({ text: v });
      continue;
    }

    if (t === "image_url") {
      const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
      const parsed = parseDataUrl(url);
      if (parsed) {
        parts.push({
          inlineData: {
            mimeType: parsed.mime,
            data: parsed.base64,
          },
        });
      }
    }

    // Generic file/document parts (e.g. PDFs). Gemini supports inlineData for PDFs.
    if (t === "file" || t === "document" || t === "input_file") {
      const url =
        typeof p.url === "string"
          ? p.url
          : typeof p.dataUrl === "string"
            ? p.dataUrl
            : typeof p.file === "string"
              ? p.file
              : p.file?.url;
      const parsed = parseDataUrl(url);
      if (parsed) {
        parts.push({
          inlineData: {
            mimeType: parsed.mime,
            data: parsed.base64,
          },
        });
      }
    }
  }

  return parts;
}

function toGeminiRequest(messages, opts = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const systemMode = String(opts.systemMode || "systemInstruction");

  const systemTexts = list
    .filter((m) => m && m.role === "system")
    .map((m) => extractTextFromContent(m.content).trim())
    .filter(Boolean);

  const conversation = list
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: toGeminiParts(m.content),
    }))
    .filter((m) => Array.isArray(m.parts) && m.parts.length > 0);

  const contents = [...conversation];
  if (systemTexts.length > 0 && systemMode === "prependToUser") {
    // Some Gemini endpoints/models reject `systemInstruction`. In that case we can
    // still preserve system context by prepending it as a first user message.
    contents.unshift({
      role: "user",
      parts: [{ text: systemTexts.join("\n\n") }],
    });
  }

  const req = { contents };
  if (systemTexts.length > 0 && systemMode === "systemInstruction") {
    req.systemInstruction = {
      parts: [{ text: systemTexts.join("\n\n") }],
    };
  }

  return req;
}

function normalizeRemoteModel(remoteModel) {
  const raw = String(remoteModel || "").trim();
  if (!raw) return raw;
  // Some APIs/docs use "models/<id>" while our registry stores just "<id>".
  return raw.startsWith("models/") ? raw.slice("models/".length) : raw;
}

function isModelishError(err) {
  if (!err || err.message !== "PROVIDER_ERROR") return false;
  const st = String(err.details?.status || "").toUpperCase();
  const msg = String(err.details?.message || err.details?.body || "").toLowerCase();
  const status = Number(err.status || 0);

  if (st === "NOT_FOUND") return true;
  if (st === "INVALID_ARGUMENT" && msg.includes("model")) return true;
  if (st === "PERMISSION_DENIED" && msg.includes("model")) return true;

  if (status === 404) return true;
  if (status === 400 && msg.includes("model")) return true;
  if (status === 403 && msg.includes("model")) return true;

  return false;
}

function shouldRetryWithoutSystemInstruction(err) {
  if (!err || err.message !== "PROVIDER_ERROR") return false;
  const status = Number(err.status || 0);
  const st = String(err.details?.status || "").toUpperCase();
  const msg = String(err.details?.message || err.details?.body || "").toLowerCase();
  if (status !== 400) return false;
  if (st !== "INVALID_ARGUMENT" && st !== "BAD_REQUEST") return false;
  // Typical Gemini errors when the field is rejected:
  // - "Unknown name 'systemInstruction' at ..."
  // - "Invalid JSON payload received. Unknown name ..."
  // - "system_instruction" (snake_case) in some gateways.
  return msg.includes("systeminstruction") || msg.includes("system_instruction") || msg.includes("system instruction");
}

function modelVariants(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return [];

  const out = [id];
  const add = (x) => {
    const v = String(x || "").trim();
    if (v && !out.includes(v)) out.push(v);
  };

  // Handle common Gemini 3 Pro naming variants we see in the wild.
  if (id === "gemini-3-pro" || id === "gemini-3-pro-preview" || id.startsWith("gemini-3-pro")) {
    add("gemini-3-pro");
    add("gemini-3-pro-preview");
    add("gemini-3-pro-latest");
    add("gemini-3-pro-001");
  }

  // Handle common Gemini 3.1 Pro naming variants (preview/stable/latest).
  if (
    id === "gemini-3.1-pro" ||
    id === "gemini-3.1-pro-preview" ||
    id.startsWith("gemini-3.1-pro") ||
    id === "gemini-3-1-pro" ||
    id.startsWith("gemini-3-1-pro")
  ) {
    add("gemini-3.1-pro");
    add("gemini-3.1-pro-preview");
    add("gemini-3.1-pro-latest");
    add("gemini-3.1-pro-001");
    // Some gateways may replace dots with dashes.
    add("gemini-3-1-pro");
    add("gemini-3-1-pro-preview");
    add("gemini-3-1-pro-latest");
    add("gemini-3-1-pro-001");
  }

  return out;
}

function sseParseFrames(buffer) {
  // Some servers use CRLF delimiters (\r\n\r\n). Normalize to LF so splitting works.
  const normalized = String(buffer || "").replace(/\r/g, "");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() || "";
  return { frames: parts, rest };
}

function extractCandidateText(json) {
  const parts = json?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  const texts = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).filter(Boolean);
  if (texts.length > 0) return texts.join("");

  // Some responses may include different keys; fall back to stringifying known shapes.
  const maybeText = json?.candidates?.[0]?.content?.text;
  if (typeof maybeText === "string") return maybeText;

  return "";
}

function extractUsage(json) {
  const u = json?.usageMetadata;
  if (!u || typeof u !== "object") return null;
  const prompt = Number(u.promptTokenCount);
  const cand = Number(u.candidatesTokenCount);
  const total = Number(u.totalTokenCount);
  const cached = Number(u.cachedContentTokenCount);
  return {
    prompt_tokens: Number.isFinite(prompt) ? prompt : null,
    completion_tokens: Number.isFinite(cand) ? cand : null,
    total_tokens: Number.isFinite(total) ? total : null,
    cachedContentTokenCount: Number.isFinite(cached) ? cached : null,
    gemini: u,
  };
}

function extractMeta(json) {
  const cand0 = json?.candidates?.[0];
  const finishReason =
    cand0 && typeof cand0.finishReason === "string" ? cand0.finishReason : null;
  const promptFeedback = json?.promptFeedback || null;
  const blockReason =
    promptFeedback && typeof promptFeedback.blockReason === "string"
      ? promptFeedback.blockReason
      : null;
  return {
    finishReason,
    blockReason,
    promptFeedback,
  };
}

function summarizeResponseShape(json) {
  try {
    const obj = json && typeof json === "object" ? json : null;
    if (!obj) return null;
    const topKeys = Object.keys(obj).slice(0, 25);

    const cand = Array.isArray(obj.candidates) ? obj.candidates : null;
    const cand0 = cand && cand[0] && typeof cand[0] === "object" ? cand[0] : null;
    const cand0Keys = cand0 ? Object.keys(cand0).slice(0, 25) : null;

    const parts = cand0?.content?.parts;
    const partsCount = Array.isArray(parts) ? parts.length : null;
    const part0 = Array.isArray(parts) && parts[0] && typeof parts[0] === "object" ? parts[0] : null;
    const part0Keys = part0 ? Object.keys(part0).slice(0, 25) : null;

    return {
      topKeys,
      candidatesCount: Array.isArray(cand) ? cand.length : null,
      cand0Keys,
      partsCount,
      part0Keys,
      hasPromptFeedback: Boolean(obj.promptFeedback),
      hasUsageMetadata: Boolean(obj.usageMetadata),
    };
  } catch {
    return null;
  }
}

function asEventList(json) {
  if (Array.isArray(json)) return json.filter((x) => x && typeof x === "object");
  if (json && typeof json === "object") return [json];
  return [];
}

function parseSseFrame(frame) {
  // Gemini SSE frames can contain multiple lines; we only care about "data:" lines.
  const lines = String(frame || "").split("\n");
  const dataLines = [];
  for (const line of lines) {
    const l = String(line || "").trimEnd();
    if (!l.startsWith("data:")) continue;
    dataLines.push(l.slice(5).trimStart());
  }
  const dataRaw = dataLines.join("\n").trim();
  if (!dataRaw) return null;
  if (dataRaw === "[DONE]") return { done: true };
  try {
    return { json: JSON.parse(dataRaw) };
  } catch {
    return { raw: dataRaw };
  }
}

async function streamFromSse({ resp, onDelta }) {
  const reader = resp.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let acc = "";
  let fullText = "";
  let usage = null;
  let meta = null;
  let lastEvent = null;
  let sawAnyFrame = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    acc += decoder.decode(value, { stream: true });
    const { frames, rest } = sseParseFrames(acc);
    acc = rest;

    for (const frame of frames) {
      sawAnyFrame = true;
      const parsed = parseSseFrame(frame);
      if (!parsed) continue;
      if (parsed.done) return { text: fullText, usage };
      if (!parsed.json) continue;

      const events = asEventList(parsed.json);
      for (const ev of events) {
        lastEvent = ev;
        const u = extractUsage(ev);
        if (u) usage = u;
        const m = extractMeta(ev);
        // Keep the last meta we see (usually contains finishReason/promptFeedback).
        if (m && (m.finishReason || m.blockReason || m.promptFeedback)) meta = m;

        const chunkText = extractCandidateText(ev);
        if (!chunkText) continue;

        // Some Gemini streaming responses send cumulative text; others send deltas.
        // Normalize to deltas so the UI doesn't duplicate output.
        let delta = chunkText;
        if (chunkText.startsWith(fullText)) {
          delta = chunkText.slice(fullText.length);
          fullText = chunkText;
        } else if (fullText.startsWith(chunkText)) {
          delta = "";
        } else {
          fullText += chunkText;
          delta = chunkText;
        }

        if (delta && typeof onDelta === "function") onDelta(delta);
      }
    }
  }

  if (process.env.DEBUG_AI === "1" && !sawAnyFrame) {
    console.error("[gemini] stream warning", {
      note: "no SSE frames parsed (check CRLF / proxy buffering / content-type)",
    });
  }

  if (process.env.DEBUG_AI === "1" && fullText.trim().length === 0) {
    console.error("[gemini] empty response", {
      finishReason: meta?.finishReason || null,
      blockReason: meta?.blockReason || null,
      shape: summarizeResponseShape(lastEvent),
    });
  }

  return { text: fullText, usage, meta };
}

async function nonStreamingCall({ url, apiKey, body, signal }) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
  }

  const json = await resp.json().catch(() => null);
  const events = asEventList(json);
  const text = events.map((ev) => extractCandidateText(ev)).filter(Boolean).join("");
  const usage = events.length > 0 ? extractUsage(events[events.length - 1]) : null;
  const meta = events.length > 0 ? extractMeta(events[events.length - 1]) : null;

  if (process.env.DEBUG_AI === "1") {
    console.error("[gemini] generateContent parsed", {
      textLen: text.length,
      finishReason: meta?.finishReason || null,
      blockReason: meta?.blockReason || null,
    });
    if (text.trim().length === 0) {
      console.error("[gemini] empty response", {
        finishReason: meta?.finishReason || null,
        blockReason: meta?.blockReason || null,
        shape: summarizeResponseShape(events.length > 0 ? events[events.length - 1] : json),
      });
    }
  }

  return { text, usage, meta };
}

// Gemini REST API (streamGenerateContent SSE when available; fallback to generateContent).
async function streamChat({ remoteModel, messages, onDelta, signal }) {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const preferredModelId = normalizeRemoteModel(remoteModel);

  if (process.env.DEBUG_AI === "1") {
    console.error("[gemini] request", {
      remoteModel: preferredModelId,
      baseUrl,
      keyLen: apiKey.length,
      keyLast4: apiKey.slice(-4),
    });
  }

  const primaryReqBody = toGeminiRequest(messages, { systemMode: "systemInstruction" });
  const fallbackReqBody = toGeminiRequest(messages, { systemMode: "prependToUser" });

  function urlsFor(apiVersion, modelId) {
    return {
      streamUrl: `${baseUrl}/${apiVersion}/models/${encodeURIComponent(
        modelId
      )}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
      nonStreamUrl: `${baseUrl}/${apiVersion}/models/${encodeURIComponent(
        modelId
      )}:generateContent?key=${encodeURIComponent(apiKey)}`,
    };
  }

  async function requestStream(apiVersion, modelId, body) {
    const { streamUrl } = urlsFor(apiVersion, modelId);
    return fetch(streamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
  }

  async function requestNonStream(apiVersion, modelId, body) {
    const { nonStreamUrl } = urlsFor(apiVersion, modelId);
    return nonStreamingCall({ url: nonStreamUrl, apiKey, body, signal });
  }

  async function streamOkResponse(resp) {
    const ct = (resp.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("text/event-stream")) {
      return streamFromSse({ resp, onDelta });
    }

    const textBody = await resp.text().catch(() => "");
    try {
      const json = JSON.parse(textBody);
      const events = asEventList(json);
      const text = events.map((ev) => extractCandidateText(ev)).filter(Boolean).join("");
      const usage = events.length > 0 ? extractUsage(events[events.length - 1]) : null;
      const meta = events.length > 0 ? extractMeta(events[events.length - 1]) : null;
      if (typeof onDelta === "function" && text) onDelta(text);
      return { text, usage, meta };
    } catch {
      throw buildProviderError({ status: 502, text: textBody });
    }
  }

  function getCaps(modelId) {
    const key = String(modelId || "").trim();
    const cur = GEMINI_MODEL_CAPS.get(key);
    if (cur && typeof cur === "object") return cur;
    const next = { preferStream: null, preferredApiVersion: null, systemMode: null };
    GEMINI_MODEL_CAPS.set(key, next);
    return next;
  }

  async function callWithModelId(modelId, body) {
    const caps = getCaps(modelId);
    const versions =
      caps.preferredApiVersion === "v1beta"
        ? ["v1beta", "v1"]
        : caps.preferredApiVersion === "v1"
          ? ["v1", "v1beta"]
          : ["v1beta", "v1"];

    // 1) Prefer streaming SSE (v1beta then v1).
    // Some models/environments may not support the streaming endpoint; in that case
    // we still want to fall back to non-streaming generateContent for the same model.
    let lastStreamErr = null;
    if (caps.preferStream !== false) {
      for (const apiVersion of versions) {
        const resp = await requestStream(apiVersion, modelId, body);
        if (resp.ok) {
          const out = await streamOkResponse(resp);
          const text = typeof out?.text === "string" ? out.text : "";
          if (text.trim().length > 0) {
            caps.preferStream = true;
            caps.preferredApiVersion = apiVersion;
            return { ...out, usedRemoteModel: modelId, usedApiVersion: apiVersion, usedTransport: "stream" };
          }

          // If the streaming endpoint responds OK but yields no output, treat it as a streaming failure
          // and fall back to non-streaming generateContent (same model, then other apiVersion).
          lastStreamErr = Object.assign(new Error("EMPTY_PROVIDER_RESPONSE"), {
            status: 502,
            details: {
              provider: "gemini",
              status: null,
              message: "streaming endpoint returned empty output",
            },
          });

          if (process.env.DEBUG_AI === "1") {
            console.error("[gemini] stream empty", {
              apiVersion,
              modelId,
              finishReason: out?.meta?.finishReason || null,
              blockReason: out?.meta?.blockReason || null,
            });
          }

          continue;
        }

        const text = await resp.text().catch(() => "");
        const err = buildProviderError({ status: resp.status, text });
        lastStreamErr = err;

        if (process.env.DEBUG_AI === "1") {
          console.error("[gemini] stream failed", {
            apiVersion,
            modelId,
            status: resp.status,
            googleStatus: err.details?.status,
            body: String(text || "").slice(0, 300),
          });
        }
      }
    }

    // 2) Non-streaming fallback (v1beta then v1).
    let lastNonStreamErr = null;
    for (const apiVersion of versions) {
      try {
        const out = await requestNonStream(apiVersion, modelId, body);
        caps.preferStream = false;
        caps.preferredApiVersion = apiVersion;
        if (process.env.DEBUG_AI === "1") {
          console.error("[gemini] generateContent ok", {
            apiVersion,
            modelId,
            textLen: (out?.text || "").length,
          });
        }
        if (typeof onDelta === "function" && out.text) onDelta(out.text);
        return { ...out, usedRemoteModel: modelId, usedApiVersion: apiVersion, usedTransport: "non-stream" };
      } catch (err) {
        lastNonStreamErr = err;
        if (process.env.DEBUG_AI === "1") {
          console.error("[gemini] generateContent failed", {
            apiVersion,
            modelId,
            status: err?.status,
            googleStatus: err?.details?.status,
          });
        }
        // Keep trying the other apiVersion; if both fail we'll throw the last error below.
      }
    }

    // Prefer returning the most informative error.
    throw lastNonStreamErr || lastStreamErr || Object.assign(new Error("PROVIDER_ERROR"), { status: 502, details: { provider: "gemini" } });
  }

  // Try preferred model id first, then common variants (gemini-3-pro vs preview vs -latest, etc.)
  const requestedKey = preferredModelId;
  const ids0 = modelVariants(preferredModelId);
  const preferred = GEMINI_WORKING_MODEL_BY_REQUESTED.get(requestedKey);
  const ids = [];
  const add = (x) => {
    const v = String(x || "").trim();
    if (!v) return;
    if (GEMINI_BAD_MODELS.has(v)) return;
    if (!ids.includes(v)) ids.push(v);
  };
  if (preferred) add(preferred);
  for (const id of ids0) add(id);
  let lastErr = null;
  for (const modelId of ids) {
    try {
      const caps = getCaps(modelId);
      const preferredBody = caps.systemMode === "prependToUser" ? fallbackReqBody : primaryReqBody;
      const out = await callWithModelId(modelId, preferredBody);
      GEMINI_WORKING_MODEL_BY_REQUESTED.set(requestedKey, modelId);
      return out;
    } catch (e) {
      // Some Gemini deployments reject `systemInstruction` for certain models/endpoints.
      // If we used it and got a clear INVALID_ARGUMENT, retry once without it by
      // moving system context into the first user message.
      if (primaryReqBody?.systemInstruction && shouldRetryWithoutSystemInstruction(e)) {
        try {
          if (process.env.DEBUG_AI === "1") {
            console.error("[gemini] retry without systemInstruction", { modelId });
          }
          const caps = getCaps(modelId);
          caps.systemMode = "prependToUser";
          return await callWithModelId(modelId, fallbackReqBody);
        } catch (e2) {
          lastErr = e2;
          if (isModelishError(e2)) continue;
          throw e2;
        }
      }

      lastErr = e;
      if (isModelishError(e)) {
        GEMINI_BAD_MODELS.add(modelId);
        continue;
      }
      throw e;
    }
  }

  throw lastErr || new Error("PROVIDER_ERROR");
}

function buildOpenAICompatError({ status, text }) {
  // OpenAI-compatible payloads: { error: { message, type, code } }
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
    provider: "gemini",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };

  if (process.env.DEBUG_AI === "1") {
    console.error("[gemini] openai-compat error", {
      status: err.status,
      code: err.details.code,
      message: err.details.message,
      body: err.details.body,
    });
  }

  return err;
}

function deriveOpenAICompatBaseUrl() {
  const raw = String(process.env.GEMINI_OPENAI_BASE_URL || "").trim();
  if (raw) return raw.replace(/\/$/, "");

  const base = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  // OpenAI compatibility endpoint lives under /v1beta/openai
  return `${base}/v1beta/openai`;
}

function isGeminiNativeImageModel(remoteModel) {
  const id = String(remoteModel || "").trim().toLowerCase();
  if (!id) return false;
  // Google docs: gemini-2.5-flash-image / gemini-3-pro-image-preview, etc.
  return id.startsWith("gemini-") && (id.includes("-image") || id.includes("image-preview"));
}

function parseSizeToImageConfig(size) {
  const s = String(size || "").trim();
  const m = s.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!m) return null;

  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  const maxDim = Math.max(w, h);
  const imageSize = maxDim <= 1024 ? "1K" : maxDim <= 2048 ? "2K" : "4K";

  const ratio = w / h;
  const candidates = [
    { r: 1, v: "1:1" },
    { r: 16 / 9, v: "16:9" },
    { r: 9 / 16, v: "9:16" },
    { r: 4 / 3, v: "4:3" },
    { r: 3 / 4, v: "3:4" },
    { r: 3 / 2, v: "3:2" },
    { r: 2 / 3, v: "2:3" },
  ];
  let best = candidates[0];
  let bestDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(ratio - c.r);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }

  return { aspectRatio: best.v, imageSize };
}

function base64FromBuffer(buf) {
  if (!buf) return "";
  if (Buffer.isBuffer(buf)) return buf.toString("base64");
  return Buffer.from(buf).toString("base64");
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

function parseVideoAspectRatio(size) {
  const s = String(size || "").trim();
  const m = s.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!m) return "16:9";
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "16:9";
  const ratio = w / h;
  const candidates = [
    { r: 16 / 9, v: "16:9" },
    { r: 9 / 16, v: "9:16" },
    { r: 1, v: "1:1" },
    { r: 4 / 3, v: "4:3" },
    { r: 3 / 4, v: "3:4" },
  ];
  let best = candidates[0];
  let bestDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(ratio - c.r);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  return best.v;
}

async function downloadGeminiFileAsDataUrl({ fileUri, mimeType, apiKey, signal }) {
  const raw = String(fileUri || "").trim();
  if (!raw) {
    const err = new Error("EMPTY_VIDEO_RESPONSE");
    err.status = 502;
    throw err;
  }

  const tryUrls = [];
  if (/^https?:\/\//i.test(raw)) {
    tryUrls.push(raw);
    if (!/[?&]key=/.test(raw)) {
      tryUrls.push(`${raw}${raw.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`);
    }
  } else {
    tryUrls.push(`https://generativelanguage.googleapis.com/v1beta/${raw.replace(/^\/+/, "")}?alt=media&key=${encodeURIComponent(apiKey)}`);
  }

  let lastError = null;
  for (const url of tryUrls) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: { "x-goog-api-key": apiKey },
        signal,
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        lastError = buildProviderError({ status: resp.status, text });
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      const mime = resp.headers.get("content-type") || mimeType || "video/mp4";
      return {
        mime,
        dataUrl: `data:${mime};base64,${buf.toString("base64")}`,
      };
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || Object.assign(new Error("VIDEO_DOWNLOAD_FAILED"), { status: 502 });
}

async function generateVideo({ remoteModel, prompt, size, inputImage, inputImageMime, inputVideo, inputVideoMime, signal } = {}) {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const modelId = normalizeRemoteModel(remoteModel || process.env.GEMINI_VEO_31_REMOTE_MODEL || "veo-3.1-generate-preview");

  const instance = {
    prompt: String(prompt || "").slice(0, 8000),
  };

  if (inputImage) {
    instance.image = {
      bytesBase64Encoded: base64FromBuffer(inputImage),
      mimeType: String(inputImageMime || "image/png"),
    };
  }

  if (inputVideo) {
    instance.video = {
      bytesBase64Encoded: base64FromBuffer(inputVideo),
      mimeType: String(inputVideoMime || "video/mp4"),
    };
  }

  const body = {
    instances: [instance],
    parameters: {
      sampleCount: 1,
      aspectRatio: parseVideoAspectRatio(size),
    },
  };

  const createUrl = `${baseUrl}/v1beta/models/${encodeURIComponent(modelId)}:predictLongRunning?key=${encodeURIComponent(apiKey)}`;
  const createResp = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!createResp.ok) {
    const text = await createResp.text().catch(() => "");
    throw buildProviderError({ status: createResp.status, text });
  }

  const op = await createResp.json().catch(() => ({}));
  const opName = String(op?.name || "").trim();
  if (!opName) {
    const err = new Error("VIDEO_OPERATION_MISSING");
    err.status = 502;
    err.details = { provider: "gemini", modelId };
    throw err;
  }

  const pollUrl = `${baseUrl}/v1beta/${opName}?key=${encodeURIComponent(apiKey)}`;
  const timeoutMs = Math.max(30_000, Number.parseInt(process.env.CREATIVE_VIDEO_TIMEOUT_MS || "420000", 10) || 420_000);
  const startedAt = Date.now();

  while (true) {
    if (Date.now() - startedAt > timeoutMs) {
      const err = new Error("VIDEO_GENERATION_TIMEOUT");
      err.status = 504;
      err.details = { provider: "gemini", modelId };
      throw err;
    }

    const pollResp = await fetch(pollUrl, {
      method: "GET",
      headers: { "x-goog-api-key": apiKey },
      signal,
    });

    if (!pollResp.ok) {
      const text = await pollResp.text().catch(() => "");
      throw buildProviderError({ status: pollResp.status, text });
    }

    const json = await pollResp.json().catch(() => ({}));
    if (!json?.done) {
      await sleep(3500, signal);
      continue;
    }

    if (json?.error) {
      throw buildProviderError({ status: 502, text: JSON.stringify(json.error) });
    }

    const sample =
      json?.response?.generateVideoResponse?.generatedSamples?.[0] ||
      json?.response?.generatedSamples?.[0] ||
      null;
    const fileUri = sample?.video?.uri || sample?.video?.fileUri || sample?.uri || null;
    const mimeType = sample?.video?.mimeType || sample?.mimeType || "video/mp4";
    const downloaded = await downloadGeminiFileAsDataUrl({ fileUri, mimeType, apiKey, signal });

    return {
      videos: [downloaded],
    };
  }
}

async function generateMusic({ remoteModel, prompt, inputImage, inputImageMime, signal } = {}) {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const modelId = normalizeRemoteModel(remoteModel || process.env.GEMINI_LYRIA_3_REMOTE_MODEL || "lyria-3-clip-preview");

  const parts = [];
  if (inputImage) {
    const mimeType = String(inputImageMime || "image/png").trim() || "image/png";
    parts.push({
      inlineData: {
        mimeType,
        data: base64FromBuffer(inputImage),
      },
    });
  }
  if (prompt) parts.push({ text: String(prompt || "").slice(0, 8000) });

  const body = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ["AUDIO", "TEXT"],
    },
  };

  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
  }

  const json = await resp.json().catch(() => ({}));
  const cand = Array.isArray(json?.candidates) ? json.candidates[0] : null;
  const outParts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];
  const textParts = [];

  for (const p of outParts) {
    if (typeof p?.text === "string" && p.text.trim()) textParts.push(p.text.trim());
    const data = p?.inlineData?.data;
    const mime = String(p?.inlineData?.mimeType || "").trim().toLowerCase();
    if (typeof data === "string" && data && mime.startsWith("audio/")) {
      return {
        audios: [{ mime: mime || "audio/mpeg", dataUrl: `data:${mime || "audio/mpeg"};base64,${data}` }],
        text: textParts.length > 0 ? textParts.join("\n\n") : null,
      };
    }
  }

  const err = new Error("EMPTY_AUDIO_RESPONSE");
  err.status = 502;
  err.details = { provider: "gemini", remoteModel: modelId, body: JSON.stringify(json).slice(0, 2000) };
  throw err;
}

async function generateImageNative({ remoteModel, prompt, size, inputImage, inputMime, signal } = {}) {
  const apiKey = requireEnv("GEMINI_API_KEY");
  const baseUrl = (process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const modelId = normalizeRemoteModel(remoteModel);

  const parts = [];
  if (inputImage) {
    const mimeType = String(inputMime || "image/png").trim() || "image/png";
    parts.push({
      inlineData: {
        mimeType,
        data: base64FromBuffer(inputImage),
      },
    });
  }
  if (prompt) parts.push({ text: String(prompt || "").slice(0, 8000) });

  const generationConfig = {
    responseModalities: ["TEXT", "IMAGE"],
  };
  const imageConfig = parseSizeToImageConfig(size);
  if (imageConfig) generationConfig.imageConfig = imageConfig;

  const body = {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig,
  };

  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
  }

  const json = await resp.json().catch(() => ({}));
  const cand = Array.isArray(json?.candidates) ? json.candidates[0] : null;
  const outParts = Array.isArray(cand?.content?.parts) ? cand.content.parts : [];

  for (const p of outParts) {
    const data = p?.inlineData?.data;
    if (typeof data === "string" && data) {
      const mime = p?.inlineData?.mimeType || "image/png";
      return {
        images: [{ mime, dataUrl: `data:${mime};base64,${data}` }],
        revisedPrompt: null,
      };
    }
  }

  const err = new Error("EMPTY_IMAGE_RESPONSE");
  err.status = 502;
  err.details = { provider: "gemini", remoteModel: modelId, body: JSON.stringify(json).slice(0, 2000) };
  throw err;
}

async function generateImage({ remoteModel, prompt, size, signal } = {}) {
  if (isGeminiNativeImageModel(remoteModel)) {
    return generateImageNative({ remoteModel, prompt, size, signal });
  }

  const apiKey = requireEnv("GEMINI_API_KEY");
  const baseUrl = deriveOpenAICompatBaseUrl();

  // Prefer base64 so we can persist to our own storage (creative.service will convert to /media URLs).
  const desiredFormat = String(process.env.GEMINI_IMAGE_RESPONSE_FORMAT || "b64_json").trim();

  const doRequest = async ({ includeFormat, includeSize } = {}) => {
    const body = {
      model: String(remoteModel || "").trim(),
      prompt: String(prompt || "").slice(0, 4000),
      n: 1,
    };

    if (includeSize && size) body.size = String(size);
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

  // Some OpenAI-compatible gateways reject certain optional params. Retry by progressively removing them.
  let resp = await doRequest({ includeFormat: true, includeSize: true });
  if (!resp.ok && resp.status === 400) {
    const text = await resp.text().catch(() => "");
    const lower = text.toLowerCase();

    // Retry without response_format
    if (desiredFormat && lower.includes("unknown parameter") && lower.includes("response_format")) {
      resp = await doRequest({ includeFormat: false, includeSize: true });
    } else if (size && lower.includes("unknown parameter") && lower.includes("size")) {
      // Retry without size
      resp = await doRequest({ includeFormat: true, includeSize: false });
    } else {
      throw buildOpenAICompatError({ status: resp.status, text });
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildOpenAICompatError({ status: resp.status, text });
  }

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
    return {
      images: [{ mime: "image/png", url }],
      revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : null,
    };
  }

  const err = new Error("EMPTY_IMAGE_RESPONSE");
  err.status = 502;
  err.details = { provider: "gemini", remoteModel };
  throw err;
}

async function transformImage({ remoteModel, prompt, size, inputImage, inputMime, signal } = {}) {
  if (!isGeminiNativeImageModel(remoteModel)) {
    const err = new Error("IMG2IMG_NOT_SUPPORTED");
    err.status = 501;
    err.details = { provider: "gemini", remoteModel };
    throw err;
  }

  return generateImageNative({ remoteModel, prompt, size, inputImage, inputMime, signal });
}

module.exports = { streamChat, generateImage, transformImage, generateVideo, generateMusic };
