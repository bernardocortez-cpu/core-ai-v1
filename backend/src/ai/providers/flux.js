const { requireEnv } = require("./openaiCompatImages");

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(t);
      reject(Object.assign(new Error("ABORTED"), { name: "AbortError" }));
      return;
    }
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(Object.assign(new Error("ABORTED"), { name: "AbortError" }));
      },
      { once: true }
    );
  });
}

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
    provider: "flux",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };
  return err;
}

function parseSize(size) {
  const s = String(size || "").trim();
  const m = s.match(/^(\d{2,5})x(\d{2,5})$/);
  if (!m) return { width: 1024, height: 1024 };
  const width = Math.max(64, Math.min(4096, Number(m[1])));
  const height = Math.max(64, Math.min(4096, Number(m[2])));
  return { width, height };
}

function resolveEndpointFromRemoteModel(remoteModel) {
  const raw = String(remoteModel || "").trim().toLowerCase();
  if (!raw) return "flux-2-pro";

  // Our UI id "flux-2" is a friendly label; BFL endpoints are explicit variants.
  if (raw === "flux-2") return "flux-2-flex";

  // If the caller already provided an endpoint-like id, keep it.
  if (raw.startsWith("flux-")) return raw;

  return raw;
}

function base64FromBuffer(buf) {
  if (!buf) return "";
  if (Buffer.isBuffer(buf)) return buf.toString("base64");
  return Buffer.from(buf).toString("base64");
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
  const apiKey = requireEnv("FLUX_API_KEY", "flux");
  const base = String(process.env.FLUX_BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "flux", missing: "FLUX_BASE_URL" };
    throw err;
  }

  const endpoint = resolveEndpointFromRemoteModel(remoteModel);
  const { width, height } = parseSize(size);

  const submitUrl = `${base}/v1/${endpoint}`;
  const submitResp = await fetch(submitUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-key": apiKey,
    },
    body: JSON.stringify({
      prompt: String(prompt || "").slice(0, 8000),
      width,
      height,
    }),
    signal,
  });

  if (!submitResp.ok) {
    const text = await submitResp.text().catch(() => "");
    throw buildProviderError({ status: submitResp.status, text });
  }

  const submitJson = await submitResp.json().catch(() => ({}));
  const pollingUrlRaw = submitJson?.polling_url;
  if (typeof pollingUrlRaw !== "string" || !pollingUrlRaw) {
    const err = new Error("EMPTY_POLLING_URL");
    err.status = 502;
    err.details = { provider: "flux", body: JSON.stringify(submitJson).slice(0, 2000) };
    throw err;
  }

  const pollingUrl = pollingUrlRaw.startsWith("http") ? pollingUrlRaw : `${base}${pollingUrlRaw.startsWith("/") ? "" : "/"}${pollingUrlRaw}`;

  const started = Date.now();
  const timeoutMs = Number(process.env.FLUX_POLL_TIMEOUT_MS || 120000);
  const intervalMs = Number(process.env.FLUX_POLL_INTERVAL_MS || 500);

  while (true) {
    if (Date.now() - started > timeoutMs) {
      const err = new Error("FLUX_TIMEOUT");
      err.status = 504;
      err.details = { provider: "flux", pollingUrl };
      throw err;
    }

    await sleep(intervalMs, signal);

    const pollResp = await fetch(pollingUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-key": apiKey,
      },
      signal,
    });

    if (!pollResp.ok) {
      const text = await pollResp.text().catch(() => "");
      throw buildProviderError({ status: pollResp.status, text });
    }

    const pollJson = await pollResp.json().catch(() => ({}));
    const status = String(pollJson?.status || "");

    if (status === "Ready") {
      const sampleUrl = pollJson?.result?.sample;
      if (typeof sampleUrl !== "string" || !sampleUrl) {
        const err = new Error("EMPTY_IMAGE_RESPONSE");
        err.status = 502;
        err.details = { provider: "flux", body: JSON.stringify(pollJson).slice(0, 2000) };
        throw err;
      }

      const img = await fetchAsDataUrl(sampleUrl, signal);
      return { images: [img], revisedPrompt: null };
    }

    if (status === "Error" || status === "Failed") {
      throw buildProviderError({
        status: 502,
        text: JSON.stringify(pollJson),
      });
    }

    // Otherwise: Processing / Pending — keep polling.
  }
}

async function transformImage({ remoteModel, prompt, size, inputImage, signal } = {}) {
  const apiKey = requireEnv("FLUX_API_KEY", "flux");
  const base = String(process.env.FLUX_BASE_URL || "").trim().replace(/\/$/, "");
  if (!base) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "flux", missing: "FLUX_BASE_URL" };
    throw err;
  }

  if (!inputImage) {
    const err = new Error("INVALID_INPUT_IMAGE");
    err.status = 400;
    err.details = { provider: "flux" };
    throw err;
  }

  const endpoint = resolveEndpointFromRemoteModel(remoteModel);
  const { width, height } = parseSize(size);
  const inputB64 = base64FromBuffer(inputImage);

  const submitUrl = `${base}/v1/${endpoint}`;
  const submitResp = await fetch(submitUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-key": apiKey,
    },
    body: JSON.stringify({
      prompt: String(prompt || "").slice(0, 8000),
      input_image: inputB64,
      width,
      height,
    }),
    signal,
  });

  if (!submitResp.ok) {
    const text = await submitResp.text().catch(() => "");
    throw buildProviderError({ status: submitResp.status, text });
  }

  const submitJson = await submitResp.json().catch(() => ({}));
  const pollingUrlRaw = submitJson?.polling_url;
  if (typeof pollingUrlRaw !== "string" || !pollingUrlRaw) {
    const err = new Error("EMPTY_POLLING_URL");
    err.status = 502;
    err.details = { provider: "flux", body: JSON.stringify(submitJson).slice(0, 2000) };
    throw err;
  }

  const pollingUrl = pollingUrlRaw.startsWith("http")
    ? pollingUrlRaw
    : `${base}${pollingUrlRaw.startsWith("/") ? "" : "/"}${pollingUrlRaw}`;

  const started = Date.now();
  const timeoutMs = Number(process.env.FLUX_POLL_TIMEOUT_MS || 120000);
  const intervalMs = Number(process.env.FLUX_POLL_INTERVAL_MS || 500);

  while (true) {
    if (Date.now() - started > timeoutMs) {
      const err = new Error("FLUX_TIMEOUT");
      err.status = 504;
      err.details = { provider: "flux", pollingUrl };
      throw err;
    }

    await sleep(intervalMs, signal);

    const pollResp = await fetch(pollingUrl, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-key": apiKey,
      },
      signal,
    });

    if (!pollResp.ok) {
      const text = await pollResp.text().catch(() => "");
      throw buildProviderError({ status: pollResp.status, text });
    }

    const pollJson = await pollResp.json().catch(() => ({}));
    const status = String(pollJson?.status || "");

    if (status === "Ready") {
      const sampleUrl = pollJson?.result?.sample;
      if (typeof sampleUrl !== "string" || !sampleUrl) {
        const err = new Error("EMPTY_IMAGE_RESPONSE");
        err.status = 502;
        err.details = { provider: "flux", body: JSON.stringify(pollJson).slice(0, 2000) };
        throw err;
      }

      const img = await fetchAsDataUrl(sampleUrl, signal);
      return { images: [img], revisedPrompt: null };
    }

    if (status === "Error" || status === "Failed") {
      throw buildProviderError({
        status: 502,
        text: JSON.stringify(pollJson),
      });
    }

    // Otherwise: Processing / Pending â€” keep polling.
  }
}

module.exports = { generateImage, transformImage };
