const { normalizePlan, isPaidPlan } = require("../../config/plans");
const { perplexitySearch } = require("./providers/perplexity");
const { runInProviderQueue } = require("../queues");

const MAX_CONTEXT_TURNS = 6;
const MAX_SUMMARY_CHARS = 1200;
const MAX_TURN_CHARS = 520;
const MIN_FALLBACK_TIMEOUT_MS = 2500;
const STOPWORDS = new Set([
  "a",
  "about",
  "agora",
  "ai",
  "ainda",
  "algo",
  "algum",
  "alguma",
  "algumas",
  "alguns",
  "all",
  "and",
  "ao",
  "aos",
  "as",
  "at",
  "ate",
  "com",
  "como",
  "da",
  "das",
  "de",
  "dela",
  "dele",
  "deles",
  "depois",
  "do",
  "dos",
  "e",
  "ela",
  "elas",
  "ele",
  "eles",
  "em",
  "entao",
  "era",
  "eram",
  "essa",
  "essas",
  "esse",
  "esses",
  "esta",
  "estao",
  "estas",
  "este",
  "estes",
  "eu",
  "foi",
  "for",
  "foram",
  "had",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "isso",
  "isto",
  "it",
  "its",
  "ja",
  "la",
  "mais",
  "mas",
  "me",
  "mesmo",
  "minha",
  "minhas",
  "meu",
  "meus",
  "na",
  "nas",
  "nao",
  "nem",
  "no",
  "nos",
  "nossa",
  "nossas",
  "nosso",
  "nossos",
  "o",
  "of",
  "on",
  "or",
  "os",
  "ou",
  "para",
  "pela",
  "pelas",
  "pelo",
  "pelos",
  "por",
  "porque",
  "que",
  "qual",
  "quando",
  "quanto",
  "se",
  "sem",
  "ser",
  "sera",
  "seu",
  "seus",
  "she",
  "so",
  "sobre",
  "sua",
  "suas",
  "tal",
  "tambem",
  "te",
  "tem",
  "than",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "to",
  "tu",
  "um",
  "uma",
  "umas",
  "uns",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
]);

function canUseWebSearch(plan) {
  const p = normalizePlan(plan);
  return isPaidPlan(p);
}

function abortSignalAny(signals) {
  const list = (Array.isArray(signals) ? signals : []).filter(Boolean);
  if (list.length === 0) return undefined;

  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
    return AbortSignal.any(list);
  }

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  for (const s of list) {
    try {
      if (s.aborted) {
        controller.abort();
        break;
      }
      s.addEventListener("abort", onAbort, { once: true });
    } catch {
      // ignore
    }
  }
  return controller.signal;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactText(value, maxChars) {
  const text = normalizeText(value);
  const cap = Math.max(80, Number(maxChars) || 0);
  if (!text || text.length <= cap) return text;
  const head = Math.max(48, Math.ceil(cap * 0.62));
  const tail = Math.max(24, cap - head - 5);
  return `${text.slice(0, head)} ... ${text.slice(-tail)}`;
}

function stripInternalNotes(value) {
  let text = String(value || "");
  text = text.replace(/\[CHAT SUMMARY\][\s\S]*?\[\/CHAT SUMMARY\]/gi, " ");
  text = text.replace(/\n{2,}\[(?:Anexos recebidos|Conteudo extraido dos anexos|Anexo enviado:)[\s\S]*$/i, "");
  return normalizeText(text);
}

function contentToText(content) {
  if (typeof content === "string") return stripInternalNotes(content);
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    return stripInternalNotes(joined);
  }
  if (content && typeof content === "object" && typeof content.text === "string") {
    return stripInternalNotes(content.text);
  }
  return "";
}

function extractConversationSummary(messages) {
  const items = Array.isArray(messages) ? messages : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const message = items[i];
    if (String(message?.role || "").toLowerCase() !== "system") continue;
    const text = typeof message?.content === "string" ? message.content : "";
    if (!text.includes("[CHAT SUMMARY]")) continue;
    const match = text.match(/\[CHAT SUMMARY\]([\s\S]*?)\[\/CHAT SUMMARY\]/i);
    const summary = normalizeText(match?.[1] || text);
    if (summary) return compactText(summary, MAX_SUMMARY_CHARS);
  }
  return "";
}

function extractRecentTurns(messages) {
  const items = Array.isArray(messages) ? messages : [];
  const turns = [];
  for (const message of items) {
    const role = String(message?.role || "").toLowerCase();
    if (role !== "user" && role !== "assistant") continue;
    const text = contentToText(message?.content);
    if (!text) continue;
    turns.push({
      role,
      text: compactText(text, MAX_TURN_CHARS),
    });
  }
  return turns.slice(-MAX_CONTEXT_TURNS);
}

function asciiFold(value) {
  return normalizeText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isLikelyContextDependentQuery(query) {
  const q = asciiFold(query);
  if (!q) return false;
  if (
    /^(e\s+)?(quanto|como|quando|onde|porque|qual|quais|quem|how|when|where|why|what|which|who)\b/.test(q) &&
    q.length < 72
  ) {
    return true;
  }
  if (/^(and|then|also|but|agora|entao|mas)\b/.test(q) && q.length < 96) return true;
  if (/\b(isso|isto|essa|esse|essas|esses|aquele|aquela|aquilo|it|that|those|these|them|they)\b/.test(q)) {
    return true;
  }
  if (
    q.length < 36 &&
    !/\b(api|sdk|pricing|price|cost|gpt|claude|openai|anthropic|perplexity|vercel|render|supabase|postgres|prisma|javascript|typescript|react|node)\b/.test(
      q
    )
  ) {
    return true;
  }
  return false;
}

function extractKeywordHints({ query, summary, turns }) {
  const chunks = [
    query,
    ...(Array.isArray(turns) ? [...turns].reverse().map((turn) => turn.text) : []),
    summary,
  ];
  const out = [];
  const seen = new Set();

  for (const chunk of chunks) {
    const tokens = asciiFold(chunk).match(/[a-z0-9][a-z0-9._-]{1,31}/g) || [];
    for (const token of tokens) {
      if (STOPWORDS.has(token)) continue;
      if (!/\d/.test(token) && token.length < 3) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
      if (out.length >= 12) return out.join(" ");
    }
  }

  return out.join(" ");
}

function buildSearchPlan({ query, locale, messages }) {
  const summary = extractConversationSummary(messages);
  const turns = extractRecentTurns(messages);
  const contextual = isLikelyContextDependentQuery(query) || Boolean(summary) || turns.length > 1;
  const baseKeywordHints = extractKeywordHints({ query, summary: "", turns: [] });
  const keywordHints = extractKeywordHints({ query, summary, turns });
  const normalizedQuery = normalizeText(query);
  const contextTurns = turns.filter((turn, index) => {
    return !(
      index === turns.length - 1 &&
      turn.role === "user" &&
      normalizeText(turn.text) === normalizedQuery
    );
  });
  const contextLines = contextTurns.map(
    (turn) => `- ${turn.role === "assistant" ? "Assistant" : "User"}: ${turn.text}`
  );
  const variants = [];

  const primarySections = [];
  primarySections.push(`Latest user question:\n${normalizeText(query)}`);
  if (summary) primarySections.push(`Conversation summary:\n${summary}`);
  if (contextLines.length > 0) primarySections.push(`Recent conversation context:\n${contextLines.join("\n")}`);
  primarySections.push(
    "Research instructions:\n" +
      "- Answer the latest user question.\n" +
      "- Use the conversation context only to resolve references, pronouns, dates, products, or entities.\n" +
      `- Search in ${locale || "the user's language"} and in English whenever that improves coverage.\n` +
      "- Prefer official, primary, or up-to-date sources for factual claims.\n" +
      "- If the topic is broad, collect the strongest confirmed facts first."
  );
  variants.push({
    label: contextual ? "contextual" : "direct",
    prompt: primarySections.join("\n\n"),
  });

  if (keywordHints && keywordHints !== baseKeywordHints && keywordHints.split(" ").length >= 2) {
    const alternateSections = [];
    alternateSections.push(`Latest user question:\n${normalizeText(query)}`);
    alternateSections.push(`Resolved entities and search hints:\n${keywordHints}`);
    if (summary) alternateSections.push(`Conversation summary:\n${summary}`);
    alternateSections.push(
      "Search angles:\n" +
        "- Try alternate wording, abbreviations, and close synonyms.\n" +
        "- Search in Portuguese and English when useful.\n" +
        "- Prefer official/current sources first, then reputable secondary sources if they improve coverage."
    );
    variants.push({
      label: "keyword-hints",
      prompt: alternateSections.join("\n\n"),
    });
  }

  const uniqueVariants = [];
  const seenPrompts = new Set();
  for (const variant of variants) {
    const key = asciiFold(variant.prompt);
    if (!key || seenPrompts.has(key)) continue;
    seenPrompts.add(key);
    uniqueVariants.push(variant);
  }

  return {
    variants: uniqueVariants,
    contextual,
    hasSummary: Boolean(summary),
    contextTurns: contextTurns.length,
  };
}

function chooseBetterSource(current, candidate) {
  const score = (source) => {
    if (!source) return -1;
    let total = 0;
    if (source.snippet) total += 2;
    if (source.date) total += 1;
    if (source.title && source.title !== source.host) total += 1;
    return total;
  };
  return score(candidate) > score(current) ? candidate : current;
}

function mergeSources(items, maxSources) {
  const seen = new Map();
  for (const source of Array.isArray(items) ? items : []) {
    if (!source?.url) continue;
    const key = String(source.url).trim().toLowerCase();
    if (!key) continue;
    seen.set(key, chooseBetterSource(seen.get(key), source));
  }
  return Array.from(seen.values()).slice(0, Math.max(1, Number(maxSources) || 1));
}

function mergeSummaries(results) {
  const parts = [];
  const seen = new Set();
  for (const result of Array.isArray(results) ? results : []) {
    const summary = normalizeText(result?.summary);
    if (!summary) continue;
    const key = summary.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(summary);
  }
  if (parts.length === 0) return "";
  return compactText(parts.join("\n\n"), 1800);
}

function mergeSearchOutputs(results, maxSources) {
  const okResults = (Array.isArray(results) ? results : []).filter((result) => {
    return Array.isArray(result?.sources) && result.sources.length > 0;
  });
  if (okResults.length === 0) return null;

  return {
    summary: mergeSummaries(okResults),
    sources: mergeSources(
      okResults.flatMap((result) => result.sources || []),
      maxSources
    ),
    fetchedAt:
      okResults
        .map((result) => result.fetchedAt)
        .filter(Boolean)
        .sort()
        .slice(-1)[0] || new Date().toISOString(),
  };
}

function isWeakSearchOutput(out) {
  const sourcesCount = Array.isArray(out?.sources) ? out.sources.length : 0;
  const summaryLen = normalizeText(out?.summary).length;
  return sourcesCount < 2 || summaryLen < 120;
}

function remainingTime(deadlineAt) {
  return Math.max(0, Number(deadlineAt) - Date.now());
}

async function searchLayer({
  query,
  messages,
  plan,
  maxSources = 15,
  timeoutMs = 20000,
  locale = "en-US",
  signal,
} = {}) {
  const q = String(query || "").trim();
  if (!q) return { ok: false, error: "EMPTY_QUERY" };

  const allowed = canUseWebSearch(plan);
  if (!allowed) return { ok: false, denied: true, error: "WEBSEARCH_NOT_ALLOWED_FOR_PLAN" };

  const effectiveTimeoutMs = Math.max(500, Number(timeoutMs) || 20000);
  const maxTokens = Number(process.env.WEBSEARCH_MAX_TOKENS || "320");
  const deadlineAt = Date.now() + effectiveTimeoutMs;
  const minAttemptBudget = Math.min(MIN_FALLBACK_TIMEOUT_MS, effectiveTimeoutMs);
  const searchPlan = buildSearchPlan({ query: q, locale, messages });
  const variants =
    Array.isArray(searchPlan.variants) && searchPlan.variants.length > 0
      ? searchPlan.variants
      : [{ label: "direct", prompt: q }];

  async function attempt({ variant, attemptTimeoutMs, attemptSources, attemptTokens }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(500, Number(attemptTimeoutMs) || 0));
    const combinedSignal = abortSignalAny([signal, controller.signal]);
    const startedAt = Date.now();

    try {
      const out = await runInProviderQueue(
        "perplexity",
        async ({ signal: qSignal }) => {
          return perplexitySearch({
            query: variant.prompt,
            maxSources: attemptSources,
            maxTokens: attemptTokens,
            locale,
            signal: qSignal,
          });
        },
        { type: "text", plan, signal: combinedSignal, maxRetries: 1 }
      );

      const sourcesCount = Array.isArray(out?.sources) ? out.sources.length : 0;
      const summaryLen = normalizeText(out?.summary).length;
      console.log("[websearch] attempt", {
        label: variant.label,
        durationMs: Date.now() - startedAt,
        promptLen: variant.prompt.length,
        sourcesCount,
        summaryLen,
      });
      if (sourcesCount === 0) return { ok: false, error: "WEBSEARCH_NO_SOURCES" };
      return { ok: true, out };
    } catch (e) {
      const timedOut = Boolean(controller.signal.aborted);
      const cancelledByClient = Boolean(!timedOut && signal?.aborted);
      if (cancelledByClient) return { ok: false, error: "WEBSEARCH_CANCELLED" };
      return { ok: false, error: timedOut ? "WEBSEARCH_TIMEOUT" : "WEBSEARCH_FAILED", cause: e };
    } finally {
      clearTimeout(timer);
    }
  }

  console.log("[websearch] query", {
    len: q.length,
    maxSources,
    locale,
    timeoutMs: effectiveTimeoutMs,
    variants: variants.map((variant) => variant.label),
    contextual: searchPlan.contextual,
    contextTurns: searchPlan.contextTurns,
    hasSummary: searchPlan.hasSummary,
  });

  const firstAttemptBudget =
    variants.length > 1
      ? Math.max(minAttemptBudget, Math.floor(effectiveTimeoutMs * 0.62))
      : effectiveTimeoutMs;

  const a1 = await attempt({
    variant: variants[0],
    attemptTimeoutMs: Math.max(
      minAttemptBudget,
      Math.min(firstAttemptBudget, remainingTime(deadlineAt))
    ),
    attemptSources: maxSources,
    attemptTokens: maxTokens,
  });

  if (a1.error === "WEBSEARCH_CANCELLED") return { ok: false, error: "WEBSEARCH_CANCELLED" };

  let bestOut = a1.ok ? a1.out : null;
  let lastError = a1.error || "WEBSEARCH_FAILED";
  let lastCause = a1.cause || null;

  const shouldTryFallback =
    variants.length > 1 &&
    remainingTime(deadlineAt) >= minAttemptBudget &&
    (!a1.ok || isWeakSearchOutput(a1.out));

  if (shouldTryFallback) {
    const a2 = await attempt({
      variant: variants[1],
      attemptTimeoutMs: remainingTime(deadlineAt),
      attemptSources: maxSources,
      attemptTokens: maxTokens,
    });

    if (a2.error === "WEBSEARCH_CANCELLED") return { ok: false, error: "WEBSEARCH_CANCELLED" };

    if (a1.ok && a2.ok) {
      bestOut = mergeSearchOutputs([a1.out, a2.out], maxSources) || a1.out;
    } else if (!bestOut && a2.ok) {
      bestOut = a2.out;
    }

    lastError = a2.error || lastError;
    lastCause = a2.cause || lastCause;
  }

  if (bestOut) {
    const sourcesCount = Array.isArray(bestOut?.sources) ? bestOut.sources.length : 0;
    console.log("[websearch] sources:", sourcesCount);
    return {
      ok: true,
      provider: "perplexity",
      fetchedAt: bestOut.fetchedAt || new Date().toISOString(),
      summary: bestOut.summary || "",
      sources: bestOut.sources || [],
    };
  }

  const code = lastError || "WEBSEARCH_FAILED";
  if (process.env.DEBUG_ERRORS === "1") {
    console.error("[websearch] error", {
      code,
      message: String(lastCause || ""),
    });
  } else {
    console.log("[websearch] error", code);
  }
  return { ok: false, error: code };
}

function buildInjectedWebContext({ fetchedAt, summary, sources }) {
  const list = Array.isArray(sources) ? sources : [];
  const safe = (s) => String(s || "").replace(/\s+/g, " ").trim();

  const lines = [];
  lines.push("Web Search (resultados verificados)");
  if (fetchedAt) lines.push(`Data: ${safe(fetchedAt)}`);
  lines.push("");
  lines.push("Resultados:");
  for (const src of list) {
    const title = safe(src?.title) || safe(src?.site) || safe(src?.host) || "Fonte";
    const url = safe(src?.url);
    const snippet = safe(src?.snippet);
    const date = safe(src?.date);
    const host = safe(src?.host);
    lines.push(`- ${title}${host ? ` (${host})` : ""}${url ? ` - ${url}` : ""}`);
    if (date) lines.push(`  - data: ${date}`);
    if (snippet) lines.push(`  - excerto: ${snippet}`);
  }
  if (summary) {
    lines.push("");
    lines.push("Resumo factual consolidado:");
    lines.push(safe(summary));
  }
  lines.push("");
  lines.push(
    "Instrucoes:",
    "- Usa estes resultados como contexto web prioritario.",
    "- Se os resultados cobrirem so parte da pergunta, responde com o que esta suportado e diz o que ficou por confirmar.",
    "- Nao digas que algo 'nao foi encontrado' a menos que esse ponto tenha mesmo ficado sem suporte nos resultados.",
    "- Inclui citacoes inline como links Markdown com o hostname como texto, ex: [ecb.europa.eu](https://...)."
  );
  return lines.join("\n");
}

module.exports = {
  canUseWebSearch,
  searchLayer,
  buildInjectedWebContext,
};
