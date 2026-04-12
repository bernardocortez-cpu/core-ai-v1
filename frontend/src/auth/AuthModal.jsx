import React from "react";
import { useAuth } from "./AuthContext";
import LoginForm from "./LoginForm";
import SignupForm from "./SignupForm";
import CheckEmail from "./CheckEmail";
import "./auth.css";

export default function AuthModal() {
  const { authOpen, authMode, closeAuth, setAuthMode } = useAuth();

  if (!authOpen) return null;

  const title =
    authMode === "signup"
      ? "Create account"
      : authMode === "verify"
      ? "Check your email"
      : "Log in";

  return (
    <div className="auth-backdrop" onClick={closeAuth}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button
          className="auth-close"
          type="button"
          aria-label="Fechar"
          onClick={closeAuth}
        >
          ×
        </button>

        <h2 className="auth-title">{title}</h2>

        {authMode === "login" && (
          <LoginForm onSwitchSignup={() => setAuthMode("signup")} />
        )}

        {authMode === "signup" && (
          <SignupForm onSwitchLogin={() => setAuthMode("login")} />
        )}

        {authMode === "verify" && <CheckEmail />}
      </div>
    </div>
  );
}

