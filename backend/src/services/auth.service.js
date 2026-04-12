const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const prisma = require("../lib/prisma");
const { isTransientDbError } = require("../utils/dbErrors");
const { randomToken, sha256 } = require("../utils/crypto");

const emailModule = require("./email");
const { sendEmail } = emailModule;


const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("Missing env JWT_SECRET");

const ACCESS_TOKEN_EXPIRES_IN = process.env.ACCESS_TOKEN_EXPIRES_IN || "2h";
const REFRESH_TOKEN_TTL_DAYS = Number.parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || "30", 10);
const REFRESH_TOKEN_TTL_MS =
  (Number.isFinite(REFRESH_TOKEN_TTL_DAYS) ? REFRESH_TOKEN_TTL_DAYS : 30) * 24 * 60 * 60 * 1000;


const APP_URL = process.env.APP_URL || "http://localhost:5173";
const API_URL = process.env.API_URL || "http://localhost:4000";
const EMAIL_LOGO_URL = process.env.EMAIL_LOGO_URL;
const EMAIL_LOGO_PATH = process.env.EMAIL_LOGO_PATH;

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `${API_URL}/auth/google/callback`;

// Closed beta is ON by default. Set CLOSED_BETA_ENABLED=0 to disable without code changes.
const CLOSED_BETA_ENABLED = process.env.CLOSED_BETA_ENABLED !== "0";

async function assertClosedBetaAllowed(email) {
  if (!CLOSED_BETA_ENABLED) return;
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return;

  const beta = await prisma.betaUser.findUnique({
    where: { email: normalizedEmail },
    select: { role: true },
  });

  if (!beta) {
    const err = new Error("closed_beta");
    err.status = 403;
    throw err;
  }
}

const FACEBOOK_CLIENT_ID = process.env.FACEBOOK_CLIENT_ID;
const FACEBOOK_CLIENT_SECRET = process.env.FACEBOOK_CLIENT_SECRET;
const FACEBOOK_REDIRECT_URI = process.env.FACEBOOK_REDIRECT_URI || `${API_URL}/auth/oauth/facebook/callback`;

const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID;
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const APPLE_KEY_ID = process.env.APPLE_KEY_ID;
const APPLE_PRIVATE_KEY = process.env.APPLE_PRIVATE_KEY;
const APPLE_REDIRECT_URI = process.env.APPLE_REDIRECT_URI || `${API_URL}/auth/apple/callback`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? null,
    role: user.role,
    plan: user.plan,
    status: user.status,
    emailVerifiedAt: user.emailVerifiedAt,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

function signAccessToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
}

function newRefreshToken(userId) {
  const raw = randomToken(32);
  return {
    raw,
    tokenHash: sha256(raw),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    userId,
  };
}

async function createRefreshToken(userId, prismaClient = prisma) {
  const t = newRefreshToken(userId);

  await prismaClient.authToken.create({
    data: {
      tokenHash: t.tokenHash,
      type: "REFRESH",
      expiresAt: t.expiresAt,
      userId: t.userId,
    },
  });

  return t.raw;
}

let cachedInlineLogo = null;
let inlineLogoChecked = false;

function getInlineLogoAttachment() {
  if (inlineLogoChecked) return cachedInlineLogo;
  inlineLogoChecked = true;

  const candidates = [
    EMAIL_LOGO_PATH,
    path.resolve(__dirname, "..", "..", "..", "frontend", "public", "brand", "coreai-email-logo.png"),
    path.resolve(__dirname, "..", "public", "brand", "coreai-email-logo.png"),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p).toString("base64");
        cachedInlineLogo = {
          content,
          filename: "coreai-email-logo.png",
          type: "image/png",
          disposition: "inline",
          content_id: "coreai-logo",
        };
        return cachedInlineLogo;
      }
    } catch {
      // ignore
    }
  }

  cachedInlineLogo = null;
  return null;
}

async function register({ email, password, name }) {
  const normalizedEmail = email.trim().toLowerCase();

  await assertClosedBetaAllowed(normalizedEmail);

  const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (existing) {
    const err = new Error("EMAIL_ALREADY_IN_USE");
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { email: normalizedEmail, passwordHash, name: name || null },
  });

  const raw = randomToken(32);
  const tokenHash = sha256(raw);

  await prisma.authToken.create({
    data: {
      tokenHash,
      type: "EMAIL_VERIFY",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24h
      userId: user.id,
    },
  });

  const verifyLink = `${API_URL}/auth/verify-email?token=${raw}`;
  // Never log verification links/tokens (logs are often accessible in hosting dashboards).

await emailModule.sendEmail({
  to: user.email,
    subject: "Confirm your email - Core AI",
    html: `<p>Click to verify your email:</p><p><a href="${verifyLink}">${verifyLink}</a></p>`,
  });

  return { user: safeUser(user) };
}

async function requestMagicLink({ email, name }) {
  const normalizedEmail = email.trim().toLowerCase();

  await assertClosedBetaAllowed(normalizedEmail);

  let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user) {
    const passwordHash = await bcrypt.hash(randomToken(32), 12);
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        passwordHash,
        name: name || null,
      },
    });
  } else if (name && !user.name) {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { name },
    });
  }

  if (user.status !== "ACTIVE") {
    const err = new Error("ACCOUNT_NOT_ACTIVE");
    err.status = 403;
    throw err;
  }

  const raw = randomToken(32);
  const tokenHash = sha256(raw);

  await prisma.authToken.updateMany({
    where: {
      userId: user.id,
      type: "LOGIN_LINK",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });

  await prisma.authToken.create({
    data: {
      tokenHash,
      type: "LOGIN_LINK",
      expiresAt: new Date(Date.now() + 1000 * 60 * 15), // 15 min
      userId: user.id,
    },
  });

  const verifyLink = `${APP_URL}/auth/callback?token=${raw}`;

  const inlineLogo = getInlineLogoAttachment();
  const logoUrl = inlineLogo
    ? "cid:coreai-logo"
    : EMAIL_LOGO_URL || `${APP_URL}/brand/coreai-email-logo.png`;

  await emailModule.sendEmail({
    to: user.email,
    subject: "Your sign-in link for Core AI",
    html: `
      <div style="background:#f6f7fb; padding:32px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e9ecf2;">
          <tr>
            <td style="padding:24px 24px 8px 24px; text-align:left;">
              <img src="${logoUrl}" alt="Core AI" style="display:block;height:28px;width:auto;" />
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 0 24px;">
              <h1 style="margin:0;font-size:22px;line-height:1.3;color:#0b0b0f;font-family:Arial,sans-serif;">
                Sign in to Core AI
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 24px 0 24px;">
              <p style="margin:0;font-size:14px;line-height:1.6;color:#3a3a45;font-family:Arial,sans-serif;">
                We received a request to sign in to your account. Click the button below to continue.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 24px;">
              <a href="${verifyLink}" style="display:inline-block;background:#1f1f1f;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-family:Arial,sans-serif;">
                Sign in to my account
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 16px 24px;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#6b6b76;font-family:Arial,sans-serif;">
                This link expires in 15 minutes.
                <strong style="color:#111; font-weight:700;"> IF THIS WASN'T YOU, IGNORE THIS EMAIL.</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px 24px;">
              <p style="margin:0;font-size:12px;color:#9aa0a6;font-family:Arial,sans-serif;">
                If the button doesn't work, copy and paste this link into your browser:
                <br />
                <a href="${verifyLink}" style="color:#4b6bfb;text-decoration:none;word-break:break-all;">${verifyLink}</a>
              </p>
            </td>
          </tr>
        </table>
      </div>
    `,
    text: `Sign in to Core AI\n\nClick this link to sign in: ${verifyLink}\nThis link expires in 15 minutes. IF THIS WASN'T YOU, IGNORE THIS EMAIL.`,
    attachments: inlineLogo ? [inlineLogo] : undefined,
  });

  return { ok: true };
}

async function verifyMagicLink({ token }) {
  const tokenHash = sha256(token);

  const authToken = await prisma.authToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!authToken || authToken.type !== "LOGIN_LINK") {
    const err = new Error("INVALID_TOKEN");
    err.status = 400;
    throw err;
  }

  if (authToken.usedAt) {
    const err = new Error("TOKEN_ALREADY_USED");
    err.status = 400;
    throw err;
  }

  if (authToken.expiresAt < new Date()) {
    const err = new Error("TOKEN_EXPIRED");
    err.status = 400;
    throw err;
  }

  await assertClosedBetaAllowed(authToken.user.email);

  const refresh = newRefreshToken(authToken.userId);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: authToken.userId },
      data: {
        emailVerifiedAt: authToken.user.emailVerifiedAt || new Date(),
        lastLoginAt: new Date(),
      },
    }),
    prisma.authToken.update({
      where: { id: authToken.id },
      data: { usedAt: new Date() },
    }),
    prisma.authToken.create({
      data: {
        tokenHash: refresh.tokenHash,
        type: "REFRESH",
        expiresAt: refresh.expiresAt,
        userId: refresh.userId,
      },
    }),
  ]);

  const accessToken = signAccessToken(authToken.user);
  return { user: safeUser(authToken.user), accessToken, refreshToken: refresh.raw };
}

async function resendVerification({ email }) {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  // Resposta neutra (anti-enumeraÃ§Ã£o)
  if (!user) return { ok: true };
  if (user.emailVerifiedAt) return { ok: true };

  const raw = randomToken(32);
  const tokenHash = sha256(raw);

  await prisma.authToken.updateMany({
    where: {
      userId: user.id,
      type: "EMAIL_VERIFY",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });

  await prisma.authToken.create({
    data: {
      tokenHash,
      type: "EMAIL_VERIFY",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24h
      userId: user.id,
    },
  });

  const verifyLink = `${API_URL}/auth/verify-email?token=${raw}`;

  await emailModule.sendEmail({
    to: user.email,
    subject: "Confirm your email - Core AI",
    html: `<p>Click to verify your email:</p><p><a href="${verifyLink}">${verifyLink}</a></p>`,
  });

  return { ok: true };
}

async function verifyEmail({ token }) {
  const tokenHash = sha256(token);

  const authToken = await prisma.authToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!authToken || authToken.type !== "EMAIL_VERIFY") {
    const err = new Error("INVALID_TOKEN");
    err.status = 400;
    throw err;
  }

  if (authToken.usedAt) {
    const err = new Error("TOKEN_ALREADY_USED");
    err.status = 400;
    throw err;
  }

  if (authToken.expiresAt < new Date()) {
    const err = new Error("TOKEN_EXPIRED");
    err.status = 400;
    throw err;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: authToken.userId },
      data: { emailVerifiedAt: authToken.user.emailVerifiedAt || new Date() },
    }),
    prisma.authToken.update({
      where: { id: authToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return { ok: true };
}

async function login({ email, password }) {
  const normalizedEmail = email.trim().toLowerCase();

  await assertClosedBetaAllowed(normalizedEmail);

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  if (!user) {
    const err = new Error("INVALID_CREDENTIALS");
    err.status = 401;
    throw err;
  }

  if (user.status !== "ACTIVE") {
    const err = new Error("ACCOUNT_NOT_ACTIVE");
    err.status = 403;
    throw err;
  }

  if (!user.emailVerifiedAt) {
    const err = new Error("EMAIL_NOT_VERIFIED");
    err.status = 403;
    throw err;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const err = new Error("INVALID_CREDENTIALS");
    err.status = 401;
    throw err;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user.id);
  return { user: safeUser(user), accessToken, refreshToken };
}

async function forgotPassword({ email }) {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  // Resposta igual sempre (anti-enumeraÃ§Ã£o)
  if (!user) return { ok: true };

  const raw = randomToken(32);
  const tokenHash = sha256(raw);

  await prisma.authToken.create({
    data: {
      tokenHash,
      type: "PASSWORD_RESET",
      expiresAt: new Date(Date.now() + 1000 * 60 * 30), // 30 min
      userId: user.id,
    },
  });

  const resetLink = `${APP_URL}/reset-password?token=${raw}`;
  // Never log reset links/tokens (logs are often accessible in hosting dashboards).

  await emailModule.sendEmail({
    to: user.email,
    subject: "Reset your password - Core AI",
    html: `<p>Link:</p><p><a href="${resetLink}">${resetLink}</a></p><p>Valid for 30 minutes.</p>`,
  });

  return { ok: true };
}

async function resetPassword({ token, newPassword }) {
  const tokenHash = sha256(token);

  const authToken = await prisma.authToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!authToken || authToken.type !== "PASSWORD_RESET") {
    const err = new Error("INVALID_TOKEN");
    err.status = 400;
    throw err;
  }

  if (authToken.usedAt) {
    const err = new Error("TOKEN_ALREADY_USED");
    err.status = 400;
    throw err;
  }

  if (authToken.expiresAt < new Date()) {
    const err = new Error("TOKEN_EXPIRED");
    err.status = 400;
    throw err;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: authToken.userId },
      data: { passwordHash },
    }),
    prisma.authToken.update({
      where: { id: authToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return { ok: true };
}

async function refreshSession({ refreshToken }) {
  const raw = (refreshToken || "").trim();
  if (!raw) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }

  const tokenHash = sha256(raw);
  const authToken = await prisma.authToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!authToken || authToken.type !== "REFRESH") {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }

  if (authToken.usedAt) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }

  if (authToken.expiresAt < new Date()) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }

  if (authToken.user.status !== "ACTIVE") {
    const err = new Error("ACCOUNT_NOT_ACTIVE");
    err.status = 403;
    throw err;
  }

  await assertClosedBetaAllowed(authToken.user.email);

  const nextRefresh = newRefreshToken(authToken.userId);

  await prisma.$transaction([
    prisma.authToken.update({
      where: { id: authToken.id },
      data: { usedAt: new Date() },
    }),
    prisma.authToken.create({
      data: {
        tokenHash: nextRefresh.tokenHash,
        type: "REFRESH",
        expiresAt: nextRefresh.expiresAt,
        userId: nextRefresh.userId,
      },
    }),
    prisma.user.update({
      where: { id: authToken.userId },
      data: { lastLoginAt: new Date() },
    }),
  ]);

  return {
    user: safeUser(authToken.user),
    accessToken: signAccessToken(authToken.user),
    refreshToken: nextRefresh.raw,
  };
}

async function logoutSession({ refreshToken }) {
  const raw = (refreshToken || "").trim();
  if (!raw) return { ok: true };

  const tokenHash = sha256(raw);
  await prisma.authToken.updateMany({
    where: { tokenHash, type: "REFRESH", usedAt: null },
    data: { usedAt: new Date() },
  });

  return { ok: true };
}

async function deleteAccount({ userId, refreshToken }) {
  const id = String(userId || "").trim();
  if (!id) {
    const err = new Error("UNAUTHORIZED");
    err.status = 401;
    throw err;
  }

  // Best-effort revoke current refresh token (if provided).
  try {
    await logoutSession({ refreshToken: refreshToken || "" });
  } catch (e) {
    // Ignore revocation errors; deleting the user will cascade tokens anyway.
    if (!isTransientDbError(e)) {
      // Non-transient errors shouldn't block account deletion.
    }
  }

  // Hard delete the user. Cascades remove conversations/messages/memory/tokens/usage logs.
  await prisma.user.delete({ where: { id } });

  return { ok: true };
}
function googleAuthUrl(state) {
  const p = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

async function googleStart() {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    throw Object.assign(new Error("Missing GOOGLE env"), { status: 500 });
  }
  const state = randomToken(16);
  return { url: googleAuthUrl(state), state };
}

async function googleCallback({ code, state }) {
  if (!code) throw Object.assign(new Error("MISSING_CODE"), { status: 400 });

  // 1) trocar code por tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const txt = await tokenRes.text();
    throw Object.assign(new Error(`GOOGLE_TOKEN_EXCHANGE_FAILED: ${txt}`), { status: 400 });
  }

  const tokens = await tokenRes.json();

  // 2) obter userinfo com access_token
  const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoRes.ok) {
    const txt = await userInfoRes.text();
    throw Object.assign(new Error(`GOOGLE_USERINFO_FAILED: ${txt}`), { status: 400 });
  }

  const profile = await userInfoRes.json();
  const email = (profile.email || "").trim().toLowerCase();
  const name = profile.name || null;

  if (!email) throw Object.assign(new Error("GOOGLE_NO_EMAIL"), { status: 400 });

  // Warm up DB connection (Supabase pooler can be flaky; Prisma may throw P1001 on first touch).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await prisma.$connect();
      break;
    } catch (e) {
      const transient = isTransientDbError(e);
      if (!transient || attempt === 2) throw e;
      await sleep(100 + attempt * 250);
    }
  }

  await assertClosedBetaAllowed(email);

  // 3) encontrar ou criar user (email verificado por OAuth)
  let user;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      user = await prisma.user.findUnique({ where: { email } });
      break;
    } catch (e) {
      const transient = isTransientDbError(e);
      if (!transient || attempt === 2) throw e;
      await sleep(100 + attempt * 250);
    }
  }

  if (!user) {
    const passwordHash = await bcrypt.hash(randomToken(32), 12);

    user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
  } else {
    if (user.status !== "ACTIVE") {
      const err = new Error("ACCOUNT_NOT_ACTIVE");
      err.status = 403;
      throw err;
    }

    // Sync basic profile fields (idempotent).
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: user.emailVerifiedAt || new Date(),
        lastLoginAt: new Date(),
        name: user.name || name || null,
      },
    });
    // se jÃ¡ existia, marca verificado se ainda nÃ£o estava
    // emailVerifiedAt already updated above
  }

  // 4) emitir um token de login (one-time) e redirecionar para o frontend
  const raw = randomToken(32);
  const tokenHash = sha256(raw);

  await prisma.authToken.updateMany({
    where: {
      userId: user.id,
      type: "LOGIN_LINK",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });

  await prisma.authToken.create({
    data: {
      tokenHash,
      type: "LOGIN_LINK",
      expiresAt: new Date(Date.now() + 1000 * 60 * 15), // 15 min
      userId: user.id,
    },
  });

  return { redirectTo: `${APP_URL}/auth/callback?token=${raw}` };
}

function appleAuthUrl({ state, nonce }) {
  const p = new URLSearchParams({
    response_type: "code",
    response_mode: "form_post",
    client_id: APPLE_CLIENT_ID,
    redirect_uri: APPLE_REDIRECT_URI,
    scope: "name email",
    state,
    nonce,
  });

  return `https://appleid.apple.com/auth/authorize?${p.toString()}`;
}

function normalizeApplePrivateKey(raw) {
  if (!raw) return raw;
  const trimmed = String(raw).trim();

  // When stored in .env as a single line, newlines are usually escaped as "\n".
  if (trimmed.includes("-----BEGIN PRIVATE KEY-----") && trimmed.includes("\\n")) {
    return trimmed.replace(/\\n/g, "\n");
  }

  return trimmed;
}

function createAppleClientSecret() {
  if (!APPLE_CLIENT_ID || !APPLE_TEAM_ID || !APPLE_KEY_ID || !APPLE_PRIVATE_KEY) {
    throw Object.assign(new Error("APPLE_OAUTH_NOT_CONFIGURED"), { status: 500 });
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60 * 10; // 10 minutes

  return jwt.sign(
    {
      iss: APPLE_TEAM_ID,
      iat,
      exp,
      aud: "https://appleid.apple.com",
      sub: APPLE_CLIENT_ID,
    },
    normalizeApplePrivateKey(APPLE_PRIVATE_KEY),
    {
      algorithm: "ES256",
      header: { kid: APPLE_KEY_ID },
    }
  );
}

let appleJwksCache = null;
let appleJwksFetchedAt = 0;

async function getAppleJwks() {
  const now = Date.now();
  if (appleJwksCache && now - appleJwksFetchedAt < 60 * 60 * 1000) return appleJwksCache;

  const res = await fetch("https://appleid.apple.com/auth/keys");
  if (!res.ok) {
    const txt = await res.text();
    throw Object.assign(new Error(`APPLE_JWKS_FETCH_FAILED: ${txt}`), { status: 500 });
  }

  const json = await res.json();
  appleJwksCache = Array.isArray(json.keys) ? json.keys : [];
  appleJwksFetchedAt = now;
  return appleJwksCache;
}

async function verifyAppleIdToken(idToken, expectedNonce) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || !decoded.header?.kid) {
    throw Object.assign(new Error("APPLE_ID_TOKEN_INVALID"), { status: 401 });
  }

  const keys = await getAppleJwks();
  const jwk = keys.find((k) => k.kid === decoded.header.kid);
  if (!jwk) {
    throw Object.assign(new Error("APPLE_JWK_NOT_FOUND"), { status: 401 });
  }

  let keyObject;
  try {
    keyObject = crypto.createPublicKey({ key: jwk, format: "jwk" });
  } catch (e) {
    throw Object.assign(new Error("APPLE_JWK_IMPORT_FAILED"), { status: 500, cause: e });
  }

  const payload = jwt.verify(idToken, keyObject, {
    algorithms: ["RS256"],
    audience: APPLE_CLIENT_ID,
    issuer: "https://appleid.apple.com",
  });

  if (expectedNonce && payload?.nonce && payload.nonce !== expectedNonce) {
    throw Object.assign(new Error("APPLE_NONCE_MISMATCH"), { status: 401 });
  }

  return payload;
}

function parseAppleUserName(userParam) {
  if (!userParam) return null;
  try {
    const u = typeof userParam === "string" ? JSON.parse(userParam) : userParam;
    const first = u?.name?.firstName || "";
    const last = u?.name?.lastName || "";
    const full = `${first} ${last}`.trim();
    return full || null;
  } catch {
    return null;
  }
}

async function appleStart() {
  if (!APPLE_CLIENT_ID || !APPLE_REDIRECT_URI) {
    throw Object.assign(new Error("Missing APPLE env"), { status: 500 });
  }

  const state = randomToken(16);
  const nonce = randomToken(16);
  return { url: appleAuthUrl({ state, nonce }), state, nonce };
}

async function appleCallback({ code, user: userParam, nonce }) {
  if (!code) throw Object.assign(new Error("MISSING_CODE"), { status: 400 });

  const tokenRes = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: APPLE_CLIENT_ID,
      client_secret: createAppleClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: APPLE_REDIRECT_URI,
    }),
  });

  const tokenText = await tokenRes.text();
  let tokenJson = null;
  try {
    tokenJson = JSON.parse(tokenText);
  } catch {
    // ignore
  }

  if (!tokenRes.ok) {
    const err = new Error("APPLE_TOKEN_EXCHANGE_FAILED");
    err.status = 400;
    err.details = tokenJson || tokenText;
    throw err;
  }

  const idToken = tokenJson?.id_token;
  if (!idToken) {
    const err = new Error("APPLE_NO_ID_TOKEN");
    err.status = 400;
    err.details = tokenJson;
    throw err;
  }

  const payload = await verifyAppleIdToken(idToken, nonce);

  const email = (payload.email || "").trim().toLowerCase();
  const name = parseAppleUserName(userParam);

  if (!email) {
    const err = new Error("APPLE_NO_EMAIL");
    err.status = 400;
    throw err;
  }

  // encontrar ou criar user
  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    const passwordHash = await bcrypt.hash(randomToken(32), 12);

    user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        emailVerifiedAt: new Date(),
        lastLoginAt: new Date(),
      },
    });
  } else {
    if (user.status !== "ACTIVE") {
      const err = new Error("ACCOUNT_NOT_ACTIVE");
      err.status = 403;
      throw err;
    }

    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: user.emailVerifiedAt || new Date(),
        lastLoginAt: new Date(),
        name: user.name || name || null,
      },
    });
  }

  // emitir token one-time (mesmo fluxo de magic link)
  const raw = randomToken(32);
  const tokenHash = sha256(raw);

  await prisma.authToken.updateMany({
    where: {
      userId: user.id,
      type: "LOGIN_LINK",
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });

  await prisma.authToken.create({
    data: {
      tokenHash,
      type: "LOGIN_LINK",
      expiresAt: new Date(Date.now() + 1000 * 60 * 15), // 15 min
      userId: user.id,
    },
  });

  return { redirectTo: `${APP_URL}/auth/callback?token=${raw}` };
}

async function oauthLogin({ provider, code }) {
  if (provider === "google") {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
      const err = new Error("GOOGLE_OAUTH_NOT_CONFIGURED");
      err.status = 500;
      throw err;
    }

    // Trocar code -> tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
        code,
      }),
    });

    const tokenJson = await tokenRes.json();
    if (!tokenRes.ok) {
      const err = new Error("GOOGLE_TOKEN_EXCHANGE_FAILED");
      err.status = 400;
      err.details = tokenJson;
      throw err;
    }

    const accessToken = tokenJson.access_token;

    // Buscar perfil (email)
    const profileRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const profile = await profileRes.json();
    if (!profileRes.ok) {
      const err = new Error("GOOGLE_PROFILE_FETCH_FAILED");
      err.status = 400;
      err.details = profile;
      throw err;
    }

    const email = (profile.email || "").trim().toLowerCase();
    if (!email) {
      const err = new Error("GOOGLE_EMAIL_NOT_AVAILABLE");
      err.status = 400;
      throw err;
    }

    await assertClosedBetaAllowed(email);

    // Encontrar ou criar user
    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // criar com password random (para cumprir schema)
      const passwordHash = await bcrypt.hash(randomToken(32), 12);

      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name: profile.name || null,
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date(),
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          emailVerifiedAt: user.emailVerifiedAt || new Date(),
          name: user.name || profile.name || null,
        },
      });
    }

    const refreshToken = await createRefreshToken(user.id);
    return { user: safeUser(user), accessToken: signAccessToken(user), refreshToken };
  }

  if (provider === "facebook") {
    if (!FACEBOOK_CLIENT_ID || !FACEBOOK_CLIENT_SECRET) {
      const err = new Error("FACEBOOK_OAUTH_NOT_CONFIGURED");
      err.status = 500;
      throw err;
    }

    // Trocar code -> access_token
    const tokenUrl = new URL("https://graph.facebook.com/v19.0/oauth/access_token");
    tokenUrl.searchParams.set("client_id", FACEBOOK_CLIENT_ID);
    tokenUrl.searchParams.set("client_secret", FACEBOOK_CLIENT_SECRET);
    tokenUrl.searchParams.set("redirect_uri", FACEBOOK_REDIRECT_URI);
    tokenUrl.searchParams.set("code", code);

    const tokenRes = await fetch(tokenUrl.toString());
    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok) {
      const err = new Error("FACEBOOK_TOKEN_EXCHANGE_FAILED");
      err.status = 400;
      err.details = tokenJson;
      throw err;
    }

    const accessToken = tokenJson.access_token;

    // Buscar perfil (email pode nÃ£o vir se nÃ£o pedires scope/email no frontend)
    const meUrl = new URL("https://graph.facebook.com/me");
    meUrl.searchParams.set("fields", "id,name,email");
    meUrl.searchParams.set("access_token", accessToken);

    const profileRes = await fetch(meUrl.toString());
    const profile = await profileRes.json();

    if (!profileRes.ok) {
      const err = new Error("FACEBOOK_PROFILE_FETCH_FAILED");
      err.status = 400;
      err.details = profile;
      throw err;
    }

    const email = (profile.email || "").trim().toLowerCase();
    if (!email) {
      const err = new Error("FACEBOOK_EMAIL_NOT_AVAILABLE");
      err.status = 400;
      throw err;
    }

    await assertClosedBetaAllowed(email);

    let user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      const passwordHash = await bcrypt.hash(randomToken(32), 12);

      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name: profile.name || null,
          emailVerifiedAt: new Date(),
          lastLoginAt: new Date(),
        },
      });
    } else {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          emailVerifiedAt: user.emailVerifiedAt || new Date(),
          name: user.name || profile.name || null,
        },
      });
    }

    const refreshToken = await createRefreshToken(user.id);
    return { user: safeUser(user), accessToken: signAccessToken(user), refreshToken };
  }

  if (provider === "apple") {
    // Vamos implementar jÃ¡ a seguir (precisa de JWT client_secret assinado).
    const err = new Error("APPLE_OAUTH_NOT_IMPLEMENTED_YET");
    err.status = 501;
    throw err;
  }

  const err = new Error("OAUTH_PROVIDER_NOT_SUPPORTED");
  err.status = 400;
  throw err;
}

module.exports = {
  register,
  requestMagicLink,
  verifyMagicLink,
  resendVerification,
  verifyEmail,
  login,
  forgotPassword,
  resetPassword,
  refreshSession,
  logoutSession,
  deleteAccount,
  oauthLogin,
  googleStart,
  googleCallback,
  appleStart,
  appleCallback,
};

