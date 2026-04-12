const { isPaidPlan } = require("../config/plans");
const { getModel } = require("./models");
const { classifyForRouting } = require("./classifier");

function providerConfigured(provider) {
  // Route only to providers that are implemented AND have keys.
  // This avoids picking stubbed providers (Claude/Grok/etc) and then failing.
  if (provider === "openai") return !!process.env.OPENAI_API_KEY;
  if (provider === "gemini") return !!process.env.GEMINI_API_KEY;
  if (provider === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
  if (provider === "grok") return !!process.env.XAI_API_KEY || !!process.env.GROK_API_KEY;
  if (provider === "deepseek") return !!process.env.DEEPSEEK_API_KEY;
  if (provider === "moonshot") return !!process.env.MOONSHOT_API_KEY || !!process.env.KIMI_API_KEY;
  if (provider === "perplexity") return !!process.env.PERPLEXITY_API_KEY;
  if (provider === "qwen") return !!process.env.QWEN_API_KEY || !!process.env.DASHSCOPE_API_KEY;
  return false;
}

function routerEnabledForPlan(plan) {
  // "Router inteligente" (auto-routing) is only for these plans.
  // FREE still gets a fixed cheap model (no classifier).
  const p = String(plan || "FREE").toUpperCase();
  return p === "PRO" || p === "PLUS" || p === "MAX";
}

function pickFirst(...ids) {
  for (const id of ids) {
    const m = getModel(id);
    if (m && providerConfigured(m.provider)) return m;
  }
  return null;
}

function claudeEnabledForAuto() {
  // Keep current routing behavior unless explicitly enabled.
  // This prevents unexpected provider switches when you first add a Claude key.
  return process.env.ROUTER_USE_CLAUDE === "1" && providerConfigured("anthropic");
}

function looksLikeCode(text) {
  const t = String(text || "");
  return (
    /```/.test(t) ||
    /\b(function|const|let|var|class|import|from|def|return)\b/.test(t) ||
    /[{}`;]/.test(t)
  );
}

function looksCreative(text) {
  const t = String(text || "").toLowerCase();
  return /\b(poema|historia|conto|roteiro|criativo|lyrics|story|poem)\b/.test(t);
}

function looksFactual(text) {
  const t = String(text || "").toLowerCase();
  // Keep it simple; we just want a weak signal.
  return /\b(quando|onde|porque|o que e|define|wikipedia|fact|data)\b/.test(t);
}

function looksHard(text, opts = {}) {
  const t = String(text || "");
  const lc = t.toLowerCase();

  // Heuristics: long prompts or "hard" keywords => pick a stronger model.
  const long = t.length >= 650; // rough proxy for tokens
  const hardWords =
    /\b(arquitetura|otimiza|otimizar|complexo|avancad[oa]|prova|demonstra|benchmark|sistema|distribu[ií]do|concorr[eê]ncia|seguran[cç]a|escal[aá]vel|performance)\b/.test(
      lc
    );
  // Users often write constraints with different bullet styles (e.g. "- " or "– ").
  const bulletLikeCount =
    (t.match(/- /g) || []).length + (t.match(/\u2013\s/g) || []).length + (t.match(/\u2014\s/g) || []).length;
  const hasManyConstraints = (t.match(/\n/g) || []).length >= 6 || bulletLikeCount >= 4;
  return long || hardWords || hasManyConstraints;
}

// Main router:
// - FREE: deterministic default (no classifier)
// - Paid: pick between providers/models by difficulty + type
async function chooseModel({ text, plan, reasoningEnabled = false, ignoreDeliverableHeuristic = false }) {
  const paid = isPaidPlan(plan);
  const useClaude = claudeEnabledForAuto();

  if (!paid) {
    // FREE: DeepSeek V3.2 is the default (fallback to OpenAI/Gemini if DeepSeek isn't configured).
    return pickFirst("deepseek-v3.2", "gpt-5-mini", "gemini-2.5 flash");
  }

  if (!routerEnabledForPlan(plan)) {
    // Paid but not eligible for the intelligent router (shouldn't happen with current plan list),
    // keep it deterministic and cheap.
    return pickFirst("deepseek-v3.2", "gpt-5-mini", "gemini-2.5 flash");
  }

  const hardHeuristic = looksHard(text, { ignoreDeliverableHeuristic }) || Boolean(reasoningEnabled);
  const isCodeHeuristic = looksLikeCode(text);

  // If it clearly looks like code, route immediately (no extra latency from classifier).
  if (isCodeHeuristic) {
    // Code: prefer Claude Opus for hard code (if enabled), otherwise keep it on OpenAI by default.
    if (hardHeuristic) {
      return useClaude
        ? pickFirst("claude-opus-4.6", "gpt-5.4", "gemini-3.1 pro", "gemini-3 pro")
        : pickFirst("gpt-5.4");
    }
    return useClaude
      ? pickFirst("deepseek-v3.2", "gpt-5", "claude-sonnet-4.6", "claude-sonnet-4.5", "gpt-5-mini")
      : pickFirst("deepseek-v3.2", "gpt-5", "gpt-5-mini");
  }

  // Option B (language-agnostic): use a cheap classifier LLM to decide intent/difficulty.
  // Keep a strict timeout + cache inside classifier, and fall back to heuristics if it fails.
  let cls = null;
  if (providerConfigured("openai")) {
    cls = await classifyForRouting({ text });
  }

  if (cls) {
    const intent = cls.intent; // code | creative | factual | planning | general
    const hard = cls.difficulty === "hard" || hardHeuristic;

    if (process.env.DEBUG_AI === "1") {
      console.error("[router] classify(v2)", {
        plan,
        paid,
        len: String(text || "").length,
        hardHeuristic,
        cls,
      });
    }

    if (intent === "code") {
      if (hard) {
        // Hard code: Claude Opus first (if enabled).
        return useClaude
          ? pickFirst("claude-opus-4.6", "gpt-5.4", "gemini-3.1 pro", "gemini-3 pro")
          : pickFirst("gpt-5.4", "gemini-3.1 pro", "gemini-3 pro");
      }
      if (cls.difficulty === "medium") {
        return useClaude
          ? pickFirst("deepseek-v3.2", "gpt-5", "claude-sonnet-4.6", "claude-sonnet-4.5", "gemini-2.5 pro")
          : pickFirst("deepseek-v3.2", "gpt-5", "gemini-2.5 pro");
      }
      return pickFirst("deepseek-v3.2", "gpt-5-mini", "gemini-2.5 flash");
    }

    if (intent === "creative") {
      if (hard) {
        // Hard creative: GPT-5.4 first.
        return useClaude
          ? pickFirst("gpt-5.4", "claude-opus-4.6", "gemini-3.1 pro", "gemini-3 pro")
          : pickFirst("gpt-5.4", "gemini-3.1 pro", "gemini-3 pro");
      }
      if (cls.difficulty === "medium") {
        return useClaude
          ? pickFirst("claude-sonnet-4.6", "claude-sonnet-4.5", "deepseek-v3.2", "gpt-5", "gemini-2.5 pro")
          : pickFirst("deepseek-v3.2", "gpt-5", "gemini-2.5 pro");
      }
      return useClaude
        ? pickFirst("claude-haiku-4.5", "deepseek-v3.2", "gpt-5-mini", "gemini-2.5 flash")
        : pickFirst("deepseek-v3.2", "gpt-5-mini", "gemini-2.5 flash");
    }

    if (intent === "factual") {
      if (hard) {
        // Hard factual: Gemini 3.1 Pro first (fallback to Gemini 3 Pro).
        return useClaude
          ? pickFirst("gemini-3.1 pro", "gemini-3 pro", "gpt-5.4", "claude-opus-4.6")
          : pickFirst("gemini-3.1 pro", "gemini-3 pro", "gpt-5.4");
      }
      if (cls.difficulty === "medium") {
        return useClaude
          ? pickFirst("deepseek-v3.2", "gemini-2.5 pro", "claude-sonnet-4.6", "claude-sonnet-4.5", "gpt-5")
          : pickFirst("deepseek-v3.2", "gemini-2.5 pro", "gpt-5");
      }
      return pickFirst("deepseek-v3.2", "gemini-2.5 flash", "gpt-5-mini");
    }

    if (intent === "planning") {
      if (hard) {
        // Hard planning: GPT-5.4 first.
        return useClaude
          ? pickFirst("gpt-5.4", "claude-opus-4.6", "gemini-3.1 pro", "gemini-3 pro")
          : pickFirst("gpt-5.4", "gemini-3.1 pro", "gemini-3 pro");
      }
      if (cls.difficulty === "medium") {
        return useClaude
          ? pickFirst("deepseek-v3.2", "gpt-5", "claude-sonnet-4.6", "claude-sonnet-4.5", "gemini-2.5 pro")
          : pickFirst("deepseek-v3.2", "gpt-5", "gemini-2.5 pro");
      }
      return pickFirst("deepseek-v3.2", "gpt-5-mini", "gemini-2.5 flash");
    }

    // general
    if (hard) {
      // Hard general: keep elite defaults (GPT-5.4 first).
      return useClaude
        ? pickFirst("gpt-5.4", "claude-opus-4.6", "gemini-3.1 pro", "gemini-3 pro")
        : pickFirst("gpt-5.4", "gemini-3.1 pro", "gemini-3 pro");
    }
    if (cls.difficulty === "medium") {
      return useClaude
        ? pickFirst("deepseek-v3.2", "gpt-5", "claude-sonnet-4.6", "claude-sonnet-4.5", "gemini-2.5 pro")
        : pickFirst("deepseek-v3.2", "gpt-5", "gemini-2.5 pro");
    }
    return pickFirst("deepseek-v3.2", "gpt-5-mini", "gemini-2.5 flash");
  }

  // Fallback (old heuristics): keep existing behavior for safety.
  const hard = hardHeuristic;
  const isCode = false;
  const isCreative = looksCreative(text);
  const isFactual = looksFactual(text);

  if (process.env.DEBUG_AI === "1") {
    console.error("[router] classify", {
      plan,
      paid,
      len: String(text || "").length,
      hard,
      isCode,
      isCreative,
      isFactual,
    });
  }

  // NOTE: Heuristic fallback (when classifier is unavailable).
  // We keep this logic simple and prefer cheaper/faster defaults first.

  if (isCreative) {
    if (hard) {
      return useClaude
        ? pickFirst("gpt-5.4", "claude-opus-4.6", "gemini-3.1 pro", "gemini-3 pro")
        : pickFirst("gpt-5.4", "gemini-3.1 pro", "gemini-3 pro");
    }
  return useClaude
    ? pickFirst("claude-haiku-4.5", "deepseek-v3.2", "gpt-5-mini", "gemini-2.5 flash", "gpt-5")
    : pickFirst("deepseek-v3.2", "gpt-5-mini", "gemini-2.5 flash", "gpt-5");
  }

  if (isFactual) {
    if (hard) {
      return useClaude
        ? pickFirst("gemini-3.1 pro", "gemini-3 pro", "gpt-5.4", "claude-opus-4.6")
        : pickFirst("gemini-3.1 pro", "gemini-3 pro", "gpt-5.4");
    }
  return useClaude
    ? pickFirst("gemini-2.5 flash", "claude-haiku-4.5", "deepseek-v3.2", "gpt-5-mini", "gemini-2.5 pro", "gpt-5")
    : pickFirst("deepseek-v3.2", "gemini-2.5 flash", "gpt-5-mini", "gemini-2.5 pro", "gpt-5");
  }

  // Default: cost-aware, but still strong when needed.
  if (hard) {
    return useClaude
      ? pickFirst("gpt-5.4", "claude-opus-4.6", "gemini-3.1 pro", "gemini-3 pro")
      : pickFirst("gpt-5.4", "gemini-3.1 pro", "gemini-3 pro");
  }
  return useClaude
    ? pickFirst("deepseek-v3.2", "gpt-5-mini", "claude-haiku-4.5", "gemini-2.5 flash", "gpt-5", "claude-sonnet-4.6", "claude-sonnet-4.5", "gemini-2.5 pro")
    : pickFirst("deepseek-v3.2", "gpt-5-mini", "gemini-2.5 flash", "gpt-5", "gemini-2.5 pro");
}

module.exports = { chooseModel };
