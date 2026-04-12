// frontend/src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { Routes, Route, useParams } from "react-router-dom";
import coreLogo from "./assets/coreai-logo.png";
import { Pin } from "lucide-react";

const MODELS = [
  {
    id: "__best__",
    name: "Melhor · Automático",
    provider: "core",
    logo: "/models/IMG_2018-removebg-preview.png",
  },
  { id: "gpt-5.2 pro", name: "GPT-5.2 Pro", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.2", name: "GPT-5.2", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.1 instant", name: "GPT-5.1 Instant", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.1 thinking", name: "GPT-5.1 Thinking", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5", name: "GPT-5", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-4o", name: "GPT-4o", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-4.1 mini", name: "GPT-4.1 Mini", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-4o mini", name: "GPT-4o mini", provider: "openai", logo: "/models/openai.svg" },
  { id: "claude-opus-3.5", name: "Claude Opus 4.5", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-opus-4", name: "Claude Opus 4", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-sonnet-4", name: "Claude Sonnet 4", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-3.5 haiku", name: "Claude 3.5 Haiku", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "gemini-3 pro", name: "Gemini 3 Pro", provider: "google", logo: "/models/google.svg" },
  { id: "gemini-2.5 flash", name: "Gemini 2.5 Flash", provider: "google", logo: "/models/google.svg" },
  { id: "gemini-2.5 pro", name: "Gemini 2.5 Pro", provider: "google", logo: "/models/google.svg" },
  { id: "grok-4", name: "Grok 4", provider: "grok", logo: "/models/grok.svg" },
  { id: "grok-3 mini", name: "Grok 3 Mini", provider: "grok", logo: "/models/grok.svg" },
  { id: "grok-3 mini fast", name: "Grok 3 Mini Fast", provider: "grok", logo: "/models/grok.svg" },
  { id: "deepseek-v3.2-exp", name: "DeepSeek V3.2-Exp", provider: "deepseek", logo: "/models/deepseek.svg" },
  { id: "deepseek-v3.1", name: "DeepSeek V3.1", provider: "deepseek", logo: "/models/deepseek.svg" },
  { id: "deepseek-v3", name: "DeepSeek V3", provider: "deepseek", logo: "/models/deepseek.svg" },
  { id: "deepseek-r1", name: "DeepSeek R1", provider: "deepseek", logo: "/models/deepseek.svg" },
  { id: "qwen", name: "Qwen", provider: "qwen", logo: "/models/qwen.svg" },
  { id: "perplexity-sonar", name: "Perplexity Sonar", provider: "perplexity", logo: "/models/perplexity.svg" },
  { id: "llama-4 maverick", name: "Llama 4 Maverick", provider: "meta", logo: "/models/meta.svg" },
  { id: "llama-4 scout", name: "Llama 4 Scout", provider: "meta", logo: "/models/meta.svg" },
  { id: "mistral-medium 3", name: "Mistral Medium 3", provider: "mistral", logo: "/models/mistral.svg" },
  { id: "mistral-8b", name: "Mistral 8B", provider: "mistral", logo: "/models/mistral.svg" },
];

const createEmptyConversation = () => ({
  id: Date.now() + Math.random(),
  title: "Novo chat",
  messages: [],
  pinned: false,
  pinnedAt: 0,
});

const generateTitleFromMessage = (text) => {
  let t = (text || "").trim();
  if (!t) return "Novo chat";
  if (t.length > 44) t = t.slice(0, 44) + "…";
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function App() {
  // ===== Icons (ChatGPT-like, stroke) =====
const IconCopy = ({ className = "" }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    width="18"
    height="18"
    strokeWidth={1.5}
    stroke="currentColor"
    className={className}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M16.5 8.25V6a2.25 2.25 0 0 0-2.25-2.25H6A2.25 2.25 0 0 0 3.75 6v8.25A2.25 2.25 0 0 0 6 16.5h2.25m8.25-8.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-7.5A2.25 2.25 0 0 1 8.25 18v-1.5m8.25-8.25h-6a2.25 2.25 0 0 0-2.25 2.25v6"
    />
  </svg>
);

  const IconEdit = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
      <path d="M12 20h9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  const IconThumbUp = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
      <path d="M7 11v10H4V11h3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M7 11l5-7a2 2 0 0 1 2 2v5h6a2 2 0 0 1 2 2l-2 6a2 2 0 0 1-2 2H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  const IconThumbDown = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
      <path d="M7 13V3H4v10h3z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path
        d="M7 13l5 7a2 2 0 0 0 2-2v-5h6a2 2 0 0 0 2-2l-2-6a2 2 0 0 0-2-2H7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );

  const IconShare = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
      <path
        d="M12 5V3l7 7-7 7v-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <path
        d="M19 10H10a6 6 0 0 0-6 6v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );

  const IconRetry = (p) => (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" {...p}>
      <path
        d="M20 12a8 8 0 1 1-2.3-5.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 4v6h-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

const handleTogglePinChat = (id) => {
  setConversations((prev) =>
    prev.map((c) => {
      if (c.id !== id) return c;

      const nextPinned = !c.pinned;
      return {
        ...c,
        pinned: nextPinned,
        pinnedAt: nextPinned ? Date.now() : 0,
      };
    })
  );
};

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Secção ativa (para páginas futuras)
  const [activeSection, setActiveSection] = useState("chat");
const [searchOpen, setSearchOpen] = useState(false);
const [searchQuery, setSearchQuery] = useState("");

  // 🔮 Modelo ativo
  const [activeModel, setActiveModel] = useState("gpt-5");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");

  // Conversas (localStorage)
  const [conversations, setConversations] = useState(() => {
    try {
      const stored = localStorage.getItem("coreai_conversations");
      if (stored) {
  const parsed = JSON.parse(stored);
  if (Array.isArray(parsed) && parsed.length > 0) {
    return parsed.map((c) => ({
      ...c,
      pinned: !!c.pinned,
      pinnedAt: typeof c.pinnedAt === "number" ? c.pinnedAt : 0,
    }));
  }
}
    } catch (e) {
      console.error("Erro a ler conversas:", e);
    }
    return [createEmptyConversation()];
  });

  const [activeId, setActiveId] = useState(() => conversations[0]?.id ?? null);
// 🔽 botão "scroll para o fundo"
const [showScrollDown, setShowScrollDown] = useState(false);
  // Input + loading
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
    // 📎 Attachments
  const [attachments, setAttachments] = useState([]); // [{ id, file, name, size, type, isImage, previewUrl }]
  const fileInputRef = useRef(null);
  // 🔘 Toggles do composer
const [webSearchEnabled, setWebSearchEnabled] = useState(false);
const [reasoningEnabled, setReasoningEnabled] = useState(false);

  // ===== Feedback UI (toast + likes/dislikes) =====
  const [msgRatings, setMsgRatings] = useState({}); // { [key]: "up" | "down" }
// ✅ Toast global (tipo ChatbotAI) — canto inferior direito
const [globalToast, setGlobalToast] = useState(null); // { text }
const toastTimerRef = useRef(null);

const showGlobalToast = (text) => {
  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);

  setGlobalToast({ text });

  toastTimerRef.current = setTimeout(() => {
    setGlobalToast(null);
    toastTimerRef.current = null;
  }, 2000);
};

useEffect(() => {
  return () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  };
}, []);

  // ===== Share UI (modal) =====
  const [shareData, setShareData] = useState(null); // { id, url, messages }

  const getMsgKey = (i) => `${activeId}-${i}`;


  // Menu “…” (renomear/apagar)
  const [openMenuId, setOpenMenuId] = useState(null);

  // Refs
  const chatBodyRef = useRef(null);
  const textareaRef = useRef(null);
  const modelSelectorRef = useRef(null);
const suppressScrollBtnRef = useRef(false);

// ✅ força o textarea a crescer/recalcular altura (mesmo quando o input muda via setInput)
const autoResizeTextarea = () => {
  const el = textareaRef.current;
  if (!el) return;

  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
};

  const scrollToBottom = (behavior = "auto") => {
    const updateScrollDownVisibility = () => {
  const el = chatBodyRef.current;
  if (!el) return;

  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

  // ✅ só aparece depois de subires "um bocado"
  setShowScrollDown(distanceFromBottom > 700);
};
    const el = chatBodyRef.current;
    if (!el) return;

    el.scrollTop = el.scrollHeight;

    requestAnimationFrame(() => {
      el.scrollTo({
        top: el.scrollHeight,
        behavior,
      });
    });
  };

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId),
    [conversations, activeId]
  );
// ✅ conversas ordenadas: afixadas em cima (mais recentes primeiro), resto mantém ordem original
const orderedConversations = useMemo(() => {
  return conversations
    .map((c, idx) => ({ ...c, __idx: idx }))
    .sort((a, b) => {
      const ap = !!a.pinned;
      const bp = !!b.pinned;

      // pinned primeiro
      if (ap && !bp) return -1;
      if (!ap && bp) return 1;

      // ambos pinned: mais recente em cima
      if (ap && bp) return (b.pinnedAt || 0) - (a.pinnedAt || 0);

      // nenhum pinned: mantém ordem original
      return a.__idx - b.__idx;
    })
    .map(({ __idx, ...c }) => c);
}, [conversations]);

  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return MODELS;
    return MODELS.filter((m) => m.name.toLowerCase().includes(q));
  }, [modelQuery]);
  // Persist
  useEffect(() => {
    try {
      localStorage.setItem("coreai_conversations", JSON.stringify(conversations));
    } catch (e) {
      console.error("Erro a guardar conversas:", e);
    }
  }, [conversations]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (modelMenuOpen && modelSelectorRef.current && !modelSelectorRef.current.contains(e.target)) {
        setModelMenuOpen(false);
        setModelQuery("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [modelMenuOpen]);
useEffect(() => {
  const el = chatBodyRef.current;
  if (!el) return;

  const onScroll = () => {
  if (suppressScrollBtnRef.current) return; // 🔥 sem updates durante open

  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  setShowScrollDown(distanceFromBottom > 700);
};

  el.addEventListener("scroll", onScroll, { passive: true });

  // estado inicial
  setShowScrollDown(false);

  return () => el.removeEventListener("scroll", onScroll);
}, [activeConversation?.messages?.length, loading]);
// ✅ quando o input muda por setInput (ex.: botão Editar), recalcula a altura automaticamente
useEffect(() => {
  requestAnimationFrame(() => {
    autoResizeTextarea();
  });
}, [input]);
// ✅ quando mudas de conversa, abre SEMPRE no fundo (tipo ChatGPT)
useEffect(() => {
  const el = chatBodyRef.current;
  if (!el) return;

  suppressScrollBtnRef.current = true; // 🔥 bloqueia
  setShowScrollDown(false);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollToBottom("auto");
      setShowScrollDown(false);

      // liberta depois do scroll inicial estar feito
      requestAnimationFrame(() => {
        suppressScrollBtnRef.current = false;
      });
    });
  });
}, [activeId]);
  // Handlers
  const handleNewChat = () => {
    const newConv = createEmptyConversation();
    setConversations((prev) => [newConv, ...prev]);
    setActiveId(newConv.id);
    setInput("");
    setOpenMenuId(null);
    setActiveSection("chat");
  };

  const handleRenameChat = (id) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;

    const newTitle = window.prompt("Novo nome para este chat:", conv.title);
    if (!newTitle || !newTitle.trim()) return;

    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: newTitle.trim() } : c)));
  };


  const handleDeleteChat = (id) => {
    const ok = window.confirm("Tens a certeza que queres apagar este chat?");
    if (!ok) return;

    setConversations((prev) => {
      const filtered = prev.filter((c) => c.id !== id);

      if (filtered.length === 0) {
        const fresh = createEmptyConversation();
        setActiveId(fresh.id);
        return [fresh];
      }

      if (id === activeId) setActiveId(filtered[0].id);
      return filtered;
    });

    setOpenMenuId(null);
  };

  // ✅ HANDLE SHARE (fora do handleSend) — modal tipo Genie
  const handleShare = (messages) => {
    const shareId =
      (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 10));

    const payload = {
      createdAt: Date.now(),
      messages,
    };

    localStorage.setItem(`coreai_share_${shareId}`, JSON.stringify(payload));

    const url = `${window.location.origin}/s/${shareId}`;

    setShareData({ id: shareId, url, messages });
  };
  const formatBytes = (bytes) => {
    if (!bytes && bytes !== 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let v = bytes;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    setAttachments((prev) => {
      const remaining = 10 - prev.length;
      const slice = incoming.slice(0, Math.max(0, remaining));

      const mapped = slice.map((file) => {
        const isImage = file.type?.startsWith("image/");
        const previewUrl = isImage ? URL.createObjectURL(file) : null;

        return {
          id: (typeof crypto !== "undefined" && crypto.randomUUID)
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random()}`,
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          isImage,
          previewUrl,
        };
      });

      return [...prev, ...mapped];
    });

    // permitir re-selecionar o mesmo ficheiro
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (id) => {
    setAttachments((prev) => {
      const item = prev.find((x) => x.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  const clearAttachments = () => {
    setAttachments((prev) => {
      prev.forEach((x) => {
        if (x.previewUrl) URL.revokeObjectURL(x.previewUrl);
      });
      return [];
    });
  };
  const handleSend = async (customText) => {
        const text = (customText ?? input).trim();
    if (( !text && attachments.length === 0 ) || loading || !activeConversation) return;

    const currentId = activeId;
    const sentAttachments = attachments; // ✅ snapshot para enviar

    // reset composer
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setLoading(true);
    setOpenMenuId(null);

    // 1) push user msg + title
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id !== currentId) return conv;

        const userCount = conv.messages.filter((m) => m.role === "user").length;
        const newTitle = userCount === 0 ? generateTitleFromMessage(text) : conv.title;

        return {
          ...conv,
          title: newTitle,
          messages: [
  ...conv.messages,
  {
    role: "user",
    content: text,
    attachments: sentAttachments.map((a) => ({
  id: a.id,
  name: a.name,
  size: a.size,
  type: a.type,
  isImage: a.isImage,
  previewUrl: a.previewUrl, // só para UI local
})),
  },
],
        };
      })
    );
    // ✅ limpa anexos do composer APÓS enviar (sem revogar previewUrl)
setAttachments([]);
if (fileInputRef.current) fileInputRef.current.value = "";
// ⬇️ auto-scroll APENAS quando o utilizador envia mensagem
setTimeout(() => {
  scrollToBottom("smooth");
}, 0);

    // 2) (placeholder) resposta fake — troca depois pelo teu backend/router
    try {
      await new Promise((r) => setTimeout(r, 350));
      const reply =
        "Estou pronto. Liga aqui o teu router multi-modelo (GPT/Claude/Gemini) e eu passo a responder com o modelo certo.";

      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== currentId) return conv;
          return {
            ...conv,
            messages: [...conv.messages, { role: "assistant", content: reply }],
          };
        })
      );
    } catch (e) {
      setConversations((prev) =>
        prev.map((conv) => {
          if (conv.id !== currentId) return conv;
          return {
            ...conv,
            messages: [...conv.messages, { role: "assistant", content: "⚠️ Erro ao gerar resposta." }],
          };
        })
      );
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    handleSend();
  };

  const hasMessages = !!activeConversation && activeConversation.messages.length > 0;

  // ✅ ROUTES no App (CORRETO)
  return (
    <Routes>
      <Route path="/s/:id" element={<SharePage />} />
      <Route
        path="/*"
        element={
          <div className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
            {/* SIDEBAR */}
            <aside className="sidebar">
              {/* COLLAPSED RAIL (só + e seta) */}
              {sidebarCollapsed && (
                <div className="sidebar-rail">
                  <button
                    className="rail-btn rail-plus"
                    type="button"
                    onClick={handleNewChat}
                    aria-label="Novo chat"
                    title="Novo chat"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        d="M12 5v14M5 12h14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>

                  <button
                    className="rail-btn rail-expand"
                    type="button"
                    onClick={() => setSidebarCollapsed(false)}
                    aria-label="Abrir sidebar"
                    title="Abrir sidebar"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M9 6l6 6-6 6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  

                </div>
              )}
{/* ✅ Toast global (canto inferior direito) */}
{globalToast && (
  <div className="global-toast" role="status" aria-live="polite">
    <span className="global-toast-check" aria-hidden="true">✓</span>
    <span className="global-toast-text">{globalToast.text}</span>
  </div>
)}
              {/* SIDEBAR NORMAL */}
              {!sidebarCollapsed && (
                <>
                  {/* HEADER: logo + botão fechar */}
                  <div className="sidebar-header">
                    <img className="sidebar-logo" src={coreLogo} alt="Core AI" />

                    <button
                      className="sidebar-collapse-btn"
                      type="button"
                      onClick={() => setSidebarCollapsed(true)}
                      aria-label="Fechar sidebar"
                      title="Fechar sidebar"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          d="M15 6l-6 6 6 6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </div>

                  {/* NAV */}
                  <nav className="nav">
                    {/* SIDEBAR */}
                    <div className="nav-group">
                      <span className="nav-section">GERAL</span>

                      <button
                        className={`nav-btn ${activeSection === "chat" ? "active" : ""}`}
                        onClick={() => setActiveSection("chat")}
                      >
                        <span className="nav-ico" aria-hidden="true">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M8.25 9.75h7.5M8.25 13.5h4.5M21 12c0 4.418-4.03 8-9 8a9.77 9.77 0 01-4.39-.99L3 20l1.26-3.78A7.91 7.91 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                            />
                          </svg>
                        </span>
                        Novo chat
                      </button>

                      <button
  className="nav-btn"
  onClick={() => setSearchOpen(true)}
>
                        <span className="nav-ico" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none">
                            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        </span>
                        Procurar chats
                      </button>

                      <button
                        className={`nav-btn ${activeSection === "explore" ? "active" : ""}`}
                        onClick={() => setActiveSection("explore")}
                      >
                        <span className="nav-ico" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
                            <path d="M14.5 9.5l-5 5l1.5-4l3.5-1z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                          </svg>
                        </span>
                        Explorar
                      </button>
                    </div>

                    {/* CORE */}
                    <div className="nav-group">
                      <span className="nav-section">CORE</span>

                      <button
                        className={`nav-btn ${activeSection === "creative" ? "active" : ""}`}
                        onClick={() => setActiveSection("creative")}
                      >
                        <span className="nav-ico" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none">
                            <path d="M12 3l8 4-8 4-8-4 8-4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                            <path d="M4 11l8 4 8-4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                            <path d="M4 15l8 4 8-4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                          </svg>
                        </span>
                        Creative Studio
                      </button>
                      <button
                        className={`nav-btn ${activeSection === "copilot" ? "active" : ""}`}
                        onClick={() => setActiveSection("copilot")}
                      >
                        <span className="nav-ico" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none">
                            <path
                              d="M8 9l-4 3l4 3M16 9l4 3l-4 3M14 4l-4 16"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                        Code CoPilot
                      </button>

                      <button
                        className={`nav-btn ${activeSection === "assistants" ? "active" : ""}`}
                        onClick={() => setActiveSection("assistants")}
                      >
                        <span className="nav-ico" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none">
                            <path
                              d="M16 11a4 4 0 10-8 0a4 4 0 008 0zM4 20a8 8 0 0116 0"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                        Assistentes
                      </button>
                      

                    </div>
                    {/* PROJETOS */}
<div className="nav-group">
  <span className="nav-section">PROJETOS</span>

  <button
    className={`nav-btn ${activeSection === "projects" ? "active" : ""}`}
    onClick={() => setActiveSection("projects")}
  >
   <span className="nav-ico" aria-hidden="true">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      width="20"
      height="20"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75
           m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5
           A2.25 2.25 0 0 0 2.25 6v12
           a2.25 2.25 0 0 0 2.25 2.25h15
           A2.25 2.25 0 0 0 21.75 18V9
           a2.25 2.25 0 0 0-2.25-2.25h-5.379
           a1.5 1.5 0 0 1-1.06-.44Z"
      />
    </svg>
    </span>
    Novo projeto
  </button>
</div>

                  </nav>

                  {/* CHATS LIST */}
                  <div className="sidebar-chats">
                    <button className="new-chat-btn" onClick={handleNewChat}>
                      + Novo chat
                    </button>

                    <div className="chat-list-section">
                      <span className="nav-section">CONVERSAS</span>

                      <div className="chat-list">
  {orderedConversations.map((conv) => (
                          <div key={conv.id} className={`chat-list-item-wrapper ${conv.id === activeId ? "active" : ""}`}>
                            <div
                              className={`chat-list-item ${conv.id === activeId ? "active" : ""}`}
                              onClick={() => {
                                setActiveId(conv.id);
                                setOpenMenuId(null);
                                setActiveSection("chat");
                              }}
                            >
                              <div className="chat-list-title-row">
  {conv.pinned && (
    <span className="chat-pin-icon" aria-label="Afixado" title="Afixado">
      <Pin
        size={15}
        strokeWidth={1.25}
        className="chat-pin-svg pinned-left"
      />
    </span>
  )}

  <span className="chat-list-title">{conv.title}</span>
</div>

                              <button
                                className="chat-more-btn"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId((prev) => (prev === conv.id ? null : conv.id));
                                }}
                                aria-label="Mais"
                              >
                                …
                              </button>
                            </div>

                            {openMenuId === conv.id && (
                              <>
                                <div className="chat-menu-backdrop" onClick={() => setOpenMenuId(null)} />
<div className="chat-menu" onClick={(e) => e.stopPropagation()}>
  {/* Afixar / Desafixar */}
  <button
    type="button"
    onClick={() => {
      handleTogglePinChat(conv.id);
      setOpenMenuId(null);
    }}
  >
    {conv.pinned ? "Desafixar conversa" : "Afixar conversa"}
  </button>

  {/* Renomear */}
  <button
    type="button"
    onClick={() => {
      handleRenameChat(conv.id);
      setOpenMenuId(null);
    }}
  >
    Renomear
  </button>

  {/* Apagar */}
  <button
    type="button"
    className="danger"
    onClick={() => {
      handleDeleteChat(conv.id);
      setOpenMenuId(null);
    }}
  >
    Apagar
  </button>
</div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* FOOTER */}
                  <div className="sidebar-footer">
                    <div className="user-chip">
                      <div className="user-avatar">B</div>
                      <div className="user-meta">
                        <div className="user-name">Bernardo</div>
                        <div className="user-plan">Premium</div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </aside>

            {/* MAIN */}
            <main className="chat-area">
              <header className="top-bar">
                <div className="top-left-title">
                  <span className="welcome-light">Bem-vindo à </span>
                  <strong>Core AI</strong>
                </div>
                <div className="top-right">
                  <span className="plan-pill beta">BETA</span>
                </div>
              </header>

              <section className="chat-main">
                {/* CHAT */}
                {activeSection === "chat" && (
                  <div className="chat-main-body" ref={chatBodyRef}>
{hasMessages ? (
  <>
    <div className="messages">
      {activeConversation?.messages.map((m, i) => {
        const msgKey = getMsgKey(i);

        return (
          <div key={i} className="msg-wrapper">
  {/* 📎 anexos do user (por cima da bolha) */}
  {m.role === "user" && Array.isArray(m.attachments) && m.attachments.length > 0 && (
    <div className="msg-attachments">
      {m.attachments.map((a) => (
        <div key={a.id} className="msg-attach-tile">
          {a.isImage && a.previewUrl ? (
            <img className="msg-attach-thumb" src={a.previewUrl} alt={a.name} />
          ) : (
            <div className="msg-attach-file" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M6 2h8l4 4v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V7h3.5L14 3.5z"
                />
              </svg>
            </div>
          )}

          <div className="msg-attach-meta">
            <div className="msg-attach-name">{a.name}</div>
            <div className="msg-attach-sub">{formatBytes(a.size)}{a.type ? ` • ${a.type}` : ""}</div>
          </div>
        </div>
      ))}
    </div>
  )}

  <div className={`msg ${m.role === "user" ? "msg-user" : "msg-ai"}`}>{m.content}</div>

        

            {/* ACTIONS */}
            {m.role === "user" ? (
              <div className="msg-actions msg-actions-user">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copiar"
                  data-tip="Copiar"
                  onClick={async () => {
  try {
    await navigator.clipboard.writeText(m.content);
    showGlobalToast("Copiado para a área de transferência");
  } catch {
    // opcional: showGlobalToast("Falhou ao copiar");
  }
}}
                >
                  <IconCopy />
                </button>

                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Editar"
                  data-tip="Editar"
                  onClick={() => {
  setInput(m.content);

  requestAnimationFrame(() => {
    autoResizeTextarea();
    textareaRef.current?.focus();
  });
}}
                >
                  <IconEdit />
                </button>
              </div>
            ) : (
              <div className="msg-actions msg-actions-ai">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Copiar"
                  data-tip="Copiar"
                  onClick={async () => {
  try {
    await navigator.clipboard.writeText(m.content);
    showGlobalToast("Copiado para a área de transferência");
  } catch {
    // opcional: showGlobalToast("Falhou ao copiar");
  }
}}
                >
                  <IconCopy />
                </button>

                <button
                  type="button"
                  className={`icon-btn ${msgRatings[msgKey] === "up" ? "is-active" : ""}`}
                  aria-label="Gostei"
                  data-tip="Gostei"
                  aria-pressed={msgRatings[msgKey] === "up"}
                  onClick={() => {
                    setMsgRatings((prev) => {
                      const next = { ...prev };
                      next[msgKey] = prev[msgKey] === "up" ? undefined : "up";
                      return next;
                    });
                    
                  }}
                >
                  <IconThumbUp />
                </button>

                <button
                  type="button"
                  className={`icon-btn ${msgRatings[msgKey] === "down" ? "is-active" : ""}`}
                  aria-label="Não gostei"
                  data-tip="Não gostei"
                  aria-pressed={msgRatings[msgKey] === "down"}
                  onClick={() => {
                    setMsgRatings((prev) => {
                      const next = { ...prev };
                      next[msgKey] = prev[msgKey] === "down" ? undefined : "down";
                      return next;
                    });
                    
                  }}
                >
                  <IconThumbDown />
                </button>

                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Partilhar"
                  data-tip="Partilhar"
                  onClick={() => handleShare(activeConversation.messages)}
                >
                  <IconShare />
                </button>

                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Tentar novamente"
                  data-tip="Tentar novamente"
                  onClick={() => {
                    const prevUser = [...activeConversation.messages]
                      .slice(0, i)
                      .reverse()
                      .find((x) => x.role === "user");

                    if (prevUser) handleSend(prevUser.content);
                  }}
                >
                  <IconRetry />
                </button>
              </div>
            )}
          </div>
        );
      })}

      {loading && <div className="thinking">A Core está a pensar…</div>}
    </div>
    <button
  className={`scroll-to-bottom ${showScrollDown ? "visible" : ""}`}
  onClick={() => scrollToBottom("smooth")}
  aria-label="Descer para o fim"
  title="Descer para o fim"
>
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path
      d="M12 16c-.3 0-.6-.1-.8-.3l-5-5a1.1 1.1 0 011.6-1.6L12 13.3l4.2-4.2a1.1 1.1 0 011.6 1.6l-5 5c-.2.2-.5.3-.8.3z"
      fill="currentColor"
    />
  </svg>
</button>
  
  </>
) : (

                      <div className="chat-empty-state">
  <div className="chat-empty-inner">
    <h1 className="chat-empty-title">Em que posso ajudar?</h1>

    {/* INPUT (centrado) — só aparece no novo chat */}
    <div className="chat-input-wrapper centered">
      <form onSubmit={onSubmit} className="chat-input-form">
        <div className="composer">
          <div className="composer-top">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const el = textareaRef.current;
                if (el) {
                  el.style.height = "auto";
                  el.style.height = el.scrollHeight + "px";
                }
              }}
              placeholder="Pergunte qualquer coisa"
              disabled={!activeConversation}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              className="composer-textarea"
            />
          </div>

          {/* 📎 Anexos (Perplexity-like, dentro do composer) */}
          {attachments.length > 0 && (
            <div className="composer-attachments-row">
              {attachments.map((a) => (
                <div key={a.id} className="attach-tile">
                  {a.isImage && a.previewUrl ? (
                    <img className="attach-thumb" src={a.previewUrl} alt={a.name} />
                  ) : (
                    <div className="attach-file-ico" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="18" height="18">
                        <path
                          fill="currentColor"
                          d="M6 2h8l4 4v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V7h3.5L14 3.5z"
                        />
                      </svg>
                    </div>
                  )}

                  <div className="attach-meta">
                    <div className="attach-name">{a.name}</div>
                    <div className="attach-sub">
                      {formatBytes(a.size)}{a.type ? ` • ${a.type}` : ""}
                    </div>
                  </div>

                  <button
                    type="button"
                    className="attach-x"
                    onClick={() => removeAttachment(a.id)}
                    aria-label="Remover anexo"
                    title="Remover"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="composer-bottom">
            {/* 📎 Anexos */}
            <label className="composer-attach" title="Anexar ficheiro">
              <input
                ref={fileInputRef}
                type="file"
                className="composer-file"
                multiple
                onChange={(e) => addFiles(e.target.files)}
              />
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M16.5 6.5l-7.8 7.8a3 3 0 104.2 4.2l8.1-8.1a5 5 0 00-7.1-7.1L6.1 11.1a7 7 0 109.9 9.9l6.3-6.3l-1.4-1.4l-6.3 6.3a5 5 0 11-7.1-7.1l7.8-7.8a3 3 0 014.2 4.2l-8.1 8.1a1 1 0 01-1.4-1.4l7.8-7.8z"
                />
              </svg>
            </label>

            <button
              type="button"
              className={`chip ${webSearchEnabled ? "chip-active" : ""}`}
              aria-pressed={webSearchEnabled}
              onClick={() => setWebSearchEnabled((v) => !v)}
            >
              <span className="chip-ico" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="16" height="16">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
                  />
                </svg>
              </span>
              Web Search
            </button>

            <button
              type="button"
              className={`chip ${reasoningEnabled ? "chip-active" : ""}`}
              aria-pressed={reasoningEnabled}
              onClick={() => setReasoningEnabled((v) => !v)}
            >
              <span className="chip-ico" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width="14" height="14">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
                  />
                </svg>
              </span>
              Reasoning
            </button>

            <div className="composer-actions">
              <div className="model-selector" ref={modelSelectorRef}>
                <button
                  type="button"
                  className="model-trigger"
                  onClick={() => setModelMenuOpen((v) => !v)}
                >
                  <img
                    src={MODELS.find((m) => m.id === activeModel)?.logo}
                    alt=""
                    className="model-logo"
                  />
                  <span className="model-name">
                    {MODELS.find((m) => m.id === activeModel)?.name}
                  </span>
                </button>

                {modelMenuOpen && (
                  <div className="model-menu" onClick={(e) => e.stopPropagation()}>
                    <div className="model-menu-head">
                      <input
                        className="model-search"
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder="Pesquisar modelo…"
                        autoFocus
                      />
                    </div>

                    <div className="model-menu-list">
                      {filteredModels.map((model) => (
                        <button
                          key={model.id}
                          className={`model-item ${model.id === activeModel ? "active" : ""}`}
                          onClick={() => {
                            setActiveModel(model.id);
                            setModelMenuOpen(false);
                            setModelQuery("");
                          }}
                        >
                          <img src={model.logo} alt="" />
                          <span>{model.name}</span>
                        </button>
                      ))}

                      {filteredModels.length === 0 && <div className="model-empty">Sem resultados</div>}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="composer-send"
                disabled={loading || !activeConversation}
                title="Enviar"
              >
                {loading ? (
                  <span className="send-dots">…</span>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 27 24" aria-hidden="true">
                    <path d="M2 12L22 3L14 21L11 13L2 12Z" fill="currentColor" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  </div>
</div>
                    )}
                  </div>
                )}

                {/* INPUT */}
                {hasMessages && (
  <div className="chat-input-wrapper">
                  <form onSubmit={onSubmit} className="chat-input-form">
                    <div className="composer">
                      <div className="composer-top">
                        <textarea
                          ref={textareaRef}
                          rows={1}
                          value={input}
                          onChange={(e) => {
                            setInput(e.target.value);
                            const el = textareaRef.current;
                            if (el) {
                              el.style.height = "auto";
                              el.style.height = el.scrollHeight + "px";
                            }
                          }}
                          placeholder="Pergunte qualquer coisa"
                          disabled={!activeConversation}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSend();
                            }
                          }}
                          className="composer-textarea"
                        />
                      </div>
  {/* 📎 Anexos (Perplexity-like, dentro do composer) */}
  {attachments.length > 0 && (
    <div className="composer-attachments-row">
      {attachments.map((a) => (
        <div key={a.id} className="attach-tile">
          {a.isImage && a.previewUrl ? (
            <img className="attach-thumb" src={a.previewUrl} alt={a.name} />
          ) : (
            <div className="attach-file-ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path
                  fill="currentColor"
                  d="M6 2h8l4 4v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V7h3.5L14 3.5z"
                />
              </svg>
            </div>
          )}

          <div className="attach-meta">
            <div className="attach-name">{a.name}</div>
            <div className="attach-sub">{formatBytes(a.size)}{a.type ? ` • ${a.type}` : ""}</div>
          </div>

          <button
            type="button"
            className="attach-x"
            onClick={() => removeAttachment(a.id)}
            aria-label="Remover anexo"
            title="Remover"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )}
                      <div className="composer-bottom">
                        {/* 📎 Anexos */}
                        <label className="composer-attach" title="Anexar ficheiro">
                          <input
  ref={fileInputRef}
  type="file"
  className="composer-file"
  multiple
  onChange={(e) => addFiles(e.target.files)}
/>
                          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                              fill="currentColor"
                              d="M16.5 6.5l-7.8 7.8a3 3 0 104.2 4.2l8.1-8.1a5 5 0 00-7.1-7.1L6.1 11.1a7 7 0 109.9 9.9l6.3-6.3l-1.4-1.4l-6.3 6.3a5 5 0 11-7.1-7.1l7.8-7.8a3 3 0 014.2 4.2l-8.1 8.1a1 1 0 01-1.4-1.4l7.8-7.8z"
                            />
                          </svg>
                        </label>

                        <button
  type="button"
  className={`chip ${webSearchEnabled ? "chip-active" : ""}`}
  aria-pressed={webSearchEnabled}
  onClick={() => setWebSearchEnabled((v) => !v)}
>
          <span className="chip-ico" aria-hidden="true">
            <svg
  xmlns="http://www.w3.org/2000/svg"
  fill="none"
  viewBox="0 0 24 24"
  strokeWidth={1.5}
  stroke="currentColor"
  width="16"
  height="16"
>
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
  />
</svg>
          </span>
          Web Search
        </button>

                        <button
  type="button"
  className={`chip ${reasoningEnabled ? "chip-active" : ""}`}
  aria-pressed={reasoningEnabled}
  onClick={() => setReasoningEnabled((v) => !v)}
>
          <span className="chip-ico" aria-hidden="true">
            <svg
  xmlns="http://www.w3.org/2000/svg"
  fill="none"
  viewBox="0 0 24 24"
  strokeWidth={1.5}
  stroke="currentColor"
  width="14"
  height="14"
>
  <path
    strokeLinecap="round"
    strokeLinejoin="round"
    d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
  />
</svg>
          </span>
          Reasoning
        </button>

                        {/* 🔮 Seletor de modelo */}
                        <div className="composer-actions">
                          <div className="model-selector" ref={modelSelectorRef}>
                            <button
                              type="button"
                              className="model-trigger"
                              onClick={() => setModelMenuOpen((v) => !v)}
                            >
                              <img
                                src={MODELS.find((m) => m.id === activeModel)?.logo}
                                alt=""
                                className="model-logo"
                              />
                              <span className="model-name">
                                {MODELS.find((m) => m.id === activeModel)?.name}
                              </span>
                            </button>

                            {modelMenuOpen && (
                              <div className="model-menu" onClick={(e) => e.stopPropagation()}>
                                <div className="model-menu-head">
                                  <input
                                    className="model-search"
                                    value={modelQuery}
                                    onChange={(e) => setModelQuery(e.target.value)}
                                    placeholder="Pesquisar modelo…"
                                    autoFocus
                                  />
                                </div>

                                <div className="model-menu-list">
                                  {filteredModels.map((model) => (
                                    <button
                                      key={model.id}
                                      className={`model-item ${model.id === activeModel ? "active" : ""}`}
                                      onClick={() => {
                                        setActiveModel(model.id);
                                        setModelMenuOpen(false);
                                        setModelQuery("");
                                      }}
                                    >
                                      <img src={model.logo} alt="" />
                                      <span>{model.name}</span>
                                    </button>
                                  ))}

                                  {filteredModels.length === 0 && <div className="model-empty">Sem resultados</div>}
                                </div>
                              </div>
                            )}
                          </div>

                          <button
                            type="submit"
                            className="composer-send"
                            disabled={loading || !activeConversation}
                            title="Enviar"
                          >
                            {loading ? (
                              <span className="send-dots">…</span>
                            ) : (
                              <svg width="18" height="18" viewBox="0 0 27 24" aria-hidden="true">
                                <path d="M2 12L22 3L14 21L11 13L2 12Z" fill="currentColor" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </form>
                </div>
                )}

                {/* PLACEHOLDERS — páginas futuras */}
                {activeSection !== "chat" && (
                  <div className="section-placeholder">
                    <h1>Em breve</h1>
                    <p>
                      A secção <strong>{activeSection}</strong> vai ser construída aqui, ocupando toda a área à direita.
                    </p>
                  </div>
                )}
              </section>
            </main>
{searchOpen && (
  <div
    className="search-modal-backdrop"
    onClick={() => setSearchOpen(false)}
  >
    <div
      className="search-modal"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        className="search-input"
        placeholder="Search chats"
        value={searchQuery}
        autoFocus
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      <button
        className="search-new-chat"
        onClick={() => {
          setSearchOpen(false);
          handleNewChat();
        }}
      >
        + New Chat
      </button>

      <div className="search-results">
        {orderedConversations
          .filter((c) =>
            c.title.toLowerCase().includes(searchQuery.toLowerCase())
          )
          .map((c) => (
            <button
              key={c.id}
              className="search-result-item"
              onClick={() => {
                setActiveId(c.id);
                setSearchOpen(false);
              }}
            >
              {c.title}
            </button>
          ))}
      </div>
    </div>
  </div>
)}
            {/* ✅ SHARE MODAL (tipo Genie AI) */}
            {shareData && (
              <div
                className="share-modal-backdrop"
                onClick={() => setShareData(null)}
                role="dialog"
                aria-modal="true"
              >
                <div className="share-modal" onClick={(e) => e.stopPropagation()}>
                  <button className="share-close" onClick={() => setShareData(null)} aria-label="Fechar">
                    ×
                  </button>

                  <div className="share-title">Partilhar conversa</div>

                  <div className="share-preview">
                    <div className="share-preview-box">
                      {(shareData.messages || []).slice(-1).map((m, idx) => (
                        <div key={idx} className="share-preview-text">
                          {m.content}
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    className="share-copy"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(shareData.url);
                        showToast("share", "Link copiado");
                      } catch {
                        showToast("share", "Falhou");
                      }
                    }}
                  >
                    Copy link
                  </button>

                  
                </div>
              </div>
            )}
          </div>
        }
      />
    </Routes>
  );
}

// ✅ PÁGINA PÚBLICA (abre pelo link /s/:id)
function SharePage() {
  const { id } = useParams();
  const [data, setData] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`coreai_share_${id}`);
      if (!raw) return;
      setData(JSON.parse(raw));
    } catch {}
  }, [id]);

  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: "#000", color: "#fff", display: "grid", placeItems: "center" }}>
        <div style={{ opacity: 0.7 }}>Link inválido ou expirado.</div>
      </div>
    );
  }

  return (
    <div className="share-page">
      <div className="share-top">
        <div className="share-brand">Core AI</div>
      </div>

      <div className="share-content">
        <div className="messages share-messages">
          {data.messages.map((m, i) => (
            <div key={i} className={`msg ${m.role === "user" ? "msg-user" : "msg-ai"}`}>
              {m.content}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default App;

















