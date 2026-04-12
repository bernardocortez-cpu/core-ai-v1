import "./TopTabs.css";

export default function TopTabs({ active, setActive }) {
  const tabs = ["Chat", "Projects", "Studio", "Library", "Settings"];

  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t}
          className={`tab ${active === t ? "active" : ""}`}
          onClick={() => setActive(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
