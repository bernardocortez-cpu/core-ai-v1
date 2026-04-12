// Plan configuration is intentionally centralized and boring.
// Payments/Stripe can come later; the plan is still the source of truth for limits.

const MESSAGE_LIMITS = {
  FREE: 20,
  PRO: 5000,
  PLUS: 10000,
  MAX: 25000,
};

const MESSAGE_LIMIT_WINDOWS = {
  FREE: "day",
  PRO: "month",
  PLUS: "month",
  MAX: "month",
};

// Creative Studio monthly generation limits (images/videos).
// "Premium" in the UI maps to PLUS in the DB.
const CREATIVE_GENERATION_LIMITS = {
  FREE: 3,
  PRO: 50,
  PLUS: 150,
  MAX: 300,
};

const CREATIVE_CREDIT_LIMITS = {
  FREE: 0,
  PRO: 5000,
  PLUS: 10000,
  MAX: 50000,
};

const CREATIVE_MODEL_CREDIT_COSTS = {
  "gpt-image-1.5": 300,
  "gpt-image-1": 200,
  "nano-banana-2": 300,
  "nano-banana-pro": 600,
  "nano-banana": 300,
  "flux-2-pro": 300,
  "flux-2": 150,
  "ideogram-3": 200,
  "seedream-5-lite": 600,
  "seedream-4.5": 400,
  "grok-image": 200,
  "seedance-2": 2000,
  "kling-3": 1500,
  "veo-3.1": 4000,
  "wan-2.6": 800,
  "hailuo-2.3": 3500,
  "vidu-q3": 1500,
  "runway-gen-4.5": 1500,
  "eleven-multilingual-v2": 80,
  "minimax-02-hd": 100,
  "cartesia-sonic-2": 120,
  "eleven-v3": 150,
  "lyria-3": 500,
  "lyria-3-pro": 1500,
  "suno-v5.5": 1000,
};

// Internal monthly text budgets (product-side guardrail).
// We keep the numeric values aligned with the plan policy agreed for the beta.
const TEXT_INTERNAL_BUDGETS_USD = {
  FREE: 0,
  PRO: 8,
  PLUS: 15,
  MAX: 50,
};

const PROJECT_FILE_LIMITS = {
  FREE: 5,
  PRO: 20,
  PLUS: 30,
  MAX: 50,
};

const MESSAGE_ATTACHMENT_LIMITS = {
  FREE: 2,
  PRO: 10,
  PLUS: 10,
  MAX: 10,
};

function normalizePlan(plan) {
  const raw = String(plan || "FREE").toUpperCase();
  const p = raw === "PREMIUM" ? "PLUS" : raw;
  return MESSAGE_LIMITS[p] ? p : "FREE";
}

function getMessageLimit(plan) {
  const p = normalizePlan(plan);
  return MESSAGE_LIMITS[p];
}

function getMessageLimitWindow(plan) {
  const p = normalizePlan(plan);
  return MESSAGE_LIMIT_WINDOWS[p] ?? MESSAGE_LIMIT_WINDOWS.FREE;
}

function getMonthlyCreativeGenerationLimit(plan) {
  const p = normalizePlan(plan);
  return CREATIVE_GENERATION_LIMITS[p] ?? 0;
}

function getMonthlyCreativeCreditLimit(plan) {
  const p = normalizePlan(plan);
  return CREATIVE_CREDIT_LIMITS[p] ?? 0;
}

function getCreativeModelCreditCost(modelId) {
  const key = String(modelId || "").trim().toLowerCase();
  return CREATIVE_MODEL_CREDIT_COSTS[key] ?? 0;
}

function isPaidPlan(plan) {
  const p = normalizePlan(plan);
  return p !== "FREE";
}

function getMonthlyTextInternalBudgetUsd(plan) {
  const p = normalizePlan(plan);
  return TEXT_INTERNAL_BUDGETS_USD[p] ?? 0;
}

function getProjectFileLimit(plan) {
  const p = normalizePlan(plan);
  return PROJECT_FILE_LIMITS[p] ?? PROJECT_FILE_LIMITS.FREE;
}

function getMessageAttachmentLimit(plan) {
  const p = normalizePlan(plan);
  return MESSAGE_ATTACHMENT_LIMITS[p] ?? MESSAGE_ATTACHMENT_LIMITS.FREE;
}

module.exports = {
  normalizePlan,
  getMessageLimit,
  getMessageLimitWindow,
  getMonthlyCreativeGenerationLimit,
  getMonthlyCreativeCreditLimit,
  getCreativeModelCreditCost,
  getMonthlyTextInternalBudgetUsd,
  getProjectFileLimit,
  getMessageAttachmentLimit,
  isPaidPlan,
};
