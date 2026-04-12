import axios from "axios";

export const api = axios.create({
baseURL: import.meta.env.VITE_API_URL,
withCredentials: true,
});

export const OAUTH_URL = import.meta.env.VITE_OAUTH_URL || "/api";

const AUTH_EVENT_NAME = "coreai:auth";
let refreshPromise = null;

function safeDispatchAuthEvent(detail) {
  try {
    window.dispatchEvent(new CustomEvent(AUTH_EVENT_NAME, { detail }));
  } catch {
    // ignore
  }
}

function persistSession({ user, accessToken }) {
  try {
    if (user) localStorage.setItem("coreai_user", JSON.stringify(user));
    if (accessToken) localStorage.setItem("coreai_token", accessToken);
    if (user || accessToken) localStorage.setItem("coreai_has_session", "1");
  } catch {
    // ignore
  }
  safeDispatchAuthEvent({ user, accessToken });
}

function clearSession() {
  try {
    localStorage.removeItem("coreai_user");
    localStorage.removeItem("coreai_token");
    localStorage.removeItem("coreai_has_session");
  } catch {
    // ignore
  }
  safeDispatchAuthEvent({ user: null, accessToken: null });
}

function getStoredAccessToken() {
  try {
    return localStorage.getItem("coreai_token");
  } catch {
    return null;
  }
}

function shouldClearSessionOnRefreshFailure(err) {
  const status = Number(err?.status || err?.response?.status || 0);
  return status === 401 || status === 403;
}

function isJwtExpired(token) {
  try {
    const payload = JSON.parse(atob((token || "").split(".")[1] || ""));
    const expMs = typeof payload?.exp === "number" ? payload.exp * 1000 : 0;
    if (!expMs) return false;
    return Date.now() >= expMs - 5000;
  } catch {
    return false;
  }
}

function normalizeAxiosError(err) {
  if (err && err.status && err.details) return err;

  const status = Number(err?.response?.status || err?.status || 0);
  const details = err?.response?.data ?? err?.details ?? null;
  const msg =
    details?.error ||
    details?.message ||
    err?.message ||
    "REQUEST_FAILED";

  const e = new Error(String(msg));
  e.status = status;
  e.details = details;
  return e;
}

export async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const res = await api.post(
      "/auth/refresh",
      {},
      { skipAuthRefresh: true, skipAuthHeader: true }
    );

    const data = res?.data || {};
    persistSession({
      user: data?.user || null,
      accessToken: data?.accessToken || null,
    });
    return data?.accessToken || null;
  })()
    .catch((err) => {
      const e = normalizeAxiosError(err);
      if (shouldClearSessionOnRefreshFailure(e)) clearSession();
      throw e;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

api.interceptors.request.use(
  async (config) => {
    const next = { ...(config || {}) };
    next.headers = { ...(next.headers || {}) };

    const url = String(next.url || "");
    const skipAuthRefresh = !!next.skipAuthRefresh || url.startsWith("/auth/refresh");
    const skipAuthHeader = !!next.skipAuthHeader || url.startsWith("/auth/refresh");

    const hasAuthHeader = Object.keys(next.headers).some(
      (k) => String(k).toLowerCase() === "authorization"
    );
    const headerToken = hasAuthHeader
      ? String(next.headers.Authorization || next.headers.authorization || "")
          .replace(/^Bearer\\s+/i, "")
          .trim() || null
      : null;

    const stored = getStoredAccessToken();
    const candidate = headerToken || stored;

    if (!skipAuthRefresh && candidate && isJwtExpired(candidate)) {
      try {
        const fresh = await refreshAccessToken();
        if (fresh) next.headers.Authorization = `Bearer ${fresh}`;
      } catch {
        // ignore
      }
    }

    if (!skipAuthHeader && !hasAuthHeader) {
      const token = getStoredAccessToken();
      if (token) next.headers.Authorization = `Bearer ${token}`;
    }

    return next;
  },
  (err) => Promise.reject(normalizeAxiosError(err))
);

api.interceptors.response.use(
  (res) => {
    const url = String(res?.config?.url || "");
    if (url.startsWith("/auth/refresh")) {
      const data = res?.data || {};
      if (data?.accessToken || data?.user) {
        persistSession({
          user: data?.user || null,
          accessToken: data?.accessToken || null,
        });
      }
    }
    return res;
  },
  async (err) => {
    const status = Number(err?.response?.status || 0);
    const original = err?.config || {};
    const url = String(original.url || "");

    const skipAuthRefresh =
      !!original.skipAuthRefresh ||
      url.startsWith("/auth/refresh") ||
      url.startsWith("/auth/logout");

    if (status === 401 && !skipAuthRefresh && !original._retry) {
      original._retry = true;
      try {
        const fresh = await refreshAccessToken();
        if (fresh) {
          original.headers = { ...(original.headers || {}), Authorization: `Bearer ${fresh}` };
          return api.request(original);
        }
      } catch (refreshErr) {
        const e = normalizeAxiosError(refreshErr);
        if (shouldClearSessionOnRefreshFailure(e)) clearSession();
        return Promise.reject(e);
      }
    }

    return Promise.reject(normalizeAxiosError(err));
  }
);

export function resolveApiUrl(path) {
  const p = String(path || "");
  if (/^https?:\/\//i.test(p) || p.startsWith("data:")) return p;

  const base = String(import.meta.env.VITE_API_URL || "");
  if (!base) return p;

  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const r = p.startsWith("/") ? p : `/${p}`;
  return `${b}${r}`;
}

export function apiStream(path, init = {}) {
  const url = resolveApiUrl(path);
  const headers = { ...(init.headers || {}) };

  const hasAuthHeader = Object.keys(headers).some(
    (k) => String(k).toLowerCase() === "authorization"
  );

  if (!hasAuthHeader) {
    const token = getStoredAccessToken();
    if (token && isJwtExpired(token)) {
      // Best-effort refresh so SSE calls don't fail with an expired token.
      // If refresh fails, we still attempt the request and let it 401.
      return refreshAccessToken()
        .then((fresh) => {
          if (fresh) headers.Authorization = `Bearer ${fresh}`;
          return fetch(url, {
            credentials: "include",
            ...init,
            headers,
          });
        })
        .catch(() =>
          fetch(url, {
            credentials: "include",
            ...init,
            headers,
          })
        );
    }

    if (token) headers.Authorization = `Bearer ${token}`;
  }

  return fetch(url, {
    credentials: "include",
    ...init,
    headers,
  });
}

export async function apiGetBlob(url) {
  const u = String(url || "");
  if (!u) throw new Error("MISSING_URL");
  if (u.startsWith("data:")) {
    const res = await fetch(u);
    return res.blob();
  }
  const isAbsolute = /^https?:\/\//i.test(u);
  const res = await api.get(u, {
    responseType: "blob",
    ...(isAbsolute ? { withCredentials: false, skipAuthRefresh: true, skipAuthHeader: true } : {}),
  });
  return res.data;
}
