import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

export default function ProjectModal({ isOpen, onClose, onSubmit, project = null }) {
  const [name, setName] = useState(() => project?.name || "");
  const [brief, setBrief] = useState(() => project?.brief || "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef(null);
  const isEditing = Boolean(project);
  const shouldAutoFocusFields =
    typeof window === "undefined" ? true : window.innerWidth > 1024;

  const canSubmit = name.trim().length > 0 && !isSubmitting;

  useEffect(() => {
    if (!isOpen || !shouldAutoFocusFields) return undefined;

    const timeoutId = window.setTimeout(() => {
      inputRef.current?.focus?.();
      inputRef.current?.select?.();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isOpen, shouldAutoFocusFields]);

  useEffect(() => {
    if (!isOpen) return undefined;

    async function handleKeyDown(event) {
      if (event.key === "Escape" && !isSubmitting) onClose?.();

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) {
        event.preventDefault();
        const trimmedName = name.trim();
        const trimmedBrief = brief.trim();

        if (!trimmedName) return;

        try {
          setIsSubmitting(true);
          await onSubmit?.({
            name: trimmedName,
            brief: trimmedBrief,
          });
          onClose?.();
        } finally {
          setIsSubmitting(false);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, canSubmit, name, brief, isSubmitting, onSubmit, onClose]);

  if (!isOpen) return null;

  function handleBackdropMouseDown(event) {
    if (isSubmitting) return;
    if (event.target === event.currentTarget) onClose?.();
  }

  async function handleSubmit() {
    const trimmedName = name.trim();
    const trimmedBrief = brief.trim();

    if (!trimmedName) return;

    try {
      setIsSubmitting(true);
      await onSubmit?.({
        name: trimmedName,
        brief: trimmedBrief,
      });
      onClose?.();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="projects-modal-overlay"
      onMouseDown={handleBackdropMouseDown}
      aria-modal="true"
      role="dialog"
    >
      <div className="projects-modal">
        <div className="projects-modal__header">
          <div className="projects-modal__heading">
            <h2 className="projects-modal__title">{isEditing ? "Edit Project" : "Create Project"}</h2>
            <p className="projects-modal__copy">
              {isEditing
                ? "Update the name and description."
                : "Add a name and an optional description."}
            </p>
          </div>

          <button
            type="button"
            className="projects-modal__close"
            onClick={onClose}
            aria-label="Close"
            disabled={isSubmitting}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="projects-modal__body">
          <label className="projects-modal__field">
            <span>Project name</span>
            <input
              ref={inputRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex. Core Design System"
              disabled={isSubmitting}
            />
          </label>

          <label className="projects-modal__field">
            <span>Description</span>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Describe the main goal, topic, or deliverable for this project."
              rows={4}
              disabled={isSubmitting}
            />
          </label>
        </div>

        <div className="projects-modal__footer">
          <button
            type="button"
            className="projects-modal__button ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>

          <button
            type="button"
            className="projects-modal__button solid"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {!isEditing ? <Plus size={16} aria-hidden="true" /> : null}
            <span>
              {isSubmitting ? (isEditing ? "Saving..." : "Creating...") : isEditing ? "Save" : "Create project"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
