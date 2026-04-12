// In local dev it's common to have stale process-level env vars (PowerShell $env:...)
// that silently override .env and make debugging painful. In production we keep the
// default behavior (don't override).
const isProd = process.env.NODE_ENV === "production";
require("dotenv").config({ override: !isProd });
require("./src/bootstrap/env").bootstrapEnv();
const { createApp } = require("./src/app");
const prisma = require("./src/lib/prisma");

const app = createApp();
const PORT = process.env.PORT || 4000;

// Warm-up Prisma connection in the background so the first request (auth) doesn't pay
// the cost of engine spin-up + DB handshake. Don't crash the process if the DB is down.
prisma.$connect().catch((e) => {
  if (process.env.DEBUG_DB === "1") {
    console.warn("[prisma] warmup failed", e?.message || e);
  }
});

app.listen(PORT, () => {
  console.log(`Backend a correr em http://localhost:${PORT}`);
});
