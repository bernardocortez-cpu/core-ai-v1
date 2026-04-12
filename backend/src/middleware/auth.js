const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");
const { isTransientDbError } = require("../utils/dbErrors");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("Missing env JWT_SECRET");

// Small in-memory cache to reduce DB pressure in hot paths (every API call hits auth).
// This also makes the app more resilient to short transient DB hiccups (Supabase/pooler).
const USER_CACHE_TTL_MS = Number.parseInt(
  process.env.AUTH_USER_CACHE_TTL_MS || "30000",
  10
);
const USER_CACHE_MAX = Number.parseInt(
  process.env.AUTH_USER_CACHE_MAX || "1000",
  10
);
const userCache = new Map(); // userId -> { user, expiresAt }
const userCacheTtlMs = Number.isFinite(USER_CACHE_TTL_MS) ? USER_CACHE_TTL_MS : 30000;
const userCacheMax = Number.isFinite(USER_CACHE_MAX) ? USER_CACHE_MAX : 1000;

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header) return null;

  // Accept e.g. `Bearer <token>` and also tolerate quotes some clients may include.
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;

  const raw = (m[1] || "").trim();
  if (!raw) return null;

  // Strip a single pair of surrounding quotes.
  return raw.replace(/^['"]|['"]$/g, "");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cacheGetUser(userId) {
  const entry = userCache.get(userId);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    userCache.delete(userId);
    return null;
  }
  return entry.user;
}

function cacheSetUser(user) {
  if (!user?.id) return;

  // Simple max-size guard to avoid unbounded growth in dev.
  if (userCache.size >= userCacheMax) {
    // Delete oldest-ish entry (Map preserves insertion order).
    const firstKey = userCache.keys().next().value;
    if (firstKey) userCache.delete(firstKey);
  }

  userCache.set(user.id, {
    user,
    expiresAt: Date.now() + userCacheTtlMs,
  });
}

async function fetchUserWithRetry(userId) {
  const cached = cacheGetUser(userId);
  if (cached) return cached;

  // Retry once for transient DB/network issues.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, status: true },
      });
      if (user) cacheSetUser(user);
      return user;
    } catch (err) {
      const transient = isTransientDbError(err);
      if (!transient || attempt === 1) throw err;
      await sleep(75 + attempt * 125);
    }
  }
  return null;
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      // Avoid noisy logs in normal operation (expired tokens are expected with refresh flows).
      if (process.env.DEBUG_AUTH === "1") {
        console.warn("JWT verify failed:", e?.name, e?.message);
      }
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }

    const userId = payload?.sub;
    if (!userId) {
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }

    let user;
    try {
      user = await fetchUserWithRetry(userId);
    } catch (dbErr) {
      // IMPORTANT: transient DB issues should not look like an auth failure,
      // otherwise the frontend interprets it as "log out" and everything disappears.
      if (isTransientDbError(dbErr)) {
        const err = new Error("DB_UNAVAILABLE");
        err.status = 503;
        throw err;
      }
      throw dbErr;
    }

    if (!user) {
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }

    if (user.status !== "ACTIVE") {
      const err = new Error("ACCOUNT_NOT_ACTIVE");
      err.status = 403;
      throw err;
    }

    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

function requireAuthTokenOnly(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (e) {
      if (process.env.DEBUG_AUTH === "1") {
        console.warn("JWT verify failed:", e?.name, e?.message);
      }
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }

    const userId = payload?.sub;
    if (!userId) {
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }

    req.user = {
      id: userId,
      role: payload?.role || null,
      email: payload?.email || null,
      name: payload?.name || null,
    };
    next();
  } catch (e) {
    next(e);
  }
}

function attachAuthTokenOnly(req, res, next) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      req.user = null;
      return next();
    }

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      req.user = null;
      return next();
    }

    const userId = payload?.sub;
    if (!userId) {
      req.user = null;
      return next();
    }

    req.user = {
      id: userId,
      role: payload?.role || null,
      email: payload?.email || null,
      name: payload?.name || null,
    };
    next();
  } catch {
    req.user = null;
    next();
  }
}

module.exports = { requireAuth, requireAuthTokenOnly, attachAuthTokenOnly };
