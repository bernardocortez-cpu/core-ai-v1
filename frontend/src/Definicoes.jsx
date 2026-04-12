import { useEffect, useRef, useState } from "react";
import "./Definicoes.css";
import { api } from "./services/api";
import { useAuth } from "./auth/AuthContext";

const LANGUAGE_OPTIONS = [
  { value: "en", label: "English", enabled: true },
  { value: "pt", label: "Português", enabled: false },
  { value: "es", label: "Español", enabled: false },
  { value: "fr", label: "Français", enabled: false },
];

export default function Definicoes({
  open,
  onClose,
  theme,
  setTheme,
  language,
  setLanguage,
  onOpenPlan,
}) {
  const { logout } = useAuth();
  const [langOpen, setLangOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const langRef = useRef(null);

  useEffect(() => {
    function onMouseDown(e) {
      if (!langRef.current) return;
      if (!langRef.current.contains(e.target)) setLangOpen(false);
    }

    function onKeyDown(e) {
      if (e.key === "Escape") setLangOpen(false);
    }

    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!open) setLangOpen(false);
  }, [open]);

  useEffect(() => {
    if (language !== "en") {
      setLanguage("en");
      try {
        localStorage.setItem("language", "en");
      } catch {
        // ignore storage errors
      }
    }
  }, [language, setLanguage]);

  if (!open) return null;

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="settings-body">
          <div className="settings-section">
            <div className="settings-label">Theme</div>
            <div className="settings-options">
              {["system", "dark", "light"].map((t) => (
                <button
                  key={t}
                  className={`settings-option ${theme === t ? "active" : ""}`}
                  onClick={() => setTheme(t)}
                >
                  {t === "system" ? "System" : t === "dark" ? "Dark" : "Light"}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-label">Language</div>
            <div className="settings-dropdown" ref={langRef}>
              <button
                type="button"
                className="settings-select"
                onClick={() => setLangOpen((v) => !v)}
                aria-haspopup="listbox"
                aria-expanded={langOpen}
              >
                <span className="settings-select-text">English</span>

                <span
                  className={`settings-caret ${langOpen ? "open" : ""}`}
                  aria-hidden="true"
                >
                  ▾
                </span>
              </button>

              {langOpen && (
                <div className="settings-menu" role="listbox">
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={language === opt.value}
                      aria-disabled={!opt.enabled}
                      className={`settings-menu-item ${
                        language === opt.value ? "selected" : ""
                      } ${!opt.enabled ? "disabled" : ""}`}
                      disabled={!opt.enabled}
                      onClick={() => {
                        if (!opt.enabled) return;
                        setLanguage(opt.value);
                        localStorage.setItem("language", opt.value);
                        setLangOpen(false);
                      }}
                    >
                      <span>{opt.label}</span>
                      <span className="settings-menu-meta">
                        {!opt.enabled && (
                          <span className="settings-soon-badge">Soon</span>
                        )}
                        {language === opt.value && (
                          <span className="settings-check" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="settings-section">
            <div className="settings-label">Plan</div>
            <button
              className="settings-link"
              onClick={() => {
                onClose();
                onOpenPlan();
              }}
            >
              Manage plan
            </button>
          </div>

          <div className="settings-section">
            <div className="settings-label">Account</div>
            <button
              className="settings-link settings-link-danger"
              onClick={() => {
                setDeleteError("");
                setDeleteLoading(false);
                setDeleteOpen(true);
              }}
            >
              Delete account
            </button>

            {deleteOpen && (
              <div
                className="delete-backdrop"
                onClick={() => {
                  if (!deleteLoading) setDeleteOpen(false);
                }}
              >
                <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
                  <div className="delete-icon">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="delete-icon-svg"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                      />
                    </svg>
                  </div>

                  <h3 className="delete-title">Delete your account?</h3>

                  <p className="delete-text">
                    This action will permanently delete your account and all your data. It
                    will not be possible to restore it.
                  </p>

                  {deleteError && (
                    <p className="delete-error" role="alert">
                      {deleteError}
                    </p>
                  )}

                  <button
                    className="delete-keep"
                    onClick={() => setDeleteOpen(false)}
                    disabled={deleteLoading}
                  >
                    Maintain account
                  </button>

                  <button
                    className="delete-confirm"
                    disabled={deleteLoading}
                    onClick={async () => {
                      if (deleteLoading) return;
                      setDeleteError("");
                      setDeleteLoading(true);
                      try {
                        await api.delete("/auth/me");
                        setDeleteOpen(false);
                        onClose();
                        logout();
                      } catch (e) {
                        const msg =
                          e?.details?.message ||
                          e?.details?.error ||
                          e?.message ||
                          "Failed to delete account.";
                        setDeleteError(String(msg));
                      } finally {
                        setDeleteLoading(false);
                      }
                    }}
                  >
                    {deleteLoading ? "Deleting..." : "Delete account"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
