// src/lib/prisma.js
const { PrismaClient } = require("@prisma/client");
const { isTransientDbError } = require("../utils/dbErrors");

const globalForPrisma = global;

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    // Emit logs as events so we can de-noise transient connectivity issues
    // (e.g. Supabase pooler resets) without hiding real errors.
    log: [
      { level: "warn", emit: "event" },
      { level: "error", emit: "event" },
    ],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

let lastTransientLogAt = 0;
function shouldLogTransientNow() {
  const now = Date.now();
  // Avoid log spam when the pooler resets connections repeatedly.
  if (now - lastTransientLogAt < 2500) return false;
  lastTransientLogAt = now;
  return true;
}

// Prisma can emit connection-reset warnings/errors even when the app recovers.
// Only surface transient DB errors when DEBUG_DB=1 to avoid alarming noise in dev logs.
try {
  prisma.$on("warn", (e) => {
    if (process.env.DEBUG_DB === "1") {
      console.warn("[prisma] warn", String(e?.message || e));
    }
  });

  prisma.$on("error", (e) => {
    const msg = String(e?.message || e);
    if (isTransientDbError({ message: msg })) {
      if (process.env.DEBUG_DB === "1" && shouldLogTransientNow()) {
        if (process.env.DEBUG_DB_VERBOSE === "1") {
          console.error("[prisma] transient", msg, e);
        } else {
          console.error("[prisma] transient", msg);
        }
      }
      return;
    }
    console.error("[prisma] error", msg);
  });
} catch {
  // Ignore if Prisma changes event API.
}

module.exports = prisma;

