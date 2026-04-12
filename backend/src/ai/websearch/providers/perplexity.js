function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    const err = new Error("WEBSEARCH_PROVIDER_NOT_CONFIGURED");
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
  return b;
}

function buildUrl(baseUrl) {
  if (baseUrl.endsWith("/chat/completions")) return baseUrl;
  if (baseUrl.endsWith("/v1")) return `${baseUrl.slice(0, -3)}/chat/completions`;
  return `${baseUrl}/chat/completions`;
}

function safeHostname(url) {
  try {
    const u = new URL(String(url || ""));
    return String(u.hostname || "").replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function normalizeUrlLike(raw) {
  let url = String(raw || "").trim();
  if (!url) return null;
  if (url.startsWith("<") && url.endsWith(">")) url = url.slice(1, -1).trim();
  if (/^www\./i.test(url)) url = `https://${url}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(url) && !/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

function extractJsonObject(text) {
  const s = String(text || "");
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) return null;
  const candidate = s.slice(first, last + 1);
  return candidate;
}

function normalizeSourceItem(x) {
  if (!x || typeof x !== "object") return null;
  const url = normalizeUrlLike(x.url);
  if (!url) return null;
  const title = typeof x.title === "string" ? x.title.trim().slice(0, 200) : "";
  const snippet = typeof x.snippet === "string" ? x.snippet.trim().slice(0, 320) : "";
  const date = typeof x.date === "string" ? x.date.trim() : "";
  const host = safeHostname(url) || (typeof x.host === "string" ? x.host.trim() : "");
  return {
    title: title || host || url,
    url,
    snippet: snippet || "",
    date: date || null,
    host: host || null,
  };
}

function extractCitations(json) {
  const out = [];
  const pushAll = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const it of arr) {
      const url =
        (typeof it === "string" && it) ||
        (typeof it?.url === "string" && it.url) ||
        (typeof it?.link === "string" && it.link) ||
        (typeof it?.source === "string" && it.source) ||
        null;
      const norm = normalizeUrlLike(url);
      if (norm) out.push(norm);
    }
  };

  pushAll(json?.citations);
  pushAll(json?.sources);
  pushAll(json?.references);
  pushAll(json?.choices?.[0]?.message?.citations);

  return out;
}

function sourcesFromCitations(urls, maxSources) {
  const clean = [];
  const seen = new Set();
  for (const u0 of Array.isArray(urls) ? urls : []) {
    const u = normalizeUrlLike(u0);
    if (!u) continue;
    const k = u.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const host = safeHostname(u);
    clean.push({
      title: host || u,
      url: u,
      snippet: "",
      date: null,
      host: host || null,
    });
    if (clean.length >= maxSources) break;
  }
  return clean;
}

function extractSearchResults(json) {
  const candidates =
    json?.search_results ||
    json?.searchResults ||
    json?.results ||
    json?.web_results ||
    json?.webResults ||
    json?.data?.search_results ||
    null;

  if (!Array.isArray(candidates)) return null;
  return candidates;
}

async function perplexitySearch({ query, maxSources = 15, locale = "pt-PT", maxTokens = 320, signal } = {}) {
  const apiKey = normalizeApiKey(requireEnv("PERPLEXITY_API_KEY"));
  const baseUrl = normalizeBaseUrl(process.env.PERPLEXITY_BASE_URL);
  const url = buildUrl(baseUrl);

  const q = String(query || "").trim();
  const n = Math.max(1, Math.min(15, Number(maxSources) || 15));

  const system =
    "You are a web research layer for a chat assistant. Search broadly before concluding that nothing was found.\n" +
    "Use the latest user question as the target, and use any provided conversation context only to resolve references and ambiguity.\n" +
    "Search in the user's language and in English whenever that improves coverage.\n" +
    "Return a dense factual synthesis with short bullets when useful. Do NOT include a separate 'Sources' section; citations are handled by the API.\n" +
    `Language: ${locale}.`;

  const body = {
    model: "sonar-pro",
    stream: false,
    temperature: 0.1,
    max_tokens: Math.max(64, Math.min(800, Number(maxTokens) || 320)),
    messages: [
      { role: "system", content: system },
      { role: "user", content: q },
    ],
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });

  const text = await resp.text();
  if (!resp.ok) {
    const err = new Error("WEBSEARCH_PROVIDER_ERROR");
    err.status = resp.status;
    err.details = { provider: "perplexity", body: text.slice(0, 2000) };
    throw err;
  }

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error("WEBSEARCH_BAD_JSON");
    err.status = 502;
    err.details = { provider: "perplexity", body: text.slice(0, 2000) };
    throw err;
  }

  // Prefer structured results if the API provides them.
  const sr = extractSearchResults(json);
  if (Array.isArray(sr) && sr.length > 0) {
    const sources = sr.map(normalizeSourceItem).filter(Boolean).slice(0, n);
    const content = String(json?.choices?.[0]?.message?.content ?? "").trim();
    return {
      summary: content,
      sources,
      fetchedAt: new Date().toISOString(),
    };
  }

  // Fallback: use citations URLs (robust). Some environments won't include rich snippets/titles.
  const citations = extractCitations(json);
  const sources = sourcesFromCitations(citations, n);
  const summary = String(json?.choices?.[0]?.message?.content ?? "").trim();

  return {
    summary,
    sources,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { perplexitySearch };
