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

function sseParseLines(buffer) {
  // OpenAI streaming uses SSE frames separated by \n\n
  const parts = buffer.split("\n\n");
  const rest = parts.pop() || "";
  return { frames: parts, rest };
}

function buildProviderError({ status, text }) {
  // OpenAI typically returns JSON like: { error: { message, type, code } }
  let code = "PROVIDER_ERROR";
  let message = "";
  try {
    const j = JSON.parse(text || "{}");
    code = j?.error?.code || j?.error?.type || code;
    message = j?.error?.message || "";
  } catch {
    // ignore JSON parse errors
  }

  const err = new Error(code || "PROVIDER_ERROR");
  err.status = status || 500;
  err.details = {
    provider: "openai",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };

  if (process.env.DEBUG_AI === "1") {
    // Avoid logging secrets; only log metadata and truncated body.
    console.error("[openai] error", {
      status: err.status,
      code: err.details.code,
      message: err.details.message,
      body: err.details.body,
    });
  }
  return err;
}

function buildOpenAIHeaders({ apiKey } = {}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  const org = String(process.env.OPENAI_ORG_ID || "").trim();
  const project = String(process.env.OPENAI_PROJECT_ID || "").trim();

  if (org) headers["OpenAI-Organization"] = org;
  if (project) headers["OpenAI-Project"] = project;

  return headers;
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
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  return "png";
}

function fileFromImageInput({ inputImage, inputMime } = {}) {
  // Accept either a data URL string or {Buffer} passed from higher layers.
  if (inputImage && Buffer.isBuffer(inputImage)) {
    const mime = String(inputMime || "image/png").trim() || "image/png";
    const ext = extFromMime(mime);
    const blob = new Blob([inputImage], { type: mime });
    return { blob, filename: `input.${ext}`, mime };
  }

  const decoded = decodeDataUrl(inputImage);
  if (!decoded) return null;
  const mime = String(decoded.mime || "image/png").trim() || "image/png";
  const ext = extFromMime(mime);
  const blob = new Blob([decoded.buf], { type: mime });
  return { blob, filename: `input.${ext}`, mime };
}

function maybeInjectCoreStyleSystem({ remoteModel, messages }) {
  // Keep "Mini" output closer to the premium GPT-5.2 Pro style (formatting + structure),
  // without affecting other OpenAI models.
  const rm = String(remoteModel || "").trim();
  if (!rm.startsWith("gpt-5-mini")) return messages;

  const marker = "[coreai-style:v1]";
  if (
    Array.isArray(messages) &&
    messages.some((m) => m?.role === "system" && typeof m?.content === "string" && m.content.includes(marker))
  ) {
    return messages;
  }

  const sys = {
    role: "system",
    content:
      `${marker}\n` +
      "You are Core AI.\n" +
      "Output rules (apply to ALL languages):\n" +
      "- Reply in the user's language (and match locale; if user writes Portuguese, use PT-PT).\n" +
      "- Format ALWAYS in Markdown.\n" +
      "- Do NOT use Markdown headings with # (e.g. ###). For section titles use a single bold line like: **📌 Título**.\n" +
      "- Keep paragraphs short (max 2–3 sentences). Avoid long walls of text.\n" +
      "- Add one blank line between sections, lists and tables.\n" +
      "- Use ✅ for key points and • for normal lists.\n" +
      "- When comparing numbers/costs/latency, prefer a Markdown table.\n" +
      "\n" +
      "Math / calculations:\n" +
      "- If the user provides numbers, do the calculations and show numeric results.\n" +
      "- Show assumptions/variables, then the formula in plain text, then the step-by-step substitution.\n" +
      "- Finish with an explicit final line: **Resultado: ...**\n" +
      "- Do NOT use LaTeX/MathJax (no \\( \\), \\[ \\], \\begin{...}). Use plain-text formulas (e.g. `custo = pedidos * tokens/1000 * preco`).\n" +
      "\n" +
      "Code:\n" +
      "- When you include code, logs or file contents, ALWAYS wrap them in fenced code blocks (```lang ... ```).\n" +
      "- Preserve indentation.\n" +
      "\n" +
      "Sources:\n" +
      "- Never invent sources/links.\n" +
      "- Only add a **📚 Fontes** section if you have concrete URLs provided by the user or by an integrated tool.\n",
  };

  if (!Array.isArray(messages) || messages.length === 0) return [sys];
  return [sys, ...messages];
}

function maybeInjectCodeFormattingSystem({ remoteModel, messages }) {
  // GPT-5 Nano sometimes returns code without fenced blocks.
  // Add a tiny system instruction to keep the UI rendering consistent.
  if (String(remoteModel || "").trim() !== "gpt-5-nano") return messages;
  const sys = {
    role: "system",
    content:
      "Formatting rules:\n" +
      "- When you include code, logs, or file contents, ALWAYS wrap them in Markdown fenced code blocks (```lang ... ```).\n" +
      "- Preserve indentation.\n" +
      "- If you mention a filename, put the code for that file inside a single fenced block.\n" +
      "- Do not output raw code without fences.",
  };
  if (!Array.isArray(messages) || messages.length === 0) return [sys];
  return [sys, ...messages];
}

async function streamChat({ remoteModel, messages, onDelta, signal }) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

  if (process.env.DEBUG_AI === "1") {
    console.error("[openai] request", {
      remoteModel,
      baseUrl,
      keyLen: apiKey.length,
      keyLast4: apiKey.slice(-4),
    });
  }

  // Some OpenAI deployments may reject `stream_options`. We optimistically send it, and retry without it on 400.
  const cachingEnabled = String(process.env.OPENAI_PROMPT_CACHING || "1") !== "0";
  const promptCacheRetention = String(process.env.OPENAI_PROMPT_CACHE_RETENTION || "").trim(); // e.g. "in-memory" or "24h" (if supported)
  const promptCacheKey =
    String(process.env.OPENAI_PROMPT_CACHE_KEY || "").trim() ||
    `coreai:v1:${String(remoteModel || "").trim() || "unknown"}`;

  const doRequest = async ({ includeUsage, includeCaching } = {}) => {
    const styled = maybeInjectCoreStyleSystem({ remoteModel, messages });
    const outMessages = maybeInjectCodeFormattingSystem({ remoteModel, messages: styled });
    const body = {
      model: remoteModel,
      messages: outMessages,
      stream: true,
    };
    if (includeUsage) body.stream_options = { include_usage: true };
    if (includeCaching && cachingEnabled) {
      body.prompt_cache_key = promptCacheKey;
      if (promptCacheRetention) body.prompt_cache_retention = promptCacheRetention;
    }

    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        ...buildOpenAIHeaders({ apiKey }),
      },
      body: JSON.stringify(body),
      signal,
    });
  };

  const parseUnsupportedParam = (text) => {
    try {
      const j = JSON.parse(text || "{}");
      const p = String(j?.error?.param || "").trim();
      return p || null;
    } catch {
      return null;
    }
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

    // Try targeted retries first, then a conservative fallback.
    const retryPlan = [];
    if (mentionsStreamOptions && mentionsCaching) retryPlan.push({ includeUsage: false, includeCaching: false });
    if (mentionsStreamOptions) retryPlan.push({ includeUsage: false, includeCaching: true });
    if (mentionsCaching) retryPlan.push({ includeUsage: true, includeCaching: false });
    retryPlan.push({ includeUsage: false, includeCaching: false });

    let ok = false;
    for (const attempt of retryPlan) {
      resp = await doRequest(attempt);
      if (resp.ok) {
        ok = true;
        break;
      }
      if (resp.status !== 400) break;
    }

    // If still failing, fall through; the generic error handler below will read the final response body.
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

        // Usage can appear when include_usage=true (usually near the end).
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

async function generateImage({ remoteModel, prompt, size, signal } = {}) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

  const desiredFormat = String(process.env.OPENAI_IMAGE_RESPONSE_FORMAT || "").trim();

  const doRequest = async ({ includeFormat } = {}) => {
    const body = {
      model: remoteModel,
      prompt: String(prompt || "").slice(0, 4000),
      n: 1,
    };
    if (size) body.size = String(size);
    if (includeFormat && desiredFormat) body.response_format = desiredFormat;

    return fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: {
        ...buildOpenAIHeaders({ apiKey }),
      },
      body: JSON.stringify(body),
      signal,
    });
  };

  // Some OpenAI-compatible gateways reject `response_format` (unknown_parameter).
  // Try with it only when explicitly configured, then retry without on 400.
  let resp = await doRequest({ includeFormat: true });
  if (!resp.ok && resp.status === 400 && desiredFormat) {
    const text = await resp.text().catch(() => "");
    if (text.toLowerCase().includes("unknown parameter") && text.toLowerCase().includes("response_format")) {
      resp = await doRequest({ includeFormat: false });
    } else {
      throw buildProviderError({ status: resp.status, text });
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
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
  err.details = { provider: "openai", remoteModel };
  throw err;
}

async function transformImage({ remoteModel, prompt, size, inputImage, inputMime, signal } = {}) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

  const file = fileFromImageInput({ inputImage, inputMime });
  if (!file) {
    const err = new Error("INVALID_INPUT_IMAGE");
    err.status = 400;
    err.details = { provider: "openai" };
    throw err;
  }

  const desiredFormat = String(process.env.OPENAI_IMAGE_RESPONSE_FORMAT || "").trim();

  const doRequest = async ({ includeFormat } = {}) => {
    const form = new FormData();
    form.set("model", String(remoteModel || ""));
    form.set("prompt", String(prompt || "").slice(0, 4000));
    if (size) form.set("size", String(size));
    if (includeFormat && desiredFormat) form.set("response_format", desiredFormat);
    form.set("image", file.blob, file.filename);

    const headers = {
      Authorization: `Bearer ${apiKey}`,
    };
    const org = String(process.env.OPENAI_ORG_ID || "").trim();
    const project = String(process.env.OPENAI_PROJECT_ID || "").trim();
    if (org) headers["OpenAI-Organization"] = org;
    if (project) headers["OpenAI-Project"] = project;

    return fetch(`${baseUrl}/images/edits`, {
      method: "POST",
      headers,
      body: form,
      signal,
    });
  };

  // Some OpenAI-compatible gateways reject `response_format` (unknown_parameter).
  // Try with it only when explicitly configured, then retry without on 400.
  let resp = await doRequest({ includeFormat: true });
  if (!resp.ok && resp.status === 400 && desiredFormat) {
    const text = await resp.text().catch(() => "");
    if (text.toLowerCase().includes("unknown parameter") && text.toLowerCase().includes("response_format")) {
      resp = await doRequest({ includeFormat: false });
    } else {
      throw buildProviderError({ status: resp.status, text });
    }
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
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
  err.details = { provider: "openai", remoteModel };
  throw err;
}

async function listModels({ signal } = {}) {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");

  const resp = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      ...buildOpenAIHeaders({ apiKey }),
    },
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw buildProviderError({ status: resp.status, text });
  }

  const json = await resp.json().catch(() => ({}));
  const items = Array.isArray(json?.data) ? json.data : [];

  return items.map((m) => ({
    id: m?.id,
    ownedBy: m?.owned_by,
    object: m?.object,
    created: m?.created,
  }));
}

module.exports = { streamChat, generateImage, transformImage, listModels };
