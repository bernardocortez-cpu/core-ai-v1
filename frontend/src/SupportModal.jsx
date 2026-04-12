import "./SupportModal.css";

export default function SupportModal({
  open,
  onClose,
  userDisplayName,
  message,
  setMessage,
  files,
  onPickFiles,
  onFilesSelected,
  onRemoveFile,
  fileInputRef,
  onSubmit,
  submitting,
  formatBytes,
  autoFocus = true,
}) {
  if (!open) return null;
  const canSubmit = !submitting && String(message || "").trim().length > 0;

  return (
    <div className="support-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="support-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="support-modal-top">
          <button type="button" className="support-modal-close" onClick={onClose} aria-label="Close support">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <h2 className="support-modal-title">Hi {userDisplayName}, how can we help you?</h2>
        </div>

        <div className="support-modal-body">
          <textarea
            className="support-modal-textarea"
            placeholder="Tell us about your thoughts"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSubmit) onSubmit();
              }
            }}
            autoFocus={autoFocus}
            rows={6}
          />

          <div className="support-toolbar">
            <button type="button" className="support-toolbar-btn" onClick={onPickFiles} aria-label="Attach files">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M21.44 11.05l-8.49 8.49a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.5 3.5 0 0 1 4.95 4.95l-9.2 9.19a1.5 1.5 0 1 1-2.12-2.12l8.49-8.49"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Add files</span>
            </button>
          </div>

          {files.length > 0 && (
            <div className="support-files-inline" aria-label="Attached files">
              {files.map((file, index) => (
                <div key={`${file.name}-${file.size}-${index}`} className="support-file-pill">
                  <div className="support-file-pill-main">
                    <span className="support-file-pill-name">{file.name}</span>
                    <span className="support-file-pill-meta">{formatBytes(file.size)}</span>
                  </div>
                  <button
                    type="button"
                    className="support-file-pill-remove"
                    onClick={() => onRemoveFile(index)}
                    aria-label={`Remove ${file.name}`}
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            className="support-submit"
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {submitting ? "Sending..." : "Submit Feedback"}
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          className="support-file-input"
          multiple
          accept="image/*,.txt,.log,.json,.csv,.pdf,.doc,.docx,.zip"
          onChange={(e) => onFilesSelected(e.target.files)}
        />
      </div>
    </div>
  );
}
