// Backwards-compatible facade for the in-memory queue manager.
//
// Existing code imports `runInProviderQueue(provider, fn)` and expects a Promise.
// We now support:
//   - type separation: text vs image
//   - plan-based priority
//   - rpm + concurrency + timeout + exponential backoff (on 429)
//
// NOTE: This is in-process only (no Redis). For multi-instance deployments,
// limits are per instance.

const { runInQueue, assertDailyLimitOrThrow } = require("../queues/queueManager");

function normalizeOptions(provider, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const rawType = String(o.type || "").trim().toLowerCase();
  return {
    provider: String(provider || "").trim(),
    type: rawType === "image" || rawType === "video" ? rawType : "text",
    plan: o.plan,
    signal: o.signal,
    maxRetries: Number.isFinite(o.maxRetries) ? o.maxRetries : 0,
    priority: Number.isFinite(o.priority) ? o.priority : undefined,
  };
}

async function runInProviderQueue(provider, fn, opts) {
  const o = normalizeOptions(provider, opts);
  if (!o.provider) {
    const err = new Error("UNKNOWN_PROVIDER");
    err.status = 400;
    throw err;
  }
  if (typeof fn !== "function") {
    const err = new Error("INVALID_QUEUE_JOB");
    err.status = 400;
    throw err;
  }

  return runInQueue(o, fn);
}

module.exports = {
  runInProviderQueue,
  assertDailyLimitOrThrow,
};
