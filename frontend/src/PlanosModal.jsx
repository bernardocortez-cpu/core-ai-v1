import { useState } from "react";
import "./PlanosModal.css";

export default function PlanosModal({ open, onClose, currentPlan }) {
  const [billing, setBilling] = useState("monthly");

  if (!open) return null;

  const normalizedCurrentPlan = normalizePlanId(currentPlan);
const prices = {
  monthly: {
    free: "€0",
    pro: "€19.99",
    premium: "€39,99",
    max: "€99,99",
  },
  yearly: {
    free: "€0",
    pro: "€15,99",
    premium: "€31,99",
    max: "€79,99",
  },
};

  return (
    <div
      className="planos-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="planos-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <button
  className="planos-close"
  onClick={(e) => {
    e.stopPropagation();
    onClose();
  }}
>
  ×
</button>
        <h2 className="planos-title">Upgrade your plan</h2>

<div className="planos-billing-toggle">
  <button
    className={billing === "monthly" ? "active" : ""}
    onClick={() => setBilling("monthly")}
  >
    Monthly
  </button>

  <button
    className={billing === "yearly" ? "active" : ""}
    onClick={() => setBilling("yearly")}
  >
    Yearly
  </button>
</div>


        <div className="planos-grid">
          <PlanoCard
          type="free"
          billing={billing}
  name="Free"
  price={prices[billing].free}
            desc="Get started free of charge"
            active={normalizedCurrentPlan === "free"}
            button={normalizedCurrentPlan === "free" ? "Current plan" : "Free"}
            disabled
            features={[
              "Limited messages",
              "Access to GPT-5 Mini and base models",
              "Limited file uploads",
              "No persistent memory",
            ]}
          />

          <PlanoCard
          type="pro"
          billing={billing}
  name="Pro"
  price={prices[billing].pro}
            desc="Advanced productivity"
            active={normalizedCurrentPlan === "pro"}
            button={normalizedCurrentPlan === "pro" ? "Current plan" : "Subscribe"}
            disabled={normalizedCurrentPlan === "pro"}
            features={[
              "Everything from Free and:",
              "Unlimited messages",
              "Access to all advanced models: Open AI GPT-5.4, Anthropic Claude 4.6 Opus e Google Gemini 3.1 Pro.",
              "Smart Router",
              "Extended file uploads",
              "Memory and context",
              "Web search + Reasoning",
              "Analyze PDFs, documents, images, etc.",
              "50 image generations per month",
              "Access to multiple creative models: Nano Banana 2, GPT Image 1.5, Ideogram 3.0 e Seedream 5",
            ]}
          />

          <PlanoCard
          type="premium"
          billing={billing}
  name="Premium"
  price={prices[billing].premium}
            desc="For creators and power users"
            active={normalizedCurrentPlan === "premium"}
            button={normalizedCurrentPlan === "premium" ? "Current plan" : "Subscribe"}
            disabled={normalizedCurrentPlan === "premium"}
            features={[
              "Everything from Pro and:",
              "Unlimited messages",
              "Access to all advanced models: Open AI GPT-5.4, Anthropic Claude 4.6 Opus e Google Gemini 3.1 Pro.",
              "Higher processing priority",
              "Advanced memory and context",
              "150 image generations per month",
              "Access to multiple creative models: Nano Banana 2, GPT Image 1.5, Ideogram 3.0 e Seedream 5",
              "Better quality and speed in Creative Studio.",
            ]}
          />

          <PlanoCard
          type="max"
          billing={billing}
  name="Max"
  price={prices[billing].max}
            desc="Intensive and professional use"
            active={normalizedCurrentPlan === "max"}
            button={normalizedCurrentPlan === "max" ? "Current plan" : "Subscribe"}
            disabled={normalizedCurrentPlan === "max"}
            features={[
              "Everything from Premium and:",
              "Intensive use of all models",
              "Intensive use of file uploads",
              " Highest priority",
              "Memory and context at their highest level.",
              "300 image generations per month",
              "Priority support",
              "Early access to beta features",
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function PlanoCard({
  type,
  name,
  price,
  billing,
  desc,
  features,
  button,
  active,
  disabled,
}) {
  const priceSuffix = type === "free" ? "" : " / month";

  return (
  <div className={`plano-card plano-${type} ${active ? "active" : ""}`}>
    <h3>{name}</h3>
    <div className="plano-price">
  {price}{priceSuffix}
</div>

{billing === "yearly" && type !== "free" && (
  <div className="plano-badge">Save 20%</div>
)}
    <p className="plano-desc">{desc}</p>

    <button className="plano-button" disabled={disabled}>
      {button}
    </button>

    <ul>
      {features.map((f, idx) => {
  // First line in paid plans is a "tier header" like:
  // - "Everything in Free, plus:"
  // - "Everything in Pro, plus:"
  // It should NOT have a check icon; it should use the sparkle icon + divider.
  const isTudo = idx === 0 && type !== "free";

  return (
    <div key={`${type}-${idx}-${f}`}>
      <li
        className={isTudo ? "plano-feature-tudo" : "plano-feature"}
      >
        <span className="plano-feature-text">{f}</span>
      </li>

      {isTudo && <div className="plano-divider" />}
    </div>
  );
})}
    </ul>
  </div>
);
}

function normalizePlanId(plan) {
  const raw = String(plan || "").trim();
  if (!raw) return "free";

  const s = raw.toLowerCase();
  if (s === "free") return "free";
  if (s === "pro") return "pro";
  // Backwards-compatible: some older rows use "plus" for what the UI calls "premium".
  if (s === "plus") return "premium";
  if (s === "premium") return "premium";
  if (s === "max") return "max";

  // Common variants from backend/db (e.g. "FREE", "MAX", "Max", etc).
  if (s.includes("free")) return "free";
  if (s.includes("premium")) return "premium";
  if (s.includes("plus")) return "premium";
  if (s.includes("max")) return "max";
  if (s.includes("pro")) return "pro";

  return "free";
}
