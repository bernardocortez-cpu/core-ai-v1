import React, { useState } from "react";
import { useAuth } from "./AuthContext";
import OAuthButtons from "./OAuthButtons";

export default function SignupForm({ onSwitchLogin }) {
  const { requestMagicLink, authLoading, authError } = useAuth();

  const [name, setName] = useState("");
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
      await requestMagicLink({ email: clean, name: name.trim() || undefined });
    } catch {
      // erro tratado no contexto
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
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          type="text"
          placeholder="your name"
          autoComplete="name"
        />
      </label>

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
        {loading || authLoading ? "Sending link..." : "Create account"}
      </button>

      <div className="auth-switch">
        Do you already have an account?{" "}
        <button type="button" className="auth-link" onClick={onSwitchLogin}>
          Log in
        </button>
      </div>
    </form>
  );
}
