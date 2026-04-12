export default function ComposerFileDropOverlay({
  title = "Drop files here",
  subtitle = "They'll be attached to your next message.",
}) {
  return (
    <div className="composer-drop-overlay" aria-hidden="true">
      <div className="composer-drop-overlay__icon">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 4v9m0 0 3.5-3.5M12 13 8.5 9.5M5 15.5v.5A2 2 0 0 0 7 18h10a2 2 0 0 0 2-2v-.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="composer-drop-overlay__text">
        <div className="composer-drop-overlay__title">{title}</div>
        <div className="composer-drop-overlay__subtitle">{subtitle}</div>
      </div>
    </div>
  );
}
