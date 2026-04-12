import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

const AuthContext = createContext(null);
const AUTH_EVENT_NAME = "coreai:auth";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  // modal
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login"); // "login" | "signup" | "verify"

  const [pendingEmail, setPendingEmail] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const clearStoredSession = () => {
      try {
        localStorage.removeItem("coreai_user");
        localStorage.removeItem("coreai_token");
        localStorage.removeItem("coreai_has_session");
      } catch {
        // ignore
      }
    };

    const bootstrapAuth = async () => {
      try {
        const saved = localStorage.getItem("coreai_user");
        const token = localStorage.getItem("coreai_token");
        const hadSession = localStorage.getItem("coreai_has_session") === "1";

        let parsedUser = null;
        if (saved) {
          try {
            parsedUser = JSON.parse(saved);
          } catch {
            parsedUser = null;
          }
        }

        if (parsedUser && token) {
          if (!cancelled) {
            setUser(parsedUser);
            setAccessToken(token);
            setAuthReady(true);
          }
          return;
        }

        if (token || hadSession || parsedUser) {
          try {
            const res = await api.post(
              "/auth/refresh",
              {},
              { skipAuthRefresh: true, skipAuthHeader: true }
            );
            const out = res?.data || {};
            if (!cancelled) {
              setUser(out.user || null);
              setAccessToken(out.accessToken || null);
            }
          } catch {
            clearStoredSession();
            if (!cancelled) {
              setUser(null);
              setAccessToken(null);
            }
          } finally {
            if (!cancelled) setAuthReady(true);
          }
          return;
        }
      } catch {
        // ignore
      }

      if (!cancelled) setAuthReady(true);
    };

    void bootstrapAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  // Keep AuthContext in sync when the API layer refreshes tokens (401 -> /auth/refresh).
  useEffect(() => {
    const onAuth = (evt) => {
      const detail = evt?.detail || {};
      if ("user" in detail) setUser(detail.user || null);
      if ("accessToken" in detail) setAccessToken(detail.accessToken || null);
      if ("user" in detail || "accessToken" in detail) setAuthReady(true);
    };

    window.addEventListener(AUTH_EVENT_NAME, onAuth);
    return () => window.removeEventListener(AUTH_EVENT_NAME, onAuth);
  }, []);

  // If we boot with an expired token but still have a refresh cookie, refresh silently.
  useEffect(() => {
    const token = accessToken;
    if (!token) return;

    try {
      const payload = JSON.parse(atob(token.split(".")[1] || ""));
      const expMs = typeof payload?.exp === "number" ? payload.exp * 1000 : 0;
      if (!expMs) return;

      const isExpired = Date.now() >= expMs - 5000; // small skew
      if (!isExpired) return;

      api
        .post("/auth/refresh")
        .then((res) => {
          const out = res?.data || {};
          setUser(out.user);
          setAccessToken(out.accessToken);
        })
        .catch(() => {
          // Refresh cookie missing/expired -> local logout.
          setUser(null);
          setAccessToken(null);
        });
    } catch {
      // ignore
    }
  }, [accessToken]);

  useEffect(() => {
    if (user) localStorage.setItem("coreai_user", JSON.stringify(user));
    else localStorage.removeItem("coreai_user");
  }, [user]);

  useEffect(() => {
    if (accessToken) localStorage.setItem("coreai_token", accessToken);
    else localStorage.removeItem("coreai_token");

    if (accessToken) localStorage.setItem("coreai_has_session", "1");
    else localStorage.removeItem("coreai_has_session");
  }, [accessToken]);

  const openAuth = (mode = "login") => {
    setAuthMode(mode);
    setAuthError("");
    setAuthLoading(false);
    setAuthOpen(true);
  };

  const closeAuth = () => {
    setAuthOpen(false);
    setAuthError("");
    setAuthLoading(false);
  };

  const mapAuthError = (err) => {
    const code = err?.message;
    if (code === "ACCOUNT_NOT_ACTIVE") return "The account is not active.";
    if (code === "INVALID_TOKEN") return "Invalid link.";
    if (code === "TOKEN_EXPIRED") return "This link has expired. Request a new one.";
    return "An error occurred. Please try again.";
  };

  const requestMagicLink = async ({ email, name }) => {
    setAuthError("");
    setAuthLoading(true);
    try {
      await api.post("/auth/request-magic-link", { email, name });
      setPendingEmail(email);
      setAuthMode("verify");
    } catch (err) {
      setAuthError(mapAuthError(err));
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const resendMagicLink = async () => {
    if (!pendingEmail) return;
    setAuthError("");
    setAuthLoading(true);
    try {
      await api.post("/auth/request-magic-link", { email: pendingEmail });
    } catch (err) {
      setAuthError(mapAuthError(err));
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const completeMagicLink = async (token) => {
    if (!token) return;
    setAuthError("");
    setAuthLoading(true);
    try {
      const res = await api.get("/auth/magic-link/verify", { params: { token } });
      const out = res?.data || {};
      setUser(out.user);
      setAccessToken(out.accessToken);
      setPendingEmail("");
      setAuthOpen(false);
      setAuthMode("login");
      return out;
    } catch (err) {
      if (err?.message !== "TOKEN_ALREADY_USED") {
        setAuthError(mapAuthError(err));
      }
      throw err;
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    // Best-effort server logout (revokes refresh cookie); keep UI responsive.
    api.post("/auth/logout").catch(() => {});
    setUser(null);
    setAccessToken(null);
    setPendingEmail("");
    setAuthError("");
    setAuthLoading(false);
    setAuthOpen(false);
    setAuthMode("login");
  };

  const value = useMemo(
    () => ({
      user,
      accessToken,
      authReady,
      authOpen,
      authMode,
      pendingEmail,
      authLoading,
      authError,

      setUser,
      setAuthOpen,
      setAuthMode,
      setPendingEmail,

      openAuth,
      closeAuth,

      requestMagicLink,
      resendMagicLink,
      completeMagicLink,

      logout,
    }),
    [user, accessToken, authReady, authOpen, authMode, pendingEmail, authLoading, authError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
