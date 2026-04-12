const prisma = require("../lib/prisma");

// Closed beta is ON by default. Set CLOSED_BETA_ENABLED=0 to disable without code changes.
const CLOSED_BETA_ENABLED = process.env.CLOSED_BETA_ENABLED !== "0";

const CACHE_TTL_MS = Number.parseInt(process.env.CLOSED_BETA_CACHE_TTL_MS || "30000", 10) || 30000;
const cache = new Map(); // email -> { allowed: boolean, role: string|null, expiresAt: number }

function normalizeEmail(raw) {
  const e = String(raw || "").trim().toLowerCase();
  return e || null;
}

function cacheGet(email) {
  const entry = cache.get(email);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(email);
    return null;
  }
  return entry;
}

function cacheSet(email, allowed, role) {
  cache.set(email, {
    allowed: Boolean(allowed),
    role: role || null,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

async function checkClosedBetaAccess(req, res, next) {
  try {
    if (!CLOSED_BETA_ENABLED) return next();

    const email = normalizeEmail(req.user?.email);
    if (!email) {
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }

    const cached = cacheGet(email);
    if (cached) {
      if (cached.allowed) {
        req.betaUserRole = cached.role;
        return next();
      }
      return res.status(403).json({
        error: "closed_beta",
        message: "Core AI está atualmente em closed beta.",
      });
    }

    const beta = await prisma.betaUser.findUnique({
      where: { email },
      select: { role: true },
    });

    if (!beta) {
      cacheSet(email, false, null);
      return res.status(403).json({
        error: "closed_beta",
        message: "Core AI está atualmente em closed beta.",
      });
    }

    cacheSet(email, true, beta.role);
    req.betaUserRole = beta.role;
    return next();
  } catch (e) {
    return next(e);
  }
}

module.exports = { checkClosedBetaAccess };
