function parseCsvList(v) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function requireEnv(name, provider) {
  const v = process.env[name];
  if (!v) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider, missing: name };
    throw err;
  }
  return v;
}

function resolveBaseUrl({ provider, baseUrlEnv, defaultBaseUrl } = {}) {
  const raw = String(process.env[baseUrlEnv] || defaultBaseUrl || "").trim();
  if (!raw) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider, missing: baseUrlEnv };
    throw err;
  }

  const noSlash = raw.replace(/\/$/, "");
  // If the user provided ".../v1" keep it; otherwise assume OpenAI-compat and append "/v1".
  if (/\/v\d+(?:beta)?$/.test(noSlash)) return noSlash;
  return `${noSlash}/v1`;
}

function buildProviderError({ provider, status, text }) {
  // OpenAI-compatible JSON: { error: { message, type, code } }
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
    provider,
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };
  return err;
}

async function generateImageOpenAICompat({
  provider,
  apiKey,
  baseUrl,
  remoteModel,
  prompt,
  size,
  responseFormat,
  signal,
} = {}) {
  const desiredFormat = String(responseFormat || "").trim();

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

  // Progressive fallback: (format+size) -> (no format) -> (no size) -> (no format+no size)
  const attempts = [
    { includeFormat: true, includeSize: true },
    { includeFormat: false, includeSize: true },
    { includeFormat: true, includeSize: false },
    { includeFormat: false, includeSize: false },
  ];

  let lastText = "";
  let lastStatus = 0;
  for (const a of attempts) {
    const resp = await doRequest(a);
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
        return {
          images: [{ mime: "image/png", url }],
          revisedPrompt: typeof item?.revised_prompt === "string" ? item.revised_prompt : null,
        };
      }

      const err = new Error("EMPTY_IMAGE_RESPONSE");
      err.status = 502;
      err.details = { provider, remoteModel };
      throw err;
    }

    lastStatus = resp.status;
    lastText = await resp.text().catch(() => "");

    // If the failure looks like an "unknown_parameter" for the param we removed next, keep trying.
    if (resp.status === 400) continue;
    // For model/access errors, let the caller handle fallback model ids.
    if (resp.status === 401 || resp.status === 403 || resp.status === 404) break;
    break;
  }

  throw buildProviderError({ provider, status: lastStatus || 500, text: lastText });
}

module.exports = {
  parseCsvList,
  requireEnv,
  resolveBaseUrl,
  buildProviderError,
  generateImageOpenAICompat,
};

