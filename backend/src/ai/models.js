// Model registry
// -------------
// IMPORTANT:
// - `id` must match what the frontend sends (UI ids with spaces, e.g. "gemini-3 pro").
// - `remoteModel` is what we send to the provider API (usually hyphenated, no spaces).
// - `provider` is our internal adapter key ("openai", "gemini", ...).
// - `tier` is used for plan rules (FREE => tier === "light").

function oai(remoteModel, tier = "full") {
  return { provider: "openai", remoteModel, tier };
}
function gem(remoteModel, tier = "full") {
  return { provider: "gemini", remoteModel, tier };
}
function grok(remoteModel, tier = "full") {
  return { provider: "grok", remoteModel, tier };
}
function deep(remoteModel, tier = "full") {
  return { provider: "deepseek", remoteModel, tier };
}
function moon(remoteModel, tier = "full") {
  return { provider: "moonshot", remoteModel, tier };
}
function ppx(remoteModel, tier = "full") {
  return { provider: "perplexity", remoteModel, tier };
}
function q(remoteModel, tier = "full") {
  return { provider: "qwen", remoteModel, tier };
}
function ortr(remoteModel, tier = "full") {
  return { provider: "openrouter", remoteModel, tier };
}
function stub(provider, remoteModel, tier = "full") {
  return { provider, remoteModel, tier };
}

// Optional override if you want "GPT-5.4 Pro" to map to a different OpenAI model id.
// Default is "gpt-5.4-pro". If your account/project uses a different id, override it here.
const OPENAI_GPT_54_PRO_REMOTE_MODEL =
  process.env.OPENAI_GPT_54_PRO_REMOTE_MODEL || "gpt-5.4-2026-03-05";

// Optional override for "GPT-5.4". Keep default as "gpt-5.4"; adjust if OpenAI returns 404 model_not_found.
const OPENAI_GPT_54_REMOTE_MODEL = process.env.OPENAI_GPT_54_REMOTE_MODEL || "gpt-5.4";

// Optional override if you want "GPT-5.2 Pro" to map to a different OpenAI model id.
// Default is "gpt-5.2-chat-latest". If your account/project doesn't have it, set this to "gpt-5.2" (or another allowed model).
const OPENAI_GPT_52_PRO_REMOTE_MODEL =
  process.env.OPENAI_GPT_52_PRO_REMOTE_MODEL || "gpt-5.2-chat-latest";

// Optional override for "GPT-5.1" (some accounts may not have this id).
// Keep default as "gpt-5.1"; adjust if OpenAI returns 404 model_not_found.
const OPENAI_GPT_51_REMOTE_MODEL = process.env.OPENAI_GPT_51_REMOTE_MODEL || "gpt-5.1";

// Optional override for "GPT-5 Mini". Keep default as "gpt-5-mini"; adjust if OpenAI returns 404 model_not_found.
const OPENAI_GPT_5_MINI_REMOTE_MODEL =
  process.env.OPENAI_GPT_5_MINI_REMOTE_MODEL || "gpt-5-mini";

// Gemini model ids change more frequently (preview/stable). Keep an override to avoid 404s.
// Common values include "gemini-3-pro-preview" and "gemini-3-pro".
const GEMINI_3_PRO_REMOTE_MODEL =
  process.env.GEMINI_3_PRO_REMOTE_MODEL || "gemini-3-pro-preview";

// Gemini 3.1 Pro (newer "Pro" tier). Naming varies by release channel; keep override.
// Common values may include "gemini-3.1-pro", "gemini-3.1-pro-preview", or "-latest".
const GEMINI_31_PRO_REMOTE_MODEL =
  process.env.GEMINI_31_PRO_REMOTE_MODEL || "gemini-3.1-pro-preview";

// Anthropic model ids can vary by region/account. Keep overrides to avoid 404s.
const ANTHROPIC_CLAUDE_OPUS_46_REMOTE_MODEL =
  process.env.ANTHROPIC_CLAUDE_OPUS_46_REMOTE_MODEL || "claude-opus-4-6";
const ANTHROPIC_CLAUDE_OPUS_45_REMOTE_MODEL =
  process.env.ANTHROPIC_CLAUDE_OPUS_45_REMOTE_MODEL || "claude-opus-4-5-20251101";
const ANTHROPIC_CLAUDE_SONNET_46_REMOTE_MODEL =
  process.env.ANTHROPIC_CLAUDE_SONNET_46_REMOTE_MODEL || "claude-sonnet-4-6";
const ANTHROPIC_CLAUDE_SONNET_45_REMOTE_MODEL =
  process.env.ANTHROPIC_CLAUDE_SONNET_45_REMOTE_MODEL || "claude-sonnet-4-5-20250929";
const ANTHROPIC_CLAUDE_HAIKU_45_REMOTE_MODEL =
  process.env.ANTHROPIC_CLAUDE_HAIKU_45_REMOTE_MODEL || "claude-haiku-4-5-20251001";

// Grok (xAI) model ids can change; keep overrides to avoid 404s.
// We map the UI "grok-4.1" to a good default model on the xAI API.
const GROK_41_REMOTE_MODEL =
  process.env.GROK_41_REMOTE_MODEL ||
  process.env.XAI_GROK_41_REMOTE_MODEL ||
  // Common xAI model ids (as shown in xAI console). Override if your workspace uses different ids.
  "grok-4-1-rapid-reasoning";
const GROK_42_REMOTE_MODEL =
  process.env.GROK_42_REMOTE_MODEL ||
  process.env.XAI_GROK_42_REMOTE_MODEL ||
  // Newer Grok 4.2 naming tends to follow the same "rapid/fast" pattern. Override if needed.
  "grok-4-2-rapid-reasoning";
const GROK_4_REMOTE_MODEL =
  process.env.GROK_4_REMOTE_MODEL ||
  process.env.XAI_GROK_4_REMOTE_MODEL ||
  // Prefer a fast reasoning variant by default; override if you want e.g. "grok-4-0709".
  "grok-4-rapid-reasoning";

// DeepSeek model ids (OpenAI-compatible). Allow overrides to avoid 404s.
const DEEPSEEK_V32_REMOTE_MODEL =
  process.env.DEEPSEEK_V32_REMOTE_MODEL || "deepseek-chat";
const DEEPSEEK_R1_REMOTE_MODEL =
  process.env.DEEPSEEK_R1_REMOTE_MODEL || "deepseek-reasoner";

// Moonshot / Kimi model ids (OpenAI-compatible). Allow overrides to avoid 404s.
const KIMI_K25_REMOTE_MODEL =
  process.env.KIMI_K25_REMOTE_MODEL || process.env.MOONSHOT_KIMI_K25_REMOTE_MODEL || "kimi-k2.5";

// Perplexity model ids (OpenAI-compatible). Allow overrides to avoid 404s.
const PERPLEXITY_SONAR_PRO_REMOTE_MODEL =
  process.env.PERPLEXITY_SONAR_PRO_REMOTE_MODEL || "sonar-pro";
const PERPLEXITY_SONAR_REMOTE_MODEL =
  process.env.PERPLEXITY_SONAR_REMOTE_MODEL || "sonar";

// Qwen model ids (DashScope OpenAI-compatible). Allow overrides to avoid 404s.
// In Alibaba Model Studio the model id is typically "qwen3-max".
const QWEN35_PLUS_REMOTE_MODEL =
  process.env.QWEN35_PLUS_REMOTE_MODEL ||
  process.env.QWEN_35_PLUS_REMOTE_MODEL ||
  "qwen3.5-plus";
const QWEN35_FLASH_REMOTE_MODEL =
  process.env.QWEN35_FLASH_REMOTE_MODEL ||
  process.env.QWEN_35_FLASH_REMOTE_MODEL ||
  "qwen3.5-flash";
const QWEN3_MAX_REMOTE_MODEL =
  process.env.QWEN3_MAX_REMOTE_MODEL || "qwen3-max";

// OpenRouter model ids. Keep override so we can swap to :free or other variants quickly.
const OPENROUTER_NEMOTRON_3_SUPER_REMOTE_MODEL =
  process.env.OPENROUTER_NEMOTRON_3_SUPER_REMOTE_MODEL || "nvidia/nemotron-3-super-120b-a12b";
const OPENROUTER_MINIMAX_M27_REMOTE_MODEL =
  process.env.OPENROUTER_MINIMAX_M27_REMOTE_MODEL || "minimax/minimax-m2.7";

// This list mirrors your frontend model dropdown (see frontend/src/App.jsx).
const MODELS = [
  // Special UI option (router decides)
  { id: "__best__", ...stub("core", "__best__", "light") },

  // OpenAI
  { id: "gpt-5.4 pro", ...oai(OPENAI_GPT_54_PRO_REMOTE_MODEL, "full") },
  { id: "gpt-5.4", ...oai(OPENAI_GPT_54_REMOTE_MODEL, "full") },
  { id: "gpt-5.2 pro", ...oai(OPENAI_GPT_52_PRO_REMOTE_MODEL, "full") },
  { id: "gpt-5.2", ...oai("gpt-5.2", "full") },
  { id: "gpt-5.1", ...oai(OPENAI_GPT_51_REMOTE_MODEL, "full") },
  { id: "gpt-5-nano", ...oai("gpt-5-nano", "light") },
  { id: "gpt-5-mini", ...oai(OPENAI_GPT_5_MINI_REMOTE_MODEL, "light") },
  { id: "gpt-5", ...oai("gpt-5", "full") },

  // Anthropic (stub for now)
  { id: "claude-opus-4.6", ...stub("anthropic", ANTHROPIC_CLAUDE_OPUS_46_REMOTE_MODEL, "full") },
  { id: "claude-opus-4.5", ...stub("anthropic", ANTHROPIC_CLAUDE_OPUS_45_REMOTE_MODEL, "full") },
  { id: "claude-sonnet-4.6", ...stub("anthropic", ANTHROPIC_CLAUDE_SONNET_46_REMOTE_MODEL, "full") },
  { id: "claude-sonnet-4.5", ...stub("anthropic", ANTHROPIC_CLAUDE_SONNET_45_REMOTE_MODEL, "full") },
  { id: "claude-haiku-4.5", ...stub("anthropic", ANTHROPIC_CLAUDE_HAIKU_45_REMOTE_MODEL, "full") },

  // Gemini (Google) (we implement this provider)
  { id: "gemini-3.1 pro", ...gem(GEMINI_31_PRO_REMOTE_MODEL, "full") },
  { id: "gemini-3 pro", ...gem(GEMINI_3_PRO_REMOTE_MODEL, "full") },
  { id: "gemini-2.5 pro", ...gem("gemini-2.5-pro", "full") },
  { id: "gemini-2.5 flash", ...gem("gemini-2.5-flash", "light") },
  { id: "gemini-2.5 flash lite", ...gem("gemini-2.5-flash-lite", "light") },

  // Grok (xAI)
  { id: "grok-4.2", ...grok(GROK_42_REMOTE_MODEL, "full") },
  { id: "grok-4.1", ...grok(GROK_41_REMOTE_MODEL, "full") },
  { id: "grok-4", ...grok(GROK_4_REMOTE_MODEL, "full") },

  // DeepSeek (OpenAI-compatible)
  { id: "deepseek-v3.2", ...deep(DEEPSEEK_V32_REMOTE_MODEL, "full") },
  { id: "deepseek-r1", ...deep(DEEPSEEK_R1_REMOTE_MODEL, "full") },

  // Moonshot / Kimi (stub)
  { id: "kimi-k2-5", ...moon(KIMI_K25_REMOTE_MODEL, "full") },

  // Qwen (stub)
  { id: "qwen3.5-plus", ...q(QWEN35_PLUS_REMOTE_MODEL, "full") },
  { id: "qwen3.5-flash", ...q(QWEN35_FLASH_REMOTE_MODEL, "light") },
  { id: "qwen3-max", ...q(QWEN3_MAX_REMOTE_MODEL, "full") },

  // OpenRouter
  { id: "nemotron 3 super", ...ortr(OPENROUTER_NEMOTRON_3_SUPER_REMOTE_MODEL, "full") },
  { id: "minimax m2.7", ...ortr(OPENROUTER_MINIMAX_M27_REMOTE_MODEL, "full") },

  // Perplexity (stub)
  { id: "perplexity-sonar-pro", ...ppx(PERPLEXITY_SONAR_PRO_REMOTE_MODEL, "full") },
  { id: "perplexity-sonar", ...ppx(PERPLEXITY_SONAR_REMOTE_MODEL, "full") },

  // Meta / Llama (stub)
  { id: "llama-4", ...stub("meta", "llama-4", "full") },
];

const MODEL_BY_ID = new Map(MODELS.map((m) => [m.id, m]));

function normalizeId(x) {
  return String(x || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// A more forgiving key that treats "-" and "_" like spaces.
// This prevents "UNKNOWN_MODEL" when the frontend/backend disagree on hyphens vs spaces.
function looseKey(x) {
  return normalizeId(x).replace(/[-_]+/g, " ");
}

const MODEL_BY_LOOSE_ID = new Map();
for (const m of MODELS) {
  // First write wins; collisions are extremely unlikely with our current ids.
  const k = looseKey(m.id);
  if (!MODEL_BY_LOOSE_ID.has(k)) MODEL_BY_LOOSE_ID.set(k, m);
}

// Canonical key: collapse anything that's not a-z/0-9 into spaces.
// This catches weird punctuation / Unicode characters.
function canonicalKey(x) {
  return normalizeId(x)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const MODEL_BY_CANONICAL_ID = new Map();
for (const m of MODELS) {
  const k = canonicalKey(m.id);
  if (!MODEL_BY_CANONICAL_ID.has(k)) MODEL_BY_CANONICAL_ID.set(k, m);
}

// Aliases let the backend accept slight id differences from the frontend (or old localStorage)
// without breaking streaming / routing.
// IMPORTANT: keys should be normalized (see normalizeId).
const ALIASES = new Map([
  // OpenAI "pro" uses a hyphen in some contexts, but our UI ids use spaces.
  ["gpt-5.4-pro", "gpt-5.4 pro"],
  ["gpt-5.2-pro", "gpt-5.2 pro"],

  // Qwen variants commonly come without the dash.
  ["qwen 3.5", "qwen3.5-plus"],
  ["qwen3 5 plus", "qwen3.5-plus"],
  ["qwen3.5 plus", "qwen3.5-plus"],
  ["qwen-3.5-plus", "qwen3.5-plus"],
  ["qwen 3.5 flash", "qwen3.5-flash"],
  ["qwen3 5 flash", "qwen3.5-flash"],
  ["qwen3.5 flash", "qwen3.5-flash"],
  ["qwen-3.5-flash", "qwen3.5-flash"],
  ["qwen3 max", "qwen3-max"],

  // Allow env/config to use the official Gemini id.
  ["gemini-2.5-flash-lite", "gemini-2.5 flash lite"],
]);

function getModel(modelId) {
  const raw = String(modelId || "");
  const id = normalizeId(raw);
  const loose = looseKey(raw);
  const canonical = canonicalKey(raw);

  // Exact match (fast path) - keep for current UI ids with spaces/casing.
  if (MODEL_BY_ID.has(raw)) return MODEL_BY_ID.get(raw) || null;

  // Normalized match (trim/case/whitespace).
  if (MODEL_BY_ID.has(id)) return MODEL_BY_ID.get(id) || null;

  // Loose match (treat hyphens/underscores like spaces).
  if (MODEL_BY_LOOSE_ID.has(loose)) return MODEL_BY_LOOSE_ID.get(loose) || null;

  // Canonical match (treat *any* punctuation/Unicode separators as spaces).
  if (MODEL_BY_CANONICAL_ID.has(canonical))
    return MODEL_BY_CANONICAL_ID.get(canonical) || null;

  // Alias match.
  const aliased = ALIASES.get(id);
  if (aliased && MODEL_BY_ID.has(aliased)) return MODEL_BY_ID.get(aliased) || null;

  return null;
}

function listModels() {
  return MODELS.slice();
}

module.exports = {
  listModels,
  getModel,
};
