import React, { useState } from "react";
import { useAuth } from "./AuthContext";
import OAuthButtons from "./OAuthButtons";

export default function LoginForm({ onSwitchSignup }) {
  const { requestMagicLink, authLoading, authError } = useAuth();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const clean = email.trim();
    if (!clean || !clean.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }

    setLoading(true);
    try {
      await requestMagicLink({ email: clean });
    } catch {
      // erro já tratado no contexto
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="auth-form">
      <div className="auth-top-space" />

      <OAuthButtons />

      <div className="auth-divider">
        <span>or</span>
      </div>

      <label>
        Email
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          placeholder="Enter your email address."
          autoComplete="email"
        />
      </label>

      {(error || authError) && (
        <div className="auth-error">{error || authError}</div>
      )}

      <button className="auth-primary" type="submit" disabled={loading}>
        {loading || authLoading ? "Sending link..." : "Continue"}
      </button>

      <div className="auth-switch">
        Don't have an account yet?{" "}
        <button type="button" className="auth-link" onClick={onSwitchSignup}>
          Create account
        </button>
      </div>
    </form>
  );
}
