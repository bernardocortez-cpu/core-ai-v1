const { z } = require("zod");
const authService = require("../services/auth.service");
const { isTransientDbError } = require("../utils/dbErrors");

const REFRESH_COOKIE_NAME = process.env.REFRESH_COOKIE_NAME || "coreai_refresh";
const REFRESH_TOKEN_TTL_DAYS = Number.parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || "30", 10);
const REFRESH_COOKIE_MAX_AGE =
  (Number.isFinite(REFRESH_TOKEN_TTL_DAYS) ? REFRESH_TOKEN_TTL_DAYS : 30) * 24 * 60 * 60 * 1000;

const CLOSED_BETA_JSON = {
  error: "closed_beta",
  message: "Core AI está atualmente em closed beta.",
};

function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: REFRESH_COOKIE_MAX_AGE,
    // Use "/" to avoid path-mismatch issues (e.g. if frontend/proxy paths change).
    // This cookie is httpOnly + sameSite, and only used for POST /auth/refresh.
    path: "/",
  };
}

function setRefreshCookie(res, refreshToken) {
  if (!refreshToken) return;
  const opts = refreshCookieOptions();
  if (process.env.DEBUG_AUTH === "1") {
    console.log("[auth.setRefreshCookie]", {
      refreshCookieName: REFRESH_COOKIE_NAME,
      path: opts.path,
      sameSite: opts.sameSite,
      secure: opts.secure,
      maxAge: opts.maxAge,
    });
  }
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, opts);
}

function clearRefreshCookie(res) {
  // Clear both legacy and current paths (browsers treat same-name cookies as distinct by Path).
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/auth" });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/" });
}

function getCookieFromHeader(cookieHeader, name) {
  if (!cookieHeader || !name) return null;
  // Minimal cookie parsing to avoid surprises when multiple cookies share names/paths.
  const parts = String(cookieHeader).split(";");
  for (const p of parts) {
    const [k, ...rest] = p.trim().split("=");
    if (!k) continue;
    if (k === name) return rest.join("=") || "";
  }
  return null;
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(80).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});

const forgotSchema = z.object({
  email: z.string().email(),
});
const resendSchema = z.object({
  email: z.string().email(),
});

const resetSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(8).max(200),
});
const oauthSchema = z.object({
  code: z.string().min(5),
});
const magicLinkSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80).optional(),
});

async function register(req, res, next) {
  try {
    const body = registerSchema.parse(req.body);
    const out = await authService.register(body);
    res.status(201).json(out);
  } catch (e) {
    if (e?.message === "closed_beta") return res.status(403).json(CLOSED_BETA_JSON);
    next(e);
  }
}

async function verifyEmail(req, res, next) {
  try {
    const token = z.string().min(10).parse(req.query.token);
    const out = await authService.verifyEmail({ token });
    res.json(out);
  } catch (e) { next(e); }
}

async function login(req, res, next) {
  try {
    const body = loginSchema.parse(req.body);
    const out = await authService.login(body);
    setRefreshCookie(res, out.refreshToken);
    res.json({ user: out.user, accessToken: out.accessToken });
  } catch (e) {
    const appUrl = process.env.APP_URL || "http://localhost:5173";
    if (e?.message === "closed_beta") return res.status(403).json(CLOSED_BETA_JSON);
    if (isTransientDbError(e)) {
      return res.redirect(`${appUrl}/auth/callback?error=DB_UNAVAILABLE`);
    }
    next(e);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const body = forgotSchema.parse(req.body);
    const out = await authService.forgotPassword(body);
    res.json(out);
  } catch (e) { next(e); }
}

async function resetPassword(req, res, next) {
  try {
    const body = resetSchema.parse(req.body);
    const out = await authService.resetPassword(body);
    res.json(out);
  } catch (e) {
    const appUrl = process.env.APP_URL || "http://localhost:5173";
    if (e?.message === "closed_beta") return res.redirect(`${appUrl}/auth/callback?error=closed_beta`);
    next(e);
  }
}

async function requestMagicLink(req, res, next) {
  try {
    const body = magicLinkSchema.parse(req.body);
    const out = await authService.requestMagicLink(body);
    res.json(out);
  } catch (e) {
    if (e?.message === "closed_beta") return res.status(403).json(CLOSED_BETA_JSON);
    next(e);
  }
}

async function verifyMagicLink(req, res, next) {
  try {
    const token = z.string().min(10).parse(req.query.token);
    const out = await authService.verifyMagicLink({ token });
    setRefreshCookie(res, out.refreshToken);
    res.json({ user: out.user, accessToken: out.accessToken });
  } catch (e) {
    if (e?.message === "closed_beta") return res.status(403).json(CLOSED_BETA_JSON);
    next(e);
  }
}

async function resendVerification(req, res, next) {
  try {
    const body = resendSchema.parse(req.body);
    const out = await authService.resendVerification(body);
    res.json(out);
  } catch (e) { next(e); }
}
function oauthLogin(provider) {
  return async (req, res, next) => {
    try {
      const body = oauthSchema.parse(req.body);
      const out = await authService.oauthLogin({ provider, code: body.code });
      setRefreshCookie(res, out.refreshToken);
      res.json({ user: out.user, accessToken: out.accessToken });
    } catch (e) {
      if (e?.message === "closed_beta") return res.status(403).json(CLOSED_BETA_JSON);
      next(e);
    }
  };
}

async function refresh(req, res, next) {
  // If there's no refresh token at all, don't clear cookies. This avoids a race where:
  // - frontend boots and calls /auth/refresh (no cookie yet) -> we clear cookie
  // - user logs in and we set cookie -> an earlier /auth/refresh response clears it again
  // Result: refresh cookie never "sticks".
  try {
    const token =
      req.cookies?.[REFRESH_COOKIE_NAME] ??
      getCookieFromHeader(req.headers?.cookie, REFRESH_COOKIE_NAME);

    // Very common path: someone visits the site with no session yet (or another person on the same machine).
    // Don't throw + log a stack trace for that; just return 401 and let the frontend show logged-out UI.
    if (!token) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    if (process.env.DEBUG_AUTH === "1") {
      const keys = Object.keys(req.cookies || {});
      console.log("[auth.refresh]", {
        origin: req.headers?.origin || null,
        cookieHeader: !!req.headers?.cookie,
        cookieKeys: keys,
        refreshCookieName: REFRESH_COOKIE_NAME,
        hasRefreshCookie: !!token,
      });
    }

    const out = await authService.refreshSession({ refreshToken: token });

    // Rotate refresh token on every refresh.
    setRefreshCookie(res, out.refreshToken);
    res.json({ user: out.user, accessToken: out.accessToken });
  } catch (e) {
    const status = Number(e?.status || 500);

    // Only clear the refresh cookie on real auth failures.
    // If the DB/network flakes (5xx), keep the cookie so the session can recover.
    if (status === 401 || status === 403) {
      clearRefreshCookie(res);
      if (status === 403 && e?.message === "closed_beta") {
        return res.status(403).json(CLOSED_BETA_JSON);
      }
      return res.status(status).json({ error: "UNAUTHORIZED" });
    }

    // Don't bubble to error middleware: returning JSON avoids noisy stack traces on transient errors.
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: e?.message || "REFRESH_FAILED",
    });
  }
}

async function logout(req, res, next) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME];
    await authService.logoutSession({ refreshToken: token });
    clearRefreshCookie(res);
    res.json({ ok: true });
  } catch (e) {
    clearRefreshCookie(res);
    next(e);
  }
}

async function deleteMe(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      const err = new Error("UNAUTHORIZED");
      err.status = 401;
      throw err;
    }

    const token =
      req.cookies?.[REFRESH_COOKIE_NAME] ??
      getCookieFromHeader(req.headers?.cookie, REFRESH_COOKIE_NAME);

    await authService.deleteAccount({ userId, refreshToken: token || null });

    // Ensure the browser forgets the refresh cookie (even though the user is deleted).
    clearRefreshCookie(res);

    res.json({ ok: true });
  } catch (e) {
    const appUrl = process.env.APP_URL || "http://localhost:5173";

    // Don't redirect on transient DB hiccups; respond JSON.
    if (isTransientDbError(e)) {
      return res.status(503).json({ error: "DB_UNAVAILABLE" });
    }

    // Keep parity with other auth handlers for closed beta.
    if (Number(e?.status) === 403 && e?.message === "closed_beta") {
      return res.status(403).json(CLOSED_BETA_JSON);
    }

    // For safety, avoid bubbling stack traces in production for this destructive operation.
    const status = Number(e?.status || 500);
    if (status >= 400 && status < 600) {
      return res.status(status).json({ error: e?.message || "DELETE_ACCOUNT_FAILED" });
    }

    // Fallback to error middleware.
    next(e);
  }
}
async function googleStart(req, res, next) {
  try {
    const { url, state } = await authService.googleStart();

    // Store state in a short-lived, httpOnly cookie to mitigate CSRF.
    res.cookie("coreai_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60 * 1000, // 10 minutes
    });
    return res.redirect(url);
  } catch (e) { next(e); }
}

async function googleCallback(req, res, next) {
  try {
    const { code, state, error, error_description: errorDescription } = req.query;
    const appUrl = process.env.APP_URL || "http://localhost:5173";

    const expectedState = req.cookies?.coreai_oauth_state;

    if (!state || !expectedState || state !== expectedState) {
      // Avoid noisy stack traces for common cases (refresh/back button on callback URL, etc).
      res.clearCookie("coreai_oauth_state");
      return res.redirect(`${appUrl}/auth/callback?error=OAUTH_STATE_MISMATCH`);
    }

    // State validated: clear it now (one-time).
    res.clearCookie("coreai_oauth_state");

    // Google can redirect with `error=...` instead of `code` if the user cancels/denies.
    if (error) {
      const qs = new URLSearchParams({
        error: String(error),
        ...(errorDescription ? { error_description: String(errorDescription) } : {}),
      });
      return res.redirect(`${appUrl}/auth/callback?${qs.toString()}`);
    }

    if (!code) {
      return res.redirect(`${appUrl}/auth/callback?error=MISSING_CODE`);
    }

    const out = await authService.googleCallback({ code, state });

    // opção A (para já): devolve JSON
    return res.redirect(out.redirectTo);

    // opção B (quando tiveres frontend pronto):
    // return res.redirect(`${process.env.APP_URL}/auth/callback?token=${out.accessToken}`);
  } catch (e) { next(e); }
}


async function appleStart(req, res, next) {
  try {
    const { url, state, nonce } = await authService.appleStart();

    res.cookie("coreai_oauth_state_apple", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    res.cookie("coreai_oauth_nonce_apple", nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 10 * 60 * 1000, // 10 minutes
    });

    return res.redirect(url);
  } catch (e) {
    const appUrl = process.env.APP_URL || "http://localhost:5173";
    if (isTransientDbError(e)) {
      return res.redirect(`${appUrl}/auth/callback?error=DB_UNAVAILABLE`);
    }
    next(e);
  }
}

async function appleCallback(req, res, next) {
  try {
    const code = req.body?.code || req.query.code;
    const state = req.body?.state || req.query.state;
    const user = req.body?.user || req.query.user;
    const error = req.body?.error || req.query.error;
    const errorDescription = req.body?.error_description || req.query.error_description;

    if (error) {
      const err = new Error(`APPLE_OAUTH_ERROR: ${errorDescription || error}`);
      err.status = 400;
      throw err;
    }

    const expectedState = req.cookies?.coreai_oauth_state_apple;
    const expectedNonce = req.cookies?.coreai_oauth_nonce_apple;
    res.clearCookie("coreai_oauth_state_apple");
    res.clearCookie("coreai_oauth_nonce_apple");

    if (!state || !expectedState || state !== expectedState) {
      const err = new Error("OAUTH_STATE_MISMATCH");
      err.status = 400;
      throw err;
    }

    const out = await authService.appleCallback({ code, user, nonce: expectedNonce });
    return res.redirect(out.redirectTo);
  } catch (e) {
    const appUrl = process.env.APP_URL || "http://localhost:5173";
    if (isTransientDbError(e)) {
      return res.redirect(`${appUrl}/auth/callback?error=DB_UNAVAILABLE`);
    }
    next(e);
  }
}

module.exports = {
  register,
  resendVerification,
  requestMagicLink,
  verifyMagicLink,
  verifyEmail,
  login,
  refresh,
  logout,
  deleteMe,
  forgotPassword,
  resetPassword,
  oauthLogin,
  googleStart,
  googleCallback,
  appleStart,
  appleCallback,
};


