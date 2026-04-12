/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");

function splitEmails(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

async function main() {
  const prisma = new PrismaClient();

  const adminEmail = String(process.env.BETA_ADMIN_EMAIL || "").trim().toLowerCase();
  const teamEmails = splitEmails(process.env.BETA_TEAM_EMAILS);
  const testerEmails = splitEmails(process.env.BETA_TESTER_EMAILS);

  if (!adminEmail && teamEmails.length === 0 && testerEmails.length === 0) {
    console.error(
      "Missing beta seed env vars. Set at least one of: BETA_ADMIN_EMAIL, BETA_TEAM_EMAILS, BETA_TESTER_EMAILS"
    );
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const entries = [];
  if (adminEmail) entries.push({ email: adminEmail, role: "ADMIN" });
  for (const e of teamEmails) entries.push({ email: e, role: "TEAM" });
  for (const e of testerEmails) entries.push({ email: e, role: "TESTER" });

  const uniqueByEmail = new Map();
  for (const x of entries) uniqueByEmail.set(x.email, x.role);

  const finalEntries = Array.from(uniqueByEmail.entries()).map(([email, role]) => ({ email, role }));

  console.log(`[seed_beta_users] Upserting ${finalEntries.length} beta users...`);

  for (const { email, role } of finalEntries) {
    // Ensure deterministic casing in DB.
    await prisma.betaUser.upsert({
      where: { email },
      create: { email, role },
      update: { role },
    });
  }

  console.log("[seed_beta_users] Done.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("[seed_beta_users] Failed:", e);
  process.exitCode = 1;
});

