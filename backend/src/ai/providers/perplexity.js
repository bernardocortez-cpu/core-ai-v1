function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error("PROVIDER_NOT_CONFIGURED");
    err.status = 501;
    err.details = { provider: "perplexity", missing: name };
    throw err;
  }
  return v;
}

function normalizeApiKey(raw) {
  const k = String(raw || "").trim();
  if (!k) return k;
  return k.replace(/^Bearer\s+/i, "").trim();
}

function normalizeBaseUrl(raw) {
  const b = String(raw || "").trim().replace(/\/$/, "");
  if (!b) return "https://api.perplexity.ai";
  // Some folks paste a full endpoint; keep it workable.
  return b;
}

let PERPLEXITY_SUPPORTS_PROMPT_CACHING = null;

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

function normalizeMessagesStrictAlternation(messages) {
  const sysParts = [];
  const turns = [];

  for (const m of Array.isArray(messages) ? messages : []) {
    const role = String(m?.role || "");
    const text = extractTextFromContent(m?.content);
    if (!text) continue;
    if (role === "system") {
      sysParts.push(text);
      continue;
    }
    if (role !== "user" && role !== "assistant") continue;

    const prev = turns.length > 0 ? turns[turns.length - 1] : null;
    if (prev && prev.role === role) {
      prev.content = `${prev.content}\n\n${text}`;
    } else {
      turns.push({ role, content: text });
    }
  }

  const out = [];
  if (sysParts.length > 0) out.push({ role: "system", content: sysParts.join("\n\n") });

  // Perplexity validates strict alternation after system messages.
  // If the first turn isn't user, drop it (rare, but avoids 400).
  while (turns.length > 0 && turns[0].role !== "user") turns.shift();
  // If we still have consecutive roles (shouldn't), merge.
  for (const t of turns) {
    const prev = out.length > 0 ? out[out.length - 1] : null;
    if (prev && prev.role === t.role && t.role !== "system") {
      prev.content = `${prev.content}\n\n${t.content}`;
    } else {
      out.push(t);
    }
  }

  return out;
}

function normalizeMessagesAsSingleUserTranscript(messages) {
  const sysParts = [];
  const lines = [];

  const pushLine = (roleLabel, text) => {
    const t = String(text || "").trim();
    if (!t) return;
    lines.push(`${roleLabel}: ${t}`);
  };

  for (const m of Array.isArray(messages) ? messages : []) {
    const role = String(m?.role || "");
    const text = extractTextFromContent(m?.content);
    if (!text) continue;

    if (role === "system") {
      sysParts.push(text);
      continue;
    }
    if (role === "user") pushLine("User", text);
    else if (role === "assistant") pushLine("Assistant", text);
    else if (role === "tool") pushLine("Tool", text);
  }

  const out = [];
  if (sysParts.length > 0) out.push({ role: "system", content: sysParts.join("\n\n") });

  const transcript = lines.join("\n\n");
  out.push({
    role: "user",
    content:
      transcript ||
      "Continue the conversation and answer the user's last message.",
  });

  return out;
}

function sseParseLines(buffer) {
  const normalized = String(buffer || "").replace(/\r/g, "");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() || "";
  return { frames: parts, rest };
}

function normalizeCitationItem(x) {
  if (!x) return null;
  if (typeof x === "string") return x.trim() || null;
  if (typeof x === "object") {
    const url =
      (typeof x.url === "string" && x.url) ||
      (typeof x.link === "string" && x.link) ||
      (typeof x.source === "string" && x.source) ||
      null;
    if (url) return String(url).trim() || null;
    const title = typeof x.title === "string" ? x.title.trim() : "";
    return title || null;
  }
  return null;
}

function extractCitations(json) {
  // Perplexity may return citations/sources in different shapes; keep this permissive.
  const out = [];
  const pushAll = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      const v = normalizeCitationItem(it);
      if (v) out.push(v);
    }
  };

  pushAll(json?.citations);
  pushAll(json?.sources);
  pushAll(json?.references);
  pushAll(json?.choices?.[0]?.message?.citations);
  pushAll(json?.choices?.[0]?.delta?.citations);

  return out;
}

function hasExistingSourcesSection(text) {
  const t = String(text || "");
  return /\*\*\s*(fontes|sources|refer[eê]ncias)\s*\*\*/i.test(t) || /^\s*(fontes|sources|refer[eê]ncias)\s*:\s*$/im.test(t);
}

function buildSourcesBlock(citations) {
  const list = Array.isArray(citations) ? citations : [];
  const clean = [];
  const seen = new Set();
  for (const c of list) {
    const v = String(c || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push(v);
  }
  if (clean.length === 0) return "";

  const ensureUrl = (s) => {
    const t0 = String(s || "").trim();
    // Some APIs may wrap URLs in angle brackets; normalize.
    const t = t0.replace(/^<+/, "").replace(/>+$/, "");
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    if (/^www\./i.test(t)) return `https://${t}`;
    // If it looks like a bare domain/path, assume https.
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(t)) return `https://${t}`;
    return null;
  };

  const prettyHost = (url) => {
    try {
      const u = new URL(url);
      const h = String(u.hostname || "").replace(/^www\./i, "");
      return h || url;
    } catch {
      return url;
    }
  };

  const safeMarkdownHref = (url) => {
    // Our frontend markdown renderer parses inline links by finding the first ')'.
    // Encode parentheses to avoid breaking the href parsing.
    return encodeURI(String(url || "")).replace(/\(/g, "%28").replace(/\)/g, "%29");
  };

  const lines = ["---", "", "**Fontes**", ""];
  for (let i = 0; i < clean.length; i += 1) {
    const item = clean[i];
    const url = ensureUrl(item);
    if (url) {
      const label = prettyHost(url);
      lines.push(`- [${i + 1}] [${label}](${safeMarkdownHref(url)})`);
    } else {
      lines.push(`- [${i + 1}] ${item}`);
    }
  }
  return `\n\n${lines.join("\n")}`;
}

function buildProviderError({ status, text }) {
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
    provider: "perplexity",
    code: code || null,
    message: message || null,
    body: String(text || "").slice(0, 2000),
  };

  if (process.env.DEBUG_AI === "1") {
    console.error("[perplexity] error", {
      status: err.status,
      code: err.details.code,
      message: err.details.message,
      body: err.details.body,
    });
  }
  return err;
}

function buildUrl(baseUrl) {
  // Perplexity uses an OpenAI-style endpoint at /chat/completions.
  // If the user provided a full URL, accept it.
  if (baseUrl.endsWith("/chat/completions")) return baseUrl;
  // Avoid accidental /v1/chat/completions if user pasted a v1 base.
  if (baseUrl.endsWith("/v1")) return `${baseUrl.slice(0, -3)}/chat/completions`;
  return `${baseUrl}/chat/completions`;
}

function modelVariants(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return [];
  const out = [id];
  const add = (x) => {
    const v = String(x || "").trim();
    if (v && !out.includes(v)) out.push(v);
  };

  if (id === "sonar-pro" || id === "sonar") {
    add("sonar-pro");
    add("sonar");
  }

  // Sometimes people include the provider prefix.
  if (id === "perplexity-sonar-pro") add("sonar-pro");
  if (id === "perplexity-sonar") add("sonar");

  return out;
}

function isModelishError(err) {
  if (!err) return false;
  const status = Number(err.status || 0);
  const code = String(err.details?.code || err.message || "").toLowerCase();
  const msg = String(err.details?.message || err.details?.body || "").toLowerCase();
  if (status === 404) return true;
  if (status === 400 && msg.includes("model")) return true;
  if (code.includes("model")) return true;
  return false;
}

async function streamOnce({ url, apiKey, remoteModel, messages, onDelta, signal }) {
  const cachingEnabled = String(process.env.PERPLEXITY_PROMPT_CACHING || "1") !== "0";
  const promptCacheRetention = String(process.env.PERPLEXITY_PROMPT_CACHE_RETENTION || "").trim();
  const promptCacheKey =
    String(process.env.PERPLEXITY_PROMPT_CACHE_KEY || "").trim() ||
    `coreai:v1:perplexity:${String(remoteModel || "").trim() || "unknown"}`;

  let supportsPromptCaching = PERPLEXITY_SUPPORTS_PROMPT_CACHING !== false;
  const normalizedMessages = normalizeMessagesStrictAlternation(messages);

  const parseError = (text) => {
    try {
      const j = JSON.parse(text || "{}");
      const err = j?.error || j;
      const type =
        typeof err?.type === "string"
          ? err.type
          : typeof err?.code === "string"
            ? err.code
            : null;
      const message = typeof err?.message === "string" ? err.message : "";
      const p = String(j?.error?.param || "").trim();
      return { param: p || null, type, message };
    } catch {
      return { param: null, type: null, message: "" };
    }
  };

  const doRequest = async ({ includeUsage, includeCaching, messagesOverride } = {}) => {
    const body = {
      model: remoteModel,
      messages: messagesOverride || normalizedMessages,
      stream: true,
    };
    if (includeUsage) body.stream_options = { include_usage: true };
    if (includeCaching && cachingEnabled && supportsPromptCaching) {
      body.prompt_cache_key = promptCacheKey;
      if (promptCacheRetention) body.prompt_cache_retention = promptCacheRetention;
    }

    return fetch(url, {
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

  let resp = await doRequest({ includeUsage: true, includeCaching: true });
  if (!resp.ok && resp.status === 400) {
    const text = await resp.text().catch(() => "");
    const lower = text.toLowerCase();
    const parsed = parseError(text);
    const param = parsed.param;
    const errType = String(parsed.type || "").toLowerCase();
    const errMsg = String(parsed.message || "").toLowerCase();

    const mentionsStreamOptions = lower.includes("stream_options") || param === "stream_options";
    const mentionsCaching =
      lower.includes("prompt_cache") ||
      lower.includes("prompt cache") ||
      lower.includes("cache_retention") ||
      lower.includes("cache_key") ||
      (param && param.startsWith("prompt_cache_"));

    const invalidMessage =
      errType === "invalid_message" ||
      lower.includes("should alternate") ||
      errMsg.includes("should alternate");

    if (mentionsCaching) {
      supportsPromptCaching = false;
      PERPLEXITY_SUPPORTS_PROMPT_CACHING = false;
    }

    const messagesOverride = invalidMessage
      ? normalizeMessagesAsSingleUserTranscript(messages)
      : null;

    // Retry plan: remove unsupported knobs first.
    const retryPlan = [];
    if (invalidMessage) {
      // Start by retrying with a single user transcript (strict alternation guaranteed).
      retryPlan.push({ includeUsage: true, includeCaching: true, messagesOverride });
    }
    if (mentionsStreamOptions && mentionsCaching)
      retryPlan.push({ includeUsage: false, includeCaching: false, messagesOverride });
    if (mentionsStreamOptions) retryPlan.push({ includeUsage: false, includeCaching: true, messagesOverride });
    if (mentionsCaching) retryPlan.push({ includeUsage: true, includeCaching: false, messagesOverride });
    retryPlan.push({ includeUsage: false, includeCaching: false, messagesOverride });

    for (const attempt of retryPlan) {
      resp = await doRequest(attempt);
      if (resp.ok) break;
      if (resp.status !== 400) break;
    }

    if (!resp.ok && resp.status === 400) {
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
  const citationUrls = [];
  const citationSeen = new Set();
  let pending = "";
  const pendingLimit =
    Number.parseInt(process.env.PERPLEXITY_CITATION_HOLD_CHARS || "2048", 10) || 2048;

  const ensureUrlLocal = (s) => {
    const t0 = String(s || "").trim();
    const t = t0.replace(/^<+/, "").replace(/>+$/, "");
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    if (/^www\./i.test(t)) return `https://${t}`;
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(t)) return `https://${t}`;
    return null;
  };

  const safeMarkdownHrefLocal = (url) => {
    // Our frontend markdown renderer parses inline links by finding the first ')'.
    // Encode parentheses to avoid breaking the href parsing.
    return encodeURI(String(url || "")).replace(/\(/g, "%28").replace(/\)/g, "%29");
  };

  const addCitations = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    const next = [];
    for (const it of arr) {
      const url = ensureUrlLocal(it);
      if (!url) continue;
      next.push(url);
    }
    if (next.length === 0) return;

    // Perplexity's [n] markers refer to the position in the citations list.
    // So we keep the list order stable and avoid "appending" across SSE events
    // (which would shift indices and break links).
    const nextSig = next.join("|");
    const curSig = citationUrls.join("|");
    if (nextSig === curSig) return;
    citationUrls.length = 0;
    citationUrls.push(...next);
  };

  const linkifyInlineCitationsLocal = (text) => {
    const t = String(text || "");
    if (!t) return t;
    return t.replace(/\[(\d{1,3})\](?!\()/g, (m, num) => {
      const n = Number(num);
      if (!Number.isFinite(n) || n <= 0) return m;
      const url = citationUrls[n - 1];
      if (!url) return m;
      let host = "";
      try {
        host = new URL(url).hostname.replace(/^www\./i, "");
      } catch {
        host = "";
      }
      const label = host || "fonte";
      // Replace "[n]" by a clean clickable domain, without showing the numeric marker or brackets.
      // Add a leading space so citations don't glue to the previous word.
      return ` [${label}](${safeMarkdownHrefLocal(url)})`;
    });
  };

  const flushPendingIfPossible = () => {
    if (!pending) return;
    if (citationUrls.length === 0) return;
    const linked = linkifyInlineCitationsLocal(pending);
    pending = "";
    fullText += linked;
    if (typeof onDelta === "function" && linked) onDelta(linked);
  };

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
        if (data === "[DONE]") {
          // Flush any held-back text (best-effort).
          if (pending) {
            const finalChunk = citationUrls.length > 0 ? linkifyInlineCitationsLocal(pending) : pending;
            pending = "";
            fullText += finalChunk;
            if (typeof onDelta === "function" && finalChunk) onDelta(finalChunk);
          }
          return { text: fullText, usage };
        }

        let json;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }

        const cits = extractCitations(json);
        if (cits.length > 0) addCitations(cits);
        flushPendingIfPossible();

        if (json.usage) usage = json.usage;

        const delta = json?.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          // If we see markers but still don't have citations, hold briefly so we can linkify later.
          if (citationUrls.length === 0 && /\[\d{1,3}\]/.test(delta)) {
            pending += delta;
            if (pending.length >= pendingLimit) {
              fullText += pending;
              if (typeof onDelta === "function") onDelta(pending);
              pending = "";
            }
            continue;
          }

          const linked = linkifyInlineCitationsLocal(delta);
          fullText += linked;
          if (typeof onDelta === "function") onDelta(linked);
        }
      }
    }
  }

  if (pending) {
    const finalChunk = citationUrls.length > 0 ? linkifyInlineCitationsLocal(pending) : pending;
    pending = "";
    fullText += finalChunk;
    if (typeof onDelta === "function" && finalChunk) onDelta(finalChunk);
  }
  return { text: fullText, usage };
}

async function streamChat({ remoteModel, messages, onDelta, signal }) {
  const apiKey = normalizeApiKey(requireEnv("PERPLEXITY_API_KEY"));
  const baseUrl = normalizeBaseUrl(process.env.PERPLEXITY_BASE_URL);
  const url = buildUrl(baseUrl);

  if (process.env.DEBUG_AI === "1") {
    console.error("[perplexity] request", {
      remoteModel,
      baseUrl,
      url,
      keyLen: apiKey.length,
      keyLast4: apiKey.slice(-4),
    });
  }

  const ids = modelVariants(remoteModel);
  let lastErr = null;
  for (const modelId of ids) {
    try {
      const out = await streamOnce({ url, apiKey, remoteModel: modelId, messages, onDelta, signal });
      if (process.env.DEBUG_AI === "1" && modelId !== remoteModel) {
        console.error("[perplexity] model fallback", { from: remoteModel, to: modelId });
      }
      return out;
    } catch (e) {
      lastErr = e;
      if (isModelishError(e)) continue;
      throw e;
    }
  }

  throw lastErr;
}

module.exports = { streamChat };
