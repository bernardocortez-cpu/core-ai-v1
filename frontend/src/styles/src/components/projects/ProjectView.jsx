// frontend/src/components/projects/ProjectView.jsx
import React, { useMemo, useState } from "react";

export default function ProjectView({ project, setProjects, onExitProject }) {
  const [draft, setDraft] = useState("");

  const activeChat = useMemo(() => {
    if (!project) return null;
    return project.chats.find((c) => c.id === project.activeChatId) || null;
  }, [project]);

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

  const ChatBubbleIcon = ({ style }) => (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      style={{ width: 18, height: 18, ...style }}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 9.75h6.75m-6.75 3h4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );

  if (!project) return null;

  const setActiveChatId = (chatId) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === project.id ? { ...p, activeChatId: chatId } : p))
    );
  };

  const handleNewChat = () => {
    const chatId = crypto.randomUUID();
    const newChat = { id: chatId, title: "Novo chat", messages: [] };

    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== project.id) return p;
        return {
          ...p,
          chats: [newChat, ...(p.chats || [])],
          activeChatId: chatId,
        };
      })
    );
  };

  const handleSendPlaceholder = () => {
    const text = draft.trim();
    if (!text || !activeChat) return;

    setProjects((prev) =>
      prev.map((p) => {
        if (p.id !== project.id) return p;

        const chats = (p.chats || []).map((c) => {
          if (c.id !== p.activeChatId) return c;
          return {
            ...c,
            title: c.title === "Novo chat" ? text.slice(0, 28) : c.title,
            messages: [
              ...(c.messages || []),
              { role: "user", content: text },
              {
                role: "assistant",
                content:
                  "Placeholder do chat do projeto — aqui vais reutilizar a UI e lógica do chat normal.",
              },
            ],
          };
        });

        return { ...p, chats };
      })
    );

    setDraft("");
  };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top area (como no ChatGPT dentro do projeto) */}
      <div
        style={{
          padding: "22px 22px 10px 22px",
          maxWidth: 920,
          width: "100%",
          margin: "0 auto",
        }}
      >
        {/* Header do projeto */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <FolderIcon className="size-6" />
          <div
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "rgba(255,255,255,0.92)",
              letterSpacing: 0.2,
            }}
          >
            {project.name}
          </div>

          {onExitProject && (
            <button
              type="button"
              onClick={onExitProject}
              style={{
                marginLeft: "auto",
                borderRadius: 999,
                padding: "8px 10px",
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.85)",
                fontSize: 12.5,
                cursor: "pointer",
              }}
              title="Sair do projeto"
            >
              Sair
            </button>
          )}
        </div>

        {/* Pill “Novo chat em {Projeto}” */}
        <button
          type="button"
          onClick={handleNewChat}
          style={{
            marginTop: 14,
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderRadius: 999,
            padding: "12px 14px",
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.04)",
            color: "rgba(255,255,255,0.88)",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(0,0,0,0.15)",
              flex: "0 0 auto",
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.7}
              stroke="currentColor"
              style={{ width: 16, height: 16 }}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4.5v15m7.5-7.5h-15"
              />
            </svg>
          </span>

          <span style={{ fontSize: 13.5, opacity: 0.9 }}>
            Novo chat em {project.name}
          </span>
        </button>

        {/* Lista de chats do projeto (NO CENTRO) */}
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: 0.2,
              color: "rgba(255,255,255,0.55)",
              marginBottom: 8,
            }}
          >
            Chats do projeto
          </div>

          {project.chats?.length ? (
            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.02)",
                overflow: "hidden",
              }}
            >
              {project.chats.map((c) => {
                const isActive = c.id === project.activeChatId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setActiveChatId(c.id)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "12px 14px",
                      border: "none",
                      background: isActive
                        ? "rgba(255,255,255,0.06)"
                        : "transparent",
                      color: "rgba(255,255,255,0.9)",
                      cursor: "pointer",
                      textAlign: "left",
                      borderTop: "1px solid rgba(255,255,255,0.06)",
                    }}
                  >
                    <ChatBubbleIcon
                      style={{
                        opacity: isActive ? 0.95 : 0.75,
                        flex: "0 0 auto",
                      }}
                    />
                    <div
                      style={{
                        fontSize: 13.5,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        opacity: isActive ? 1 : 0.88,
                      }}
                    >
                      {c.title || "Novo chat"}
                    </div>

                    <div style={{ marginLeft: "auto", opacity: 0.55, fontSize: 12 }}>
                      {(c.messages?.length || 0) > 0 ? `${c.messages.length} msgs` : ""}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.02)",
                padding: 14,
                color: "rgba(255,255,255,0.65)",
                fontSize: 13,
              }}
            >
              Ainda não tens chats neste projeto. Cria um com{" "}
              <span style={{ color: "rgba(255,255,255,0.88)" }}>
                Novo chat em {project.name}
              </span>
              .
            </div>
          )}
        </div>
      </div>

      {/* Placeholder do chat do projeto (estrutura pronta p/ reutilizar a UI do chat normal) */}
      <div
        style={{
          flex: 1,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          maxWidth: 920,
          margin: "0 auto",
          padding: "0 22px 18px 22px",
        }}
      >
        {activeChat ? (
          <>
            <div
              style={{
                flex: 1,
                overflow: "auto",
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(0,0,0,0.12)",
                padding: 14,
              }}
            >
              {activeChat.messages?.length ? (
                activeChat.messages.map((m, idx) => (
                  <div
                    key={idx}
                    style={{
                      marginBottom: 12,
                      display: "flex",
                      justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                    }}
                  >
                    <div
                      style={{
                        maxWidth: "78%",
                        padding: "10px 12px",
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background:
                          m.role === "user"
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(255,255,255,0.04)",
                        color: "rgba(255,255,255,0.92)",
                        fontSize: 13.5,
                        lineHeight: 1.35,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {m.content}
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: 13 }}>
                  Este é o chat do projeto. Aqui vais reutilizar a mesma UI do chat
                  normal (mensagens + composer), mas lendo/escrevendo em{" "}
                  <span style={{ color: "rgba(255,255,255,0.85)" }}>
                    project.chats[activeChatId]
                  </span>
                  .
                </div>
              )}
            </div>

            <div
              style={{
                marginTop: 12,
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.03)",
                padding: 10,
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Pergunte qualquer coisa"
                style={{
                  width: "100%",
                  border: "none",
                  outline: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.92)",
                  fontSize: 13.5,
                  padding: "8px 6px",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendPlaceholder();
                  }
                }}
              />

              <button
                type="button"
                onClick={handleSendPlaceholder}
                disabled={!draft.trim()}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: draft.trim()
                    ? "rgba(255,255,255,0.12)"
                    : "rgba(255,255,255,0.05)",
                  color: draft.trim() ? "#fff" : "rgba(255,255,255,0.45)",
                  display: "grid",
                  placeItems: "center",
                  cursor: draft.trim() ? "pointer" : "not-allowed",
                  flex: "0 0 auto",
                }}
                aria-label="Enviar"
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
                    d="M6 12l14-8-6 16-2.5-6L6 12z"
                  />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div
            style={{
              marginTop: 14,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
              padding: 16,
              color: "rgba(255,255,255,0.65)",
              fontSize: 13,
            }}
          >
            Seleciona um chat do projeto ou cria um novo com{" "}
            <span style={{ color: "rgba(255,255,255,0.88)" }}>
              Novo chat em {project.name}
            </span>
            .
          </div>
        )}
      </div>
    </div>
  );
}
