// In-memory queue manager (per process).
// - Separate by provider AND type (text/image)
// - Supports concurrency, rpm, timeout, exponential backoff on 429
// - Supports plan-based priority (FREE low, PRO normal, MAX high)
//
// Designed so we can later swap the implementation for BullMQ/Redis with minimal surface-area changes.

const { normalizePlan } = require("../config/plans");

function clampInt(v, { min, max, fallback }) {
  const n = Number.parseInt(String(v || ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function nowMs() {
  return Date.now();
}

function nextUtcMidnightMs(from = new Date()) {
  const d = new Date(from);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  return Date.UTC(y, m, day + 1, 0, 0, 0, 0);
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

function isRateLimitedError(err) {
  const status = Number(err?.status || 0);
  const code = String(err?.details?.code || err?.message || "").toLowerCase();
  const msg = String(err?.details?.message || err?.details?.body || "").toLowerCase();

  if (status === 429) return true;
  if (code.includes("rate_limit") || code.includes("rate-lim") || code.includes("ratelimit")) return true;
  if (code === "provider_rate_limited" || err?.message === "PROVIDER_RATE_LIMITED") return true;
  if (msg.includes("rate limit") || msg.includes("too many requests")) return true;
  return false;
}

function sleep(ms, signal) {
  const t = Math.max(0, Number(ms) || 0);
  if (t === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(), t);
    const onAbort = () => {
      clearTimeout(timer);
      const e = new Error("ABORTED");
      e.status = 499;
      reject(e);
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      try {
        signal.addEventListener("abort", onAbort, { once: true });
      } catch {
        // ignore
      }
    }
  });
}

function createPerMinuteLimiter({ perMinute }) {
  const windows = new Map(); // key -> { resetAt, used }

  function getWindow(key) {
    const now = nowMs();
    const w = windows.get(key);
    if (!w || now >= w.resetAt) {
      const next = { resetAt: now + 60_000, used: 0 };
      windows.set(key, next);
      return next;
    }
    return w;
  }

  function canConsume(key, amount = 1) {
    const w = getWindow(key);
    return w.used + amount <= perMinute;
  }

  function consume(key, amount = 1) {
    const w = getWindow(key);
    if (w.used + amount > perMinute) return false;
    w.used += amount;
    return true;
  }

  function msUntilReset(key) {
    const w = getWindow(key);
    return Math.max(0, w.resetAt - nowMs());
  }

  return { canConsume, consume, msUntilReset };
}

function getPlanPriority(plan) {
  const p = normalizePlan(plan);
  if (p === "FREE") return 0;
  if (p === "MAX") return 2;
  // PRO/PREMIUM default to normal
  return 1;
}

function getQueueConfig({ provider, type }) {
  const normalizedType = String(type || "text").toLowerCase();
  const t =
    normalizedType === "image" ? "IMAGE" : normalizedType === "video" ? "VIDEO" : "TEXT";
  const p = String(provider || "").trim().toUpperCase();

  const defaults =
    t === "TEXT"
      ? { concurrency: 5, rpm: 60, timeoutMs: 60_000 }
      : t === "VIDEO"
        ? { concurrency: 2, rpm: 12, timeoutMs: 10 * 60_000 }
        : { concurrency: 2, rpm: 20, timeoutMs: 120_000 };

  const concurrency = clampInt(
    process.env[`QUEUE_${t}_${p}_CONCURRENCY`] || process.env[`QUEUE_${t}_CONCURRENCY`],
    { min: 1, max: 50, fallback: defaults.concurrency }
  );

  const rpm = clampInt(process.env[`QUEUE_${t}_${p}_RPM`] || process.env[`QUEUE_${t}_RPM`], {
    min: 1,
    max: 10_000,
    fallback: defaults.rpm,
  });

  const timeoutMs = clampInt(
    process.env[`QUEUE_${t}_${p}_TIMEOUT_MS`] || process.env[`QUEUE_${t}_TIMEOUT_MS`],
    { min: 1000, max: 10 * 60_000, fallback: defaults.timeoutMs }
  );

  return { concurrency, rpm, timeoutMs };
}

// Global daily limits (per process). Simple cost guardrail.
const daily = {
  text: { used: 0, resetAt: nextUtcMidnightMs() },
  image: { used: 0, resetAt: nextUtcMidnightMs() },
};

function getDailyLimit(type) {
  const normalizedType = String(type || "text").toLowerCase();
  const key = normalizedType === "image" || normalizedType === "video" ? "image" : "text";
  const env = key === "image" ? process.env.DAILY_IMAGE_LIMIT : process.env.DAILY_TEXT_LIMIT;
  const n = Number.parseInt(String(env || ""), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function assertDailyLimitOrThrow(type) {
  const normalizedType = String(type || "text").toLowerCase();
  const key = normalizedType === "image" || normalizedType === "video" ? "image" : "text";
  const limit = getDailyLimit(key);
  if (!limit) return;

  const d = daily[key];
  const now = nowMs();
  if (now >= d.resetAt) {
    d.used = 0;
    d.resetAt = nextUtcMidnightMs(new Date(now));
  }

  if (d.used >= limit) {
    const err = new Error("DAILY_LIMIT_REACHED");
    err.status = 429;
    err.details = { type: key, limit, resetAt: new Date(d.resetAt).toISOString() };
    throw err;
  }
}

function markDailyUsage(type) {
  const normalizedType = String(type || "text").toLowerCase();
  const key = normalizedType === "image" || normalizedType === "video" ? "image" : "text";
  const limit = getDailyLimit(key);
  if (!limit) return;

  const d = daily[key];
  const now = nowMs();
  if (now >= d.resetAt) {
    d.used = 0;
    d.resetAt = nextUtcMidnightMs(new Date(now));
  }
  d.used += 1;
}

function createQueue({ provider, type, concurrency, rpm, timeoutMs }) {
  const pending = {
    2: [], // high
    1: [], // normal
    0: [], // low
  };

  const qKey = `${type}:${provider}`;
  const limiter = createPerMinuteLimiter({ perMinute: rpm });
  let running = 0;

  let backoffUntil = 0;
  let backoffExp = 0;
  let pumpTimer = null;

  function log(action, extra) {
    // Logging policy:
    // - Production: ON by default (helps debug provider/backoff issues in hosting dashboards).
    // - Dev: OFF by default (avoid noisy local logs).
    // - Override:
    //   - DEBUG_QUEUE=1 forces ON
    //   - DEBUG_QUEUE=0 forces OFF
    const override = String(process.env.DEBUG_QUEUE || "").trim();
    if (override === "0") return;
    const enabled = override === "1" || process.env.NODE_ENV === "production";
    if (!enabled) return;
    const prefix = `[queue:${type}:${provider}]`;
    if (extra !== undefined) console.log(prefix, action, extra);
    else console.log(prefix, action);
  }

  function schedulePumpIn(ms) {
    const t = Math.max(0, Number(ms) || 0);
    if (pumpTimer) return;
    pumpTimer = setTimeout(() => {
      pumpTimer = null;
      pump();
    }, t);
  }

  function nextJob() {
    if (pending[2].length) return pending[2].shift();
    if (pending[1].length) return pending[1].shift();
    if (pending[0].length) return pending[0].shift();
    return null;
  }

  async function runJob(job) {
    const startedAt = nowMs();
    log("started", { id: job.id, priority: job.priority });

    // Daily guardrail counts when we actually start a provider call (not when queued).
    assertDailyLimitOrThrow(type);
    markDailyUsage(type);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const combinedSignal = abortSignalAny([job.signal, controller.signal]);

    try {
      const out = await job.fn({ signal: combinedSignal });
      backoffExp = 0;
      backoffUntil = 0;
      log("finished", { id: job.id, ms: nowMs() - startedAt });
      job.resolve(out);
    } catch (e) {
      const rateLimited = isRateLimitedError(e);
      if (rateLimited) {
        backoffExp = Math.min(backoffExp + 1, 8);
        const base = clampInt(process.env.QUEUE_BACKOFF_BASE_MS, {
          min: 50,
          max: 30_000,
          fallback: 250,
        });
        const max = clampInt(process.env.QUEUE_BACKOFF_MAX_MS, {
          min: 250,
          max: 5 * 60_000,
          fallback: 10_000,
        });
        const jitter = Math.floor(Math.random() * 100);
        const delay = Math.min(max, base * Math.pow(2, backoffExp)) + jitter;
        backoffUntil = Math.max(backoffUntil, nowMs() + delay);
        log("rate_limited", { id: job.id, delayMs: delay, status: e?.status });

        // Optional retry (safe for non-streaming tasks).
        const maxRetries = clampInt(job.maxRetries, { min: 0, max: 10, fallback: 0 });
        if (job.attempt < maxRetries && !(combinedSignal && combinedSignal.aborted)) {
          const retryJob = { ...job, attempt: job.attempt + 1 };
          // Re-queue with the same priority after backoff.
          schedulePumpIn(Math.max(0, backoffUntil - nowMs()));
          pending[retryJob.priority].unshift(retryJob);
          return;
        }
      }

      log("finished", { id: job.id, ms: nowMs() - startedAt, error: e?.message || "ERROR" });
      job.reject(e);
    } finally {
      clearTimeout(timer);
    }
  }

  function pump() {
    // Respect backoff window (from upstream 429s).
    const now = nowMs();
    if (now < backoffUntil) {
      schedulePumpIn(backoffUntil - now);
      return;
    }

    while (running < concurrency) {
      const job = nextJob();
      if (!job) return;

      // RPM limiter (per queue key).
      if (!limiter.consume(qKey, 1)) {
        // Put the job back at the front of its priority lane.
        pending[job.priority].unshift(job);
        const wait = limiter.msUntilReset(qKey);
        log("rate_limited", { waitMs: wait, reason: "rpm" });
        schedulePumpIn(wait);
        return;
      }

      running += 1;
      Promise.resolve()
        .then(() => runJob(job))
        .finally(() => {
          running -= 1;
          setImmediate(pump);
        });
    }
  }

  function push(fn, { priority = 1, signal, maxRetries = 0 } = {}) {
    const id = `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
    const pr = priority === 2 ? 2 : priority === 0 ? 0 : 1;

    log("queued", { id, priority: pr });

    return new Promise((resolve, reject) => {
      pending[pr].push({
        id,
        priority: pr,
        attempt: 0,
        maxRetries,
        fn,
        signal,
        resolve,
        reject,
      });
      pump();
    });
  }

  return { push };
}

const queues = new Map(); // key = `${type}:${provider}`

function getQueue({ provider, type }) {
  const p = String(provider || "").trim();
  const normalizedType = String(type || "text").toLowerCase();
  const t =
    normalizedType === "image" ? "image" : normalizedType === "video" ? "video" : "text";
  const key = `${t}:${p}`;
  const existing = queues.get(key);
  if (existing) return existing;

  const cfg = getQueueConfig({ provider: p, type: t });
  const q = createQueue({
    provider: p,
    type: t,
    concurrency: cfg.concurrency,
    rpm: cfg.rpm,
    timeoutMs: cfg.timeoutMs,
  });
  queues.set(key, q);
  return q;
}

async function runInQueue({ provider, type, plan, signal, maxRetries = 0, priority }, fn) {
  const p = String(provider || "").trim();
  const normalizedType = String(type || "text").toLowerCase();
  const t =
    normalizedType === "image" ? "image" : normalizedType === "video" ? "video" : "text";
  const pr =
    Number.isFinite(priority) && (priority === 0 || priority === 1 || priority === 2)
      ? priority
      : getPlanPriority(plan);
  const q = getQueue({ provider: p, type: t });

  return q.push(fn, { priority: pr, signal, maxRetries });
}

module.exports = {
  runInQueue,
  assertDailyLimitOrThrow,
};
