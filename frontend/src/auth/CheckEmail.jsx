import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "./AuthContext";

export default function CheckEmail() {
  const {
    pendingEmail,
    resendMagicLink,
    authLoading,
    authError,
    closeAuth,
  } = useAuth();

  const DURATION = 120;
  const [timeLeft, setTimeLeft] = useState(DURATION);

  useEffect(() => {
    setTimeLeft(DURATION);
  }, [pendingEmail]);

  useEffect(() => {
    if (timeLeft <= 0) return;
    const t = setInterval(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, [timeLeft]);

  const mmss = useMemo(() => {
    const m = String(Math.floor(timeLeft / 60)).padStart(1, "0");
    const s = String(timeLeft % 60).padStart(2, "0");
    return `${m}:${s}`;
  }, [timeLeft]);

  const resend = async () => {
    if (!pendingEmail) return;
    await resendMagicLink();
    setTimeLeft(DURATION);
  };

  return (
    <div className="check-email">
      <p className="auth-info">
        We sent a temporary email to <strong>{pendingEmail || "—"}</strong>.
        <br />
        Link expires in <strong>{mmss}</strong>.
      </p>

      <button
        className="auth-primary"
        type="button"
        onClick={closeAuth}
        disabled={authLoading}
      >
        I've already opened the link in the email.
      </button>

      {authError && <div className="auth-error">{authError}</div>}

      <div className="check-email-actions">
        <button
          type="button"
          className="auth-link"
          onClick={resend}
          disabled={timeLeft > 0 || authLoading}
          style={{ opacity: timeLeft > 0 ? 0.45 : 1 }}
        >
          Forward email
        </button>

  
      </div>
    </div>
  );
}

