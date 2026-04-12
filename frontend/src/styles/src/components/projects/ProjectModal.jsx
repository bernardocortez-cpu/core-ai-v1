// frontend/src/components/projects/ProjectModal.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

export default function ProjectModal({ isOpen, onClose, onCreate }) {
  const [name, setName] = useState("");
  const inputRef = useRef(null);

  const suggestions = useMemo(
    () => ["Investimento", "Trabalhos de casa", "Escrita", "Saúde", "Viagens"],
    []
  );

  const canCreate = name.trim().length > 0;

  useEffect(() => {
    if (!isOpen) return;
    setName("");
    const t = setTimeout(() => {
      inputRef.current?.focus?.();
      inputRef.current?.select?.();
    }, 0);
    return () => clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canCreate) {
        handleCreate();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, canCreate, name]);

  if (!isOpen) return null;

  const handleBackdropMouseDown = (e) => {
    // fecha só se clicar no backdrop (não no conteúdo)
    if (e.target === e.currentTarget) onClose?.();
  };

  const handleCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const project = {
      id: crypto.randomUUID(),
      name: trimmed,
      chats: [],
      activeChatId: null,
    };

    onCreate?.(project);
    onClose?.();
  };

  const FolderIcon = ({ className = "" }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      className={className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 0 0-1.883 2.542l.857 6a2.25 2.25 0 0 0 2.227 1.932H19.05a2.25 2.25 0 0 0 2.227-1.932l.857-6a2.25 2.25 0 0 0-1.883-2.542m-16.5 0V6A2.25 2.25 0 0 1 6 3.75h3.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 0 1.06.44H18A2.25 2.25 0 0 1 20.25 9v.776"
      />
    </svg>
  );

  return (
    <div
      onMouseDown={handleBackdropMouseDown}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      aria-modal="true"
      role="dialog"
    >
      <div
        style={{
          width: "min(640px, 96vw)",
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "rgba(22,22,22,0.92)",
          boxShadow:
            "0 20px 60px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.03) inset",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <FolderIcon className="size-6" />
            <div style={{ fontSize: 15, fontWeight: 600, color: "#EDEDED" }}>
              Criar projeto
            </div>
          </div>

          <button
            onClick={onClose}
            type="button"
            aria-label="Fechar"
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.85)",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.8}
              stroke="currentColor"
              style={{ width: 18, height: 18 }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 16 }}>
          <div
            style={{
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
              padding: 12,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <FolderIcon className="size-6" />
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do projeto"
              style={{
                width: "100%",
                border: "none",
                outline: "none",
                background: "transparent",
                color: "#F1F1F1",
                fontSize: 14,
              }}
            />
          </div>

          {/* Chips */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 12,
            }}
          >
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setName(s)}
                style={{
                  borderRadius: 999,
                  padding: "7px 10px",
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.86)",
                  fontSize: 12.5,
                  cursor: "pointer",
                }}
                onMouseDown={(e) => e.preventDefault()} // evita perder foco e seleção estranha
              >
                {s}
              </button>
            ))}
          </div>

          {/* Helper text */}
          <div
            style={{
              marginTop: 12,
              fontSize: 12.5,
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1.35,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              padding: 12,
            }}
          >
            Os projetos mantêm os chats, ficheiros e instruções personalizadas num
            só local para manter tudo organizado.
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: 16,
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
            borderTop: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              borderRadius: 12,
              padding: "10px 12px",
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.88)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleCreate}
            disabled={!canCreate}
            style={{
              borderRadius: 12,
              padding: "10px 14px",
              border: "1px solid rgba(255,255,255,0.10)",
              background: canCreate ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)",
              color: canCreate ? "#FFFFFF" : "rgba(255,255,255,0.45)",
              fontSize: 13,
              cursor: canCreate ? "pointer" : "not-allowed",
              opacity: canCreate ? 1 : 0.9,
            }}
          >
            Criar projeto
          </button>
        </div>
      </div>
    </div>
  );
}
