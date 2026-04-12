import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import coreLogo from "./assets/coreai-logo.svg";
import "./LegalPage.css";

export default function LegalPage({ kind }) {
  const navigate = useNavigate();

  const { title, body } = useMemo(() => {
    const k = String(kind || "").toLowerCase();
    if (k === "privacy") {
      return {
        title: "Privacy Policy",
        body:
          "This page is coming soon.\n\nIf you have any questions, contact support.",
      };
    }
    return {
      title: "Terms of Service",
      body: "This page is coming soon.\n\nIf you have any questions, contact support.",
    };
  }, [kind]);

  return (
    <div className="legal-page">
      <div className="legal-card">
        <div className="legal-top">
          <button type="button" className="legal-back" onClick={() => navigate(-1)}>
            Back
          </button>
          <img className="legal-logo" src={coreLogo} alt="" aria-hidden="true" />
        </div>

        <h1 className="legal-title">{title}</h1>
        <pre className="legal-body">{body}</pre>

        <button type="button" className="legal-home" onClick={() => navigate("/")}>
          Go to chat
        </button>
      </div>
    </div>
  );
}

