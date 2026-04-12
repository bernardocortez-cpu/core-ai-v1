const crypto = require("crypto");

// Very small in-memory cache to avoid re-classifying the same prompt repeatedly.
// This is intentionally simple (no deps) and safe to lose on restart.
const CACHE = new Map(); // key -> { value, expiresAt }

// OpenAI parameter compatibility:
// - Some newer models reject `max_tokens` and require `max_completion_tokens` instead.
// - Some gateways reject `response_format`.
// Learn the best token param at runtime to avoid repeated 400s.
let PREFERRED_OPENAI_MAX_TOKENS_PARAM = (() => {
  const raw = String(process.env.ROUTER_CLASSIFIER_MAX_TOKENS_PARAM || "").trim();
  if (raw === "max_tokens" || raw === "max_completion_tokens" || raw === "none") return raw;
  // Default to the modern param (newer OpenAI models may reject `max_tokens`).
  return "max_completion_tokens";
})();

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs) {
  CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
}

function clampText(text, maxChars) {
  const t = String(text || "");
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars) + "\n\n[TRUNCATED]";
}

function normalizeIntent(v) {
  const s = String(v || "").toLowerCase();
  if (["code", "creative", "factual", "planning", "general"].includes(s)) return s;
  return null;
}

function coerceIntent(rawIntent) {
  const raw = String(rawIntent || "").trim();
  const s = raw.toLowerCase();
  const direct = normalizeIntent(s);
  if (direct) return direct;

  // Graceful mapping: some models invent intent labels (e.g. "capital_question").
  if (s.includes("code") || s.includes("program")) return "code";
  if (s.includes("creative") || s.includes("story") || s.includes("poem") || s.includes("lyrics")) return "creative";
  if (
    s.includes("factual") ||
    s.includes("fact") ||
    s.includes("wiki") ||
    s.includes("capital") ||
    s.includes("question") ||
    s.includes("knowledge")
  )
    return "factual";
  if (s.includes("plan") || s.includes("strategy") || s.includes("roadmap")) return "planning";
  return "general";
}

function normalizeDifficulty(v) {
  const s = String(v || "").toLowerCase();
  if (["easy", "medium", "hard"].includes(s)) return s;
  return null;
}

function tryParseJsonObject(s) {
  // Prefer strict JSON.
  try {
    const j = JSON.parse(s);
    if (j && typeof j === "object") return j;
  } catch {
    // ignore
  }

  // Fallback: extract the first {...} block (LLMs sometimes add a sentence).
  const str = String(s || "");
  const start = str.indexOf("{");
  const end = str.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    const slice = str.slice(start, end + 1);
    try {
      const j = JSON.parse(slice);
      if (j && typeof j === "object") return j;
    } catch {
      // ignore
    }
  }
  return null;
}

function otherTokenParamName(name) {
  return name === "max_completion_tokens" ? "max_tokens" : "max_completion_tokens";
}

function detectSuggestedTokenParamFromErrorBody(textBody) {
  const lower = String(textBody || "").toLowerCase();
  // Common OpenAI error:
  // "Unsupported parameter: 'max_tokens' ... Use 'max_completion_tokens' instead."
  if (lower.includes("max_tokens") && lower.includes("max_completion_tokens")) {
    if (lower.includes("use 'max_completion_tokens'") || lower.includes("use \"max_completion_tokens\"")) {
      return "max_completion_tokens";
    }
    if (lower.includes("use 'max_tokens'") || lower.includes("use \"max_tokens\"")) {
      return "max_tokens";
    }
    // Default to the newer param when both are mentioned.
    return "max_completion_tokens";
  }
  return null;
}

function looksLikeUnsupportedTokenParamError(textBody) {
  const lower = String(textBody || "").toLowerCase();
  return (
    (lower.includes("unsupported parameter") || lower.includes("unsupported_parameter")) &&
    (lower.includes("max_tokens") || lower.includes("max_completion_tokens"))
  );
}

async function classifyWithOpenAI({ text, signal }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = process.env.ROUTER_CLASSIFIER_REMOTE_MODEL || "gpt-5-nano";

  const prompt = clampText(text, 2500);

  const system =
    "You are a fast classifier for routing requests to different AI models.\n" +
    "Return ONLY valid JSON with the keys: intent, difficulty.\n" +
    "intent must be one of: code, creative, factual, planning, general.\n" +
    "difficulty must be one of: easy, medium, hard.\n" +
    "Do not invent new intent labels.\n" +
    "If unsure, set intent to general.\n" +
    "No extra keys. No markdown. No explanations.";

  const messages = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];

  const doRequest = async ({ includeResponseFormat, tokenParamName, maxOut } = {}) => {
    const tokenMode =
      tokenParamName === "none"
        ? "none"
        : tokenParamName === "max_tokens"
          ? "max_tokens"
          : "max_completion_tokens";
    const body = {
      model,
      messages,
      stream: false,
    };
    const max = Number.isFinite(maxOut) ? maxOut : 600;
    if (tokenMode !== "none") body[tokenMode] = max;

    if (includeResponseFormat) body.response_format = { type: "json_object" };

    return fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
  };

  // Try a small compatibility matrix:
  // - token param: prefer `max_completion_tokens` (newer models may reject `max_tokens`)
  // - response_format: retry without on 400
  let preferredParam = PREFERRED_OPENAI_MAX_TOKENS_PARAM || "max_completion_tokens";
  let resp = null;
  let lastTextBody = "";
  const tried = new Set();

  const buildAttempts = (tokenParamName) => [
    { includeResponseFormat: true, tokenParamName },
    { includeResponseFormat: false, tokenParamName },
    // Last resort: omit token limit params entirely (some models/gateways are picky).
    { includeResponseFormat: true, tokenParamName: "none" },
    { includeResponseFormat: false, tokenParamName: "none" },
  ];

  let attempts = buildAttempts(preferredParam);
  for (let i = 0; i < attempts.length; i += 1) {
    const a = attempts[i];
    const key = `${a.tokenParamName}:${a.includeResponseFormat ? "fmt" : "nofmt"}`;
    if (tried.has(key)) continue;
    tried.add(key);

    const maxOut = (() => {
      const raw = Number(process.env.ROUTER_CLASSIFIER_MAX_COMPLETION_TOKENS || 600);
      return Number.isFinite(raw) && raw > 0 ? raw : 600;
    })();

    resp = await doRequest({ ...a, maxOut });
    if (resp.ok) {
      // Learn so future classifications don't pay extra retries.
      PREFERRED_OPENAI_MAX_TOKENS_PARAM = a.tokenParamName;
      break;
    }

    if (resp.status === 400) {
      lastTextBody = await resp.text().catch(() => "");
      const suggested = detectSuggestedTokenParamFromErrorBody(lastTextBody);
      if (suggested && suggested !== a.tokenParamName) {
        // Rebuild attempt order centered on the suggested param.
        preferredParam = suggested;
        attempts = buildAttempts(preferredParam);
        i = -1;
        continue;
      }
      // If the API complains about token params, try without them.
      if (looksLikeUnsupportedTokenParamError(lastTextBody) && a.tokenParamName !== "none") {
        attempts = buildAttempts("none");
        i = -1;
        continue;
      }
      // Otherwise, keep iterating through the matrix.
      continue;
    }

    // Non-400: don't spam retries.
    lastTextBody = await resp.text().catch(() => "");
    break;
  }

  if (!resp.ok) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[router.classifier] openai failed", {
        status: resp.status,
        body: String(lastTextBody || "").slice(0, 500),
      });
    }
    return null;
  }

  const json = await resp.json().catch(() => null);
  const msg = json?.choices?.[0]?.message || null;
  // Some models may return structured content via tool calls / function_call,
  // or have non-string `content`. Prefer extracting JSON from any available field.
  const content =
    (typeof msg?.content === "string" ? msg.content : "") ||
    (typeof msg?.function_call?.arguments === "string" ? msg.function_call.arguments : "") ||
    (Array.isArray(msg?.tool_calls) && typeof msg.tool_calls?.[0]?.function?.arguments === "string"
      ? msg.tool_calls[0].function.arguments
      : "") ||
    "";
  const parsed = tryParseJsonObject(content);
  if (!parsed) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[router.classifier] non-json output", {
        model,
        sample: String(content || "").slice(0, 180),
      });
    }
    return null;
  }

  const intent = coerceIntent(parsed.intent);
  const difficulty = normalizeDifficulty(parsed.difficulty);
  if (!intent || !difficulty) return null;

  return { intent, difficulty };
}

async function classifyForRouting({ text }) {
  // Feature flag (default: enabled for paid plans; router decides when to call).
  if (String(process.env.ROUTER_CLASSIFIER || "1") === "0") return null;

  const t = String(text || "").trim();
  if (!t) return null;

  const timeoutMs = Number(process.env.ROUTER_CLASSIFIER_TIMEOUT_MS || 1200);
  const ttlMs = Number(process.env.ROUTER_CLASSIFIER_CACHE_TTL_MS || 10 * 60 * 1000);

  const key = sha256(t);
  const cached = cacheGet(key);
  if (cached) return cached;

  // Node 18+ has global AbortController. If not, we still try without timeout.
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }, timeoutMs)
    : null;

  try {
    const classification = await classifyWithOpenAI({ text: t, signal: controller?.signal });
    if (classification) cacheSet(key, classification, ttlMs);
    return classification;
  } catch (e) {
    const msg = String(e?.message || e || "");
    const aborted =
      Boolean(controller?.signal?.aborted) ||
      String(e?.name || "").toLowerCase().includes("abort") ||
      msg.toLowerCase().includes("aborted");

    if (process.env.DEBUG_AI === "1") {
      if (aborted) {
        // Expected when the classifier hits its strict timeout.
        console.log("[router.classifier] timeout", { timeoutMs });
      } else {
        console.error("[router.classifier] error", msg);
      }
    }
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = { classifyForRouting };
