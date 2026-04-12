import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { ArrowLeft, MoreHorizontal, Pencil, Plus, Search, X } from "lucide-react";
import useFileDropTarget, { extractTransferFiles } from "../../hooks/useFileDropTarget";
import ComposerFileDropOverlay from "../composer/ComposerFileDropOverlay";

const EMPTY_CHATS = [];
const DEFAULT_PROJECT_CHAT_TITLE = "New chat";
const NEW_MODEL_BADGE_IDS = new Set([
  "gpt-5.4 pro",
  "gpt-5.4",
  "gemini-3.1 pro",
  "claude-opus-4.6",
  "claude-sonnet-4.6",
  "nemotron 3 super",
  "minimax m2.7",
]);
const PROJECT_MODELS = [
  { id: "__best__", name: "Best • Auto", logo: "/models/coreai.svg" },
    { id: "gpt-5.4 pro", name: "GPT-5.4 Pro", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.4", name: "GPT-5.4", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.2 pro", name: "GPT-5.2 Pro", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.2", name: "GPT-5.2", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5.1", name: "GPT-5.1", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5-mini", name: "GPT-5 Mini", provider: "openai", logo: "/models/openai.svg" },
  { id: "gpt-5", name: "GPT-5", provider: "openai", logo: "/models/openai.svg" },
  { id: "claude-opus-4.6", name: "Claude Opus 4.6", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-opus-4.5", name: "Claude Opus 4.5", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", provider: "anthropic", logo: "/models/anthropic.svg" },
  { id: "gemini-3.1 pro", name: "Gemini 3.1 Pro", provider: "google", logo: "/models/google.svg" },
  { id: "gemini-3 pro", name: "Gemini 3 Pro", provider: "google", logo: "/models/google.svg" },
  { id: "gemini-2.5 pro", name: "Gemini 2.5 Pro", provider: "google", logo: "/models/google.svg" },
  { id: "gemini-2.5 flash", name: "Gemini 2.5 Flash", provider: "google", logo: "/models/google.svg" },
  { id: "grok-4.2", name: "Grok 4.2", provider: "grok", logo: "/models/grok.svg" },
  { id: "grok-4.1", name: "Grok 4.1", provider: "grok", logo: "/models/grok.svg" },
  { id: "grok-4", name: "Grok 4", provider: "grok", logo: "/models/grok.svg" },
  { id: "deepseek-v3.2", name: "DeepSeek V3.2", provider: "deepseek", logo: "/models/deepseek.svg" },
  { id: "deepseek-r1", name: "DeepSeek R1", provider: "deepseek", logo: "/models/deepseek.svg" },
  { id: "perplexity-sonar-pro", name: "Perplexity Sonar Pro", provider: "perplexity", logo: "/models/perplexity.svg" },
  { id: "perplexity-sonar", name: "Perplexity Sonar", provider: "perplexity", logo: "/models/perplexity.svg" },
  {
    id: "nemotron 3 super",
    name: "Nemotron 3 Super",
    provider: "openrouter",
    logo: "https://cdn.simpleicons.org/nvidia/76B900",
  },
  {
    id: "minimax m2.7",
    name: "MiniMax M2.7",
    provider: "openrouter",
    logo: "/models/minimax-color.png",
  },
  { id: "kimi-k2-5", name: "Kimi K2.5", provider: "moonshot", logo: "/models/kimi.svg" },
  { id: "qwen3.5-plus", name: "Qwen 3.5 Plus", provider: "qwen", logo: "/models/qwen.svg" },
  { id: "qwen3.5-flash", name: "Qwen 3.5 Flash", provider: "qwen", logo: "/models/qwen.svg" },
  { id: "qwen3-max", name: "Qwen 3 Max", provider: "qwen", logo: "/models/qwen.svg" },
];

function formatChatTime(timestamp) {
  if (!timestamp) return "just now";

  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) return `${diffMinutes} min`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"}`;

  const diffDays = Math.round(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"}`;
}

function formatLastMessageTime(timestamp) {
  const relativeTime = formatChatTime(timestamp);
  if (relativeTime === "just now") return "Last message just now";
  return `Last message ${relativeTime} ago`;
}

function formatProjectUpdatedTime(timestamp) {
  const relativeTime = formatChatTime(timestamp);
  if (relativeTime === "just now") return "Updated just now";
  return `Updated ${relativeTime} ago`;
}

function findLinkedConversation(chat, conversations) {
  if (!chat || !Array.isArray(conversations) || conversations.length === 0) return null;

  return (
    conversations.find((conversation) => {
      if (chat.conversationRefId && conversation?.localKey === chat.conversationRefId) return true;
      return chat.conversationId != null && conversation?.id === chat.conversationId;
    }) || null
  );
}

function getChatRecord(chat, conversations) {
  return findLinkedConversation(chat, conversations) || chat;
}

function getConversationReference(chat, linkedConversation) {
  return (
    linkedConversation?.localKey ||
    linkedConversation?.id ||
    chat?.conversationRefId ||
    chat?.conversationId ||
    null
  );
}

function matchesSameConversation(leftChat, rightChat) {
  if (!leftChat || !rightChat) return false;
  if (leftChat.conversationId != null && rightChat.conversationId != null) {
    return leftChat.conversationId === rightChat.conversationId;
  }
  if (leftChat.conversationRefId && rightChat.conversationRefId) {
    return leftChat.conversationRefId === rightChat.conversationRefId;
  }
  return leftChat.id === rightChat.id;
}

function sortProjectTargets(projects) {
  return [...projects].sort((left, right) => {
    const leftPinned = left?.pinned ? 1 : 0;
    const rightPinned = right?.pinned ? 1 : 0;

    if (leftPinned !== rightPinned) return rightPinned - leftPinned;

    return new Date(right?.updatedAt || 0).getTime() - new Date(left?.updatedAt || 0).getTime();
  });
}

function getInstructionsPreview(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117).trim()}...`;
}

function DeleteMenuIcon(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

function RenameMenuIcon(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function RemoveFromProjectMenuIcon(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="m9.5 10.5 5 5" />
      <path d="m14.5 10.5-5 5" />
    </svg>
  );
}

function ChangeProjectMenuIcon(props) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v.5" />
      <path d="M12 10v4h4" />
      <path d="m12 14 1.535-1.605a5 5 0 0 1 8 1.5" />
      <path d="M22 22v-4h-4" />
      <path d="m22 18-1.535 1.605a5 5 0 0 1-8-1.5" />
    </svg>
  );
}

function FolderOutlineIcon() {
  return (
    <svg
      className="projects-workspace__files-icon"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="1.5"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
      />
    </svg>
  );
}

function FileTileIcon() {
  return (
    <div className="attach-file-ico" aria-hidden="true">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth="1.5"
        stroke="currentColor"
        className="size-6"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        />
      </svg>
    </div>
  );
}

function ProjectFileTile({ file, onRemove, formatBytes }) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const showPreview = Boolean(file?.previewUrl) && String(file?.type || "").startsWith("image/") && !previewFailed;

  return (
    <div className="attach-tile projects-workspace__file-tile">
      {showPreview ? (
        <img
          className="attach-thumb"
          src={file.previewUrl}
          alt={file?.name || "Project file"}
          onError={() => setPreviewFailed(true)}
        />
      ) : (
        <FileTileIcon />
      )}

      <div className="attach-meta">
        <div className="attach-name">{file?.name || "Untitled file"}</div>
        <div className="attach-sub">{formatBytes(file?.size)}</div>
      </div>

      <button
        type="button"
        className="attach-x"
        onClick={() => onRemove(file?.id)}
        aria-label={`Remove ${file?.name || "file"}`}
        title="Remove"
      />
    </div>
  );
}

export default function ProjectView({
  projects = [],
  project,
  projectFileLimit = 5,
  messageAttachmentLimit = 10,
  isFreePlan = false,
  isUploadingProjectFiles = false,
  setProjects,
  conversations = [],
  showGlobalToast,
  onOpenPlan,
  onCreateProjectConversation,
  onActivateProjectConversation,
  onOpenProjectConversation,
  onRequestProjectConversationRename,
  onRequestProjectConversationDelete,
  onPersistProjectActiveChat,
  onSaveProjectInstructions,
  onRemoveProjectChat,
  onMoveProjectChat,
  onAddProjectFiles,
  onRemoveProjectFile,
  onExitProject,
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [instructionsModalOpen, setInstructionsModalOpen] = useState(false);
  const [activeModel, setActiveModel] = useState("__best__");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelMenuStyle, setModelMenuStyle] = useState(null);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [openChatMenuId, setOpenChatMenuId] = useState(null);
  const [moveChatId, setMoveChatId] = useState(null);
  const [moveProjectQuery, setMoveProjectQuery] = useState("");
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [reasoningEnabled, setReasoningEnabled] = useState(false);
  const textareaRef = useRef(null);
  const composerShellRef = useRef(null);
  const fileInputRef = useRef(null);
  const projectFilesInputRef = useRef(null);
  const composerToolsRef = useRef(null);
  const modelSelectorRef = useRef(null);
  const modelMenuRef = useRef(null);
  const attachmentsRef = useRef([]);
  const workspaceRef = useRef(null);
  const focusViewportTimersRef = useRef([]);
  const shouldAutoFocusOverlayInputs =
    typeof window === "undefined" ? true : window.innerWidth > 1024;
  const chats = Array.isArray(project?.chats) ? project.chats : EMPTY_CHATS;

  useEffect(() => {
    if (!isFreePlan) return;
    if (webSearchEnabled) setWebSearchEnabled(false);
    if (reasoningEnabled) setReasoningEnabled(false);
  }, [isFreePlan, webSearchEnabled, reasoningEnabled]);

  const promptPlanUpgradeForFeature = (featureLabel) => {
    setToolsMenuOpen(false);
    onOpenPlan?.();
    showGlobalToast?.(`Upgrade your plan to use ${featureLabel}.`);
  };

  const handleToggleWebSearch = () => {
    if (webSearchEnabled) {
      setWebSearchEnabled(false);
      return;
    }

    if (isFreePlan) {
      promptPlanUpgradeForFeature("Web Search");
      return;
    }

    setWebSearchEnabled(true);
  };

  const handleToggleReasoning = () => {
    if (reasoningEnabled) {
      setReasoningEnabled(false);
      return;
    }

    if (isFreePlan) {
      promptPlanUpgradeForFeature("Reasoning");
      return;
    }

    setReasoningEnabled(true);
  };

  const activeChat = project
    ? chats.find((chat) => chat.id === project.activeChatId) || chats[0] || null
    : null;

  const filteredModels = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();
    if (!query) return PROJECT_MODELS;
    return PROJECT_MODELS.filter((model) => model.name.toLowerCase().includes(query));
  }, [modelQuery]);

  const bestAutoModel = PROJECT_MODELS.find((model) => model.id === "__best__") || PROJECT_MODELS[0];
  const standardFilteredModels = filteredModels.filter((model) => model.id !== "__best__");
  const activeModelData = PROJECT_MODELS.find((model) => model.id === activeModel) || bestAutoModel;
  const moveChat = moveChatId ? chats.find((chat) => chat.id === moveChatId) || null : null;
  const availableProjects = useMemo(
    () =>
      sortProjectTargets(
        (Array.isArray(projects) ? projects : []).filter((candidateProject) => candidateProject?.id !== project?.id)
      ),
    [projects, project?.id]
  );
  const filteredMoveProjects = useMemo(() => {
    const normalizedQuery = moveProjectQuery.trim().toLowerCase();
    if (!normalizedQuery) return availableProjects;

    return availableProjects.filter((candidateProject) => {
      const projectName = String(candidateProject?.name || "").toLowerCase();
      const projectBrief = String(candidateProject?.brief || "").toLowerCase();
      return projectName.includes(normalizedQuery) || projectBrief.includes(normalizedQuery);
    });
  }, [availableProjects, moveProjectQuery]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
  }, [draft]);

  useEffect(() => {
    const shell = composerShellRef.current;
    if (!shell || typeof document === "undefined") return undefined;

    const root = document.documentElement;
    let rafId = 0;

    const apply = () => {
      rafId = 0;
      const nextHeight = Math.ceil(shell.getBoundingClientRect().height || 0);
      if (nextHeight > 0) root.style.setProperty("--projects-composer-h", `${nextHeight}px`);
    };

    const schedule = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(apply);
    };

    schedule();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;

    try {
      resizeObserver?.observe(shell);
    } catch {
      // ignore observer failures
    }

    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);

    return () => {
      resizeObserver?.disconnect();
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (rafId) window.cancelAnimationFrame(rafId);
      root.style.removeProperty("--projects-composer-h");
    };
  }, []);

  useEffect(() => {
    const workspace = workspaceRef.current;
    const container = workspace?.closest(".chat-main-body");
    if (!container) return undefined;

    container.classList.add("chat-main-body--projects");

    return () => {
      container.classList.remove("chat-main-body--projects");
    };
  }, []);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(
    () => () => {
      attachmentsRef.current.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
    },
    []
  );

  useEffect(
    () => () => {
      focusViewportTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
      focusViewportTimersRef.current = [];
    },
    []
  );

  useEffect(() => {
    function handleClickOutside(event) {
      const clickedTrigger = modelSelectorRef.current?.contains(event.target);
      const clickedMenu = modelMenuRef.current?.contains(event.target);
      const clickedTools = composerToolsRef.current?.contains(event.target);

      if (modelMenuOpen && !clickedTrigger && !clickedMenu) {
        setModelMenuOpen(false);
      }

      if (toolsMenuOpen && !clickedTools) {
        setToolsMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [modelMenuOpen, toolsMenuOpen]);

  useEffect(() => {
    if (!instructionsModalOpen) return undefined;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setInstructionsModalOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [instructionsModalOpen]);

  useEffect(() => {
    if (!moveChatId) return undefined;

    function handleEscape(event) {
      if (event.key === "Escape") {
        setMoveChatId(null);
        setMoveProjectQuery("");
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [moveChatId]);

  useEffect(() => {
    if (!moveChatId) return;
    if (chats.some((chat) => chat.id === moveChatId)) return;
    const resetId = window.setTimeout(() => {
      setMoveChatId(null);
      setMoveProjectQuery("");
    }, 0);
    return () => window.clearTimeout(resetId);
  }, [chats, moveChatId]);

  useEffect(() => {
    if (!modelMenuOpen) return undefined;

    function updateModelMenuPosition() {
      const trigger = modelSelectorRef.current?.querySelector(".model-trigger");
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const width = Math.min(300, window.innerWidth - 24);
      const left = Math.max(12, rect.right - width);
      const estimatedMenuHeight = modelMenuRef.current?.offsetHeight || 356;
      const gap = 10;
      const viewportPadding = 12;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const shouldOpenUpward =
        spaceBelow < estimatedMenuHeight && spaceAbove > Math.max(spaceBelow, estimatedMenuHeight * 0.55);
      const nextTop = shouldOpenUpward
        ? Math.max(viewportPadding, rect.top - estimatedMenuHeight - gap)
        : Math.max(
            viewportPadding,
            Math.min(rect.bottom + gap, window.innerHeight - estimatedMenuHeight - viewportPadding)
          );

      setModelMenuStyle({
        position: "fixed",
        top: `${nextTop}px`,
        left: `${left}px`,
        width: `${width}px`,
        zIndex: 4000,
      });
    }

    const frameId = window.requestAnimationFrame(updateModelMenuPosition);
    window.addEventListener("resize", updateModelMenuPosition);
    window.addEventListener("scroll", updateModelMenuPosition, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateModelMenuPosition);
      window.removeEventListener("scroll", updateModelMenuPosition, true);
    };
  }, [modelMenuOpen]);

  if (!project) return null;

  function updateProjectState(updater) {
    setProjects((previousProjects) =>
      previousProjects.map((currentProject) =>
        currentProject.id === project.id ? updater(currentProject) : currentProject
      )
    );
  }

  function handleSelectChat(chatId) {
    updateProjectState((currentProject) => ({
      ...currentProject,
      activeChatId: chatId,
    }));
    setOpenChatMenuId(null);

    if (typeof onPersistProjectActiveChat === "function") {
      onPersistProjectActiveChat(project.id, chatId);
    }
  }

  function handleOpenChat(chat, linkedConversation) {
    const conversationKey = getConversationReference(chat, linkedConversation);
    if (
      conversationKey &&
      typeof onOpenProjectConversation === "function" &&
      onOpenProjectConversation(conversationKey)
    ) {
      handleSelectChat(chat.id);
      setOpenChatMenuId(null);
      return;
    }

    handleSelectChat(chat.id);
  }

  function handleRemoveChat(chatId) {
    updateProjectState((currentProject) => {
      const existingChats = Array.isArray(currentProject.chats) ? currentProject.chats : [];
      const nextChats = existingChats.filter((chat) => chat.id !== chatId);
      const nextActiveChatId =
        currentProject.activeChatId === chatId ? nextChats[0]?.id || null : currentProject.activeChatId;

      return {
        ...currentProject,
        chats: nextChats,
        chatsCount: nextChats.length,
        activeChatId: nextActiveChatId,
        updatedAt: new Date().toISOString(),
      };
    });
    setOpenChatMenuId(null);

    if (typeof onRemoveProjectChat === "function") {
      onRemoveProjectChat(project.id, chatId);
    }
  }

  function handleRenameConversation(chat, linkedConversation) {
    const conversationReference = getConversationReference(chat, linkedConversation);
    if (!conversationReference || typeof onRequestProjectConversationRename !== "function") {
      setOpenChatMenuId(null);
      return;
    }

    onRequestProjectConversationRename(conversationReference);
    setOpenChatMenuId(null);
  }

  function handleDeleteConversation(chat, linkedConversation) {
    const conversationReference = getConversationReference(chat, linkedConversation);
    if (!conversationReference || typeof onRequestProjectConversationDelete !== "function") {
      setOpenChatMenuId(null);
      return;
    }

    onRequestProjectConversationDelete(conversationReference);
    setOpenChatMenuId(null);
  }

  function handleOpenMoveProject(chatId) {
    setMoveProjectQuery("");
    setMoveChatId(chatId);
    setOpenChatMenuId(null);
  }

  function handleMoveChat(targetProjectId) {
    if (!moveChatId || !targetProjectId || targetProjectId === project.id) return;

    let movedConversationId = null;

    setProjects((previousProjects) => {
      const sourceProject = previousProjects.find((candidateProject) => candidateProject?.id === project.id);
      const targetProject = previousProjects.find((candidateProject) => candidateProject?.id === targetProjectId);
      const sourceChats = Array.isArray(sourceProject?.chats) ? sourceProject.chats : [];
      const chatToMove = sourceChats.find((chat) => chat.id === moveChatId);

      if (!sourceProject || !targetProject || !chatToMove) {
        return previousProjects;
      }

      movedConversationId = chatToMove.conversationId ?? null;

      const nextTimestamp = new Date().toISOString();

      return previousProjects.map((candidateProject) => {
        if (candidateProject?.id === project.id) {
          const nextChats = sourceChats.filter((chat) => chat.id !== moveChatId);
          const nextActiveChatId =
            candidateProject.activeChatId === moveChatId
              ? nextChats[0]?.id || null
              : candidateProject.activeChatId;

          return {
            ...candidateProject,
            chats: nextChats,
            chatsCount: nextChats.length,
            activeChatId: nextActiveChatId,
            updatedAt: nextTimestamp,
          };
        }

        if (candidateProject?.id === targetProjectId) {
          const targetChats = Array.isArray(candidateProject.chats) ? candidateProject.chats : [];
          const existingTargetChat = targetChats.find((chat) => matchesSameConversation(chat, chatToMove));
          const nextChats = existingTargetChat ? targetChats : [{ ...chatToMove }, ...targetChats];

          return {
            ...candidateProject,
            chats: nextChats,
            chatsCount: nextChats.length,
            activeChatId: existingTargetChat?.id || chatToMove.id,
            updatedAt: nextTimestamp,
          };
        }

        return candidateProject;
      });
    });

    setMoveChatId(null);
    setMoveProjectQuery("");

    if (movedConversationId && typeof onMoveProjectChat === "function") {
      onMoveProjectChat({
        sourceProjectId: project.id,
        targetProjectId,
        projectChatId: moveChatId,
        conversationId: movedConversationId,
      });
    }
  }

  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    let value = bytes;
    let index = 0;

    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }

    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function addFiles(fileList) {
    const incoming = Array.from(fileList || []);
    if (incoming.length === 0) return;

    setAttachments((previousAttachments) => {
      const remainingSlots = Math.max(0, messageAttachmentLimit - previousAttachments.length);
      if (remainingSlots <= 0) {
        showGlobalToast?.(`This plan allows up to ${messageAttachmentLimit} attachment${messageAttachmentLimit === 1 ? "" : "s"} per message.`);
        return previousAttachments;
      }

      const files = incoming.slice(0, Math.max(0, remainingSlots));
      if (files.length < incoming.length) {
        showGlobalToast?.(`You can attach up to ${messageAttachmentLimit} file${messageAttachmentLimit === 1 ? "" : "s"} per message on this plan.`);
      }

      const nextAttachments = files.map((file) => {
        const isImage = file.type?.startsWith("image/");
        const previewUrl = isImage ? URL.createObjectURL(file) : null;

        return {
          id:
            typeof crypto !== "undefined" && crypto.randomUUID
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

      return [...previousAttachments, ...nextAttachments];
    });

    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const {
    isDragActive: isComposerFileDragActive,
    dropTargetProps: composerFileDropProps,
  } = useFileDropTarget({
    onFiles: addFiles,
    disabled: !project,
  });

  const handleComposerPaste = async (event) => {
    const files = await extractTransferFiles(event.clipboardData);
    if (files.length === 0) return;

    event.preventDefault();
    addFiles(files);
  };

  function addProjectFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    if (projectFilesInputRef.current) projectFilesInputRef.current.value = "";

    const existingCount = Array.isArray(project?.files) ? project.files.length : 0;
    const remainingSlots = Math.max(0, projectFileLimit - existingCount);

    if (remainingSlots <= 0) {
      showGlobalToast?.(`This plan allows up to ${projectFileLimit} project files.`);
      return;
    }

    const acceptedFiles = files.slice(0, remainingSlots);

    if (acceptedFiles.length < files.length) {
      showGlobalToast?.(`You can add ${remainingSlots} more project file${remainingSlots === 1 ? "" : "s"} on this plan.`);
    }

    if (typeof onAddProjectFiles === "function") {
      void onAddProjectFiles(project.id, acceptedFiles);
    }
  }

  function removeProjectFile(fileId) {
    updateProjectState((currentProject) => {
      const existingFiles = Array.isArray(currentProject.files) ? currentProject.files : [];
      const fileToRemove = existingFiles.find((file) => file.id === fileId);

      if (fileToRemove?.previewUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(fileToRemove.previewUrl);
      }

      return {
        ...currentProject,
        files: existingFiles.filter((file) => file.id !== fileId),
        updatedAt: new Date().toISOString(),
      };
    });

    if (typeof onRemoveProjectFile === "function") {
      onRemoveProjectFile(project.id, fileId);
    }
  }

  function openInstructionsModal() {
    setInstructionsDraft(String(project.instructions || ""));
    setInstructionsModalOpen(true);
  }

  function handleSaveInstructions() {
    const nextInstructions = instructionsDraft.trim();
    const updatedAt = new Date().toISOString();

    updateProjectState((currentProject) => ({
      ...currentProject,
      instructions: nextInstructions,
      updatedAt,
    }));

    setInstructionsModalOpen(false);

    if (typeof onSaveProjectInstructions === "function") {
      onSaveProjectInstructions(project.id, nextInstructions);
    }
  }

  function removeAttachment(attachmentId) {
    setAttachments((previousAttachments) => {
      const attachment = previousAttachments.find((item) => item.id === attachmentId);
      if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      return previousAttachments.filter((item) => item.id !== attachmentId);
    });
  }

  function clearAttachments() {
    setAttachments((previousAttachments) => {
      previousAttachments.forEach((attachment) => {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      return [];
    });
  }

  function scheduleComposerViewportReveal() {
    focusViewportTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    focusViewportTimersRef.current = [];

    const revealComposer = () => {
      const shell = composerShellRef.current;
      if (!shell) return;

      try {
        shell.scrollIntoView({ block: "end", inline: "nearest" });
      } catch {
        // ignore scroll failures
      }
    };

    revealComposer();

    [80, 180, 320, 520].forEach((delay) => {
      const timerId = window.setTimeout(revealComposer, delay);
      focusViewportTimersRef.current.push(timerId);
    });
  }

  function handleDraftFocus() {
    if (typeof window === "undefined") return;
    scheduleComposerViewportReveal();
  }

  function handleDraftBlur() {
    focusViewportTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    focusViewportTimersRef.current = [];
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const text = draft.trim();
    if (!text && attachments.length === 0) return;

    const timestamp = new Date().toISOString();
    const conversationRefId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `project-chat-${Date.now()}-${Math.random()}`;
    const messageAttachments = attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      size: attachment.size,
      type: attachment.type,
      isImage: attachment.isImage,
    }));
    const conversationAttachments =
      typeof onCreateProjectConversation === "function"
        ? attachments.map((attachment) => ({
            id: attachment.id,
            name: attachment.name,
            size: attachment.size,
            type: attachment.type,
            isImage: attachment.isImage,
            previewUrl:
              attachment.isImage && attachment.file
                ? URL.createObjectURL(attachment.file)
                : null,
          }))
        : [];
    const nextTitle = DEFAULT_PROJECT_CHAT_TITLE;
    const createdConversation =
      typeof onCreateProjectConversation === "function"
        ? await onCreateProjectConversation({
            projectId: project.id,
            projectName: project.name,
            conversationRefId,
            title: nextTitle,
            text,
            attachments: conversationAttachments,
            modelId: activeModel,
            webSearchEnabled,
            reasoningEnabled,
          })
        : null;

    if (!createdConversation) {
      conversationAttachments.forEach((attachment) => {
        if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    flushSync(() => {
      updateProjectState((currentProject) => {
        const existingChats = Array.isArray(currentProject.chats) ? [...currentProject.chats] : [];
        const updatedChats = [
          {
            id:
              createdConversation?.projectChatId ||
              (typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random()}`),
            conversationId: createdConversation?.id ?? null,
            conversationRefId: createdConversation?.localKey || conversationRefId,
            title: nextTitle,
            messages: [
              {
                id:
                  typeof crypto !== "undefined" && crypto.randomUUID
                    ? crypto.randomUUID()
                    : `${Date.now()}-${Math.random()}`,
                role: "user",
                content: text,
                attachments: messageAttachments,
                createdAt: timestamp,
              },
            ],
            updatedAt: createdConversation?.updatedAt || timestamp,
          },
          ...existingChats,
        ].sort(
          (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );

        return {
          ...currentProject,
          chats: updatedChats,
          chatsCount: updatedChats.length,
          activeChatId: updatedChats[0]?.id || null,
          updatedAt: timestamp,
        };
      });
    });

    setDraft("");
    clearAttachments();
    if (typeof onActivateProjectConversation === "function") {
      onActivateProjectConversation({
        conversationId: createdConversation.id,
        mode: createdConversation.mode,
        modelId: createdConversation.modelId,
      });
      return;
    }
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  return (
    <div ref={workspaceRef} className="projects-workspace">
      <div className="projects-workspace__main">
        <button type="button" className="projects-workspace__back" onClick={onExitProject}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>All projects</span>
        </button>

        <header className="projects-workspace__header">
          <h1 className="projects-workspace__title">{project.name}</h1>
          {project.brief ? <p className="projects-workspace__brief">{project.brief}</p> : null}
        </header>

        <div ref={composerShellRef} className="chat-input-wrapper centered projects-view__composer-shell">
          <form onSubmit={handleSubmit} className="chat-input-form">
            <div
              className={`composer projects-view__composer${isComposerFileDragActive ? " composer-drag-active" : ""}`}
              {...composerFileDropProps}
            >
              {isComposerFileDragActive ? (
                <ComposerFileDropOverlay subtitle="They'll be attached to this project chat." />
              ) : null}
              <div className="composer-top">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onFocus={handleDraftFocus}
                  onBlur={handleDraftBlur}
                  className="composer-textarea"
                  placeholder="Ask anything..."
                  rows={1}
                  onPaste={handleComposerPaste}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      handleSubmit(event);
                    }
                  }}
                />
              </div>

              {attachments.length > 0 ? (
                <div className="composer-attachments-row">
                  {attachments.map((attachment) => (
                    <div key={attachment.id} className="attach-tile">
                      {attachment.isImage && attachment.previewUrl ? (
                        <img className="attach-thumb" src={attachment.previewUrl} alt={attachment.name} />
                      ) : (
                        <div className="attach-file-ico" aria-hidden="true">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth="1.5"
                            stroke="currentColor"
                            className="size-6"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                            />
                          </svg>
                        </div>
                      )}

                      <div className="attach-meta">
                        <div className="attach-name">{attachment.name}</div>
                        <div className="attach-sub">{formatBytes(attachment.size)}</div>
                      </div>

                      <button
                        type="button"
                        className="attach-x"
                        onClick={() => removeAttachment(attachment.id)}
                        aria-label="Remove attachment"
                        title="Remove"
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="composer-bottom">
                <div className="composer-tools" ref={composerToolsRef}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="composer-file"
                    multiple
                    onChange={(event) => addFiles(event.target.files)}
                  />

                  <button
                    type="button"
                    className="composer-attach composer-tools-trigger"
                    title="Tools"
                    aria-label="Tools"
                    aria-haspopup="menu"
                    aria-expanded={toolsMenuOpen}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setToolsMenuOpen((value) => !value);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path
                        d="M12 5v14M5 12h14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>

                  {webSearchEnabled ? (
                    <button
                      type="button"
                      className="tool-pill"
                      onClick={() => setWebSearchEnabled(false)}
                      title="Turn off Web Search"
                    >
                      <span className="tool-pill-ico" aria-hidden="true">
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
                            d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
                          />
                        </svg>
                      </span>
                      <span className="tool-pill-label">Web Search</span>
                      <span className="tool-pill-x" aria-hidden="true">
                        {"\u00D7"}
                      </span>
                    </button>
                  ) : null}

                  {reasoningEnabled ? (
                    <button
                      type="button"
                      className="tool-pill"
                      onClick={() => setReasoningEnabled(false)}
                      title="Turn Off Reasoning"
                    >
                      <span className="tool-pill-ico" aria-hidden="true">
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
                      <span className="tool-pill-label">Reasoning</span>
                      <span className="tool-pill-x" aria-hidden="true">
                        {"\u00D7"}
                      </span>
                    </button>
                  ) : null}

                  {toolsMenuOpen ? (
                    <div className="composer-tools-menu" role="menu" aria-label="Tools">
                      <button
                        type="button"
                        className="tools-item"
                        role="menuitem"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                      >
                        <span className="tools-item-left">
                          <span className="tools-item-ico" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="18" height="18">
                              <path
                                d="M12 5v14M5 12h14"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                              />
                            </svg>
                          </span>
                          Attach file
                        </span>
                      </button>

                      <div className="tools-divider" role="separator" aria-hidden="true" />

                      <button
                        type="button"
                        className="tools-item"
                        role="menuitemcheckbox"
                        aria-checked={webSearchEnabled}
                        onClick={handleToggleWebSearch}
                      >
                        <span className="tools-item-left">
                          <span className="tools-item-ico" aria-hidden="true">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              width="18"
                              height="18"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418"
                              />
                            </svg>
                          </span>
                          Web search
                        </span>
                        <span
                          className={"tools-switch" + (webSearchEnabled ? " on" : "")}
                          aria-hidden="true"
                        >
                          <span className="tools-switch-thumb" />
                        </span>
                      </button>

                      <button
                        type="button"
                        className="tools-item"
                        role="menuitemcheckbox"
                        aria-checked={reasoningEnabled}
                        onClick={handleToggleReasoning}
                      >
                        <span className="tools-item-left">
                          <span className="tools-item-ico" aria-hidden="true">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              width="18"
                              height="18"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
                              />
                            </svg>
                          </span>
                          Reasoning
                        </span>
                        <span
                          className={"tools-switch" + (reasoningEnabled ? " on" : "")}
                          aria-hidden="true"
                        >
                          <span className="tools-switch-thumb" />
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>

                <div className="composer-actions">
                  <div className="model-selector" ref={modelSelectorRef}>
                    <button
                      type="button"
                      className="model-trigger"
                      onClick={() => setModelMenuOpen((value) => !value)}
                      aria-haspopup="listbox"
                      aria-expanded={modelMenuOpen}
                    >
                      <img src={activeModelData.logo} alt="" className="model-logo" />
                      <span className="model-name">{activeModelData.name}</span>
                    </button>

                  </div>

                  <button
                    type="submit"
                    className="composer-send"
                    aria-label="Send"
                    title="Send"
                  >
                    <svg width="18" height="18" viewBox="0 0 27 24" aria-hidden="true">
                      <path d="M2 12L22 3L14 21L11 13L2 12Z" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>

        <section className="projects-workspace__chats">
          {chats.length ? (
            <div className="projects-workspace__chat-list">
              {chats.map((chat) => {
                const linkedConversation = findLinkedConversation(chat, conversations);
                const chatRecord = getChatRecord(chat, conversations);
                const isActive = chat.id === (activeChat?.id || null);
                const chatUpdatedAt = linkedConversation?.updatedAt || chat.updatedAt;
                const chatTitle = String(chatRecord?.title || chat.title || "New chat");

                return (
                  <article
                    key={chat.id}
                    className={`projects-workspace__chat-card${isActive ? " is-active" : ""}${openChatMenuId === chat.id ? " has-open-menu" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleOpenChat(chat, linkedConversation)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        handleOpenChat(chat, linkedConversation);
                      }
                    }}
                  >
                    <div className="projects-workspace__chat-top">
                      <div className="projects-workspace__chat-name">{chatTitle}</div>
                      <div className="projects-workspace__chat-actions">
                        <button
                          type="button"
                          className="chat-more-btn"
                          aria-label="Chat actions"
                          aria-expanded={openChatMenuId === chat.id}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setOpenChatMenuId((currentValue) => (currentValue === chat.id ? null : chat.id));
                          }}
                        >
                          <MoreHorizontal size={16} aria-hidden="true" />
                        </button>

                        {openChatMenuId === chat.id ? (
                          <>
                            <div
                              className="chat-menu-backdrop"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                                setOpenChatMenuId(null);
                              }}
                            />

                            <div
                              className="chat-menu projects-workspace__chat-menu"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => handleRenameConversation(chat, linkedConversation)}
                              >
                                <RenameMenuIcon className="menu-icon" aria-hidden="true" />
                                <span>Rename</span>
                              </button>

                              <button type="button" onClick={() => handleOpenMoveProject(chat.id)}>
                                <ChangeProjectMenuIcon className="menu-icon" aria-hidden="true" />
                                <span>Change project</span>
                              </button>

                              <button type="button" onClick={() => handleRemoveChat(chat.id)}>
                                <RemoveFromProjectMenuIcon className="menu-icon" aria-hidden="true" />
                                <span>Remove from project</span>
                              </button>

                              <div className="projects-workspace__chat-menu-divider" aria-hidden="true" />

                              <button
                                type="button"
                                className="danger"
                                onClick={() => handleDeleteConversation(chat, linkedConversation)}
                              >
                                <DeleteMenuIcon className="menu-icon" aria-hidden="true" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <p className="projects-workspace__chat-subtitle">
                      {formatLastMessageTime(chatUpdatedAt)}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="projects-workspace__chat-empty">
              Start a conversation above to keep project chats organized below the composer.
            </div>
          )}
        </section>
      </div>

      <aside className="projects-workspace__side">
          <section className="projects-workspace__panel projects-workspace__panel--instructions">
            <div className="projects-workspace__panel-head">
              <h2>Instructions</h2>
              <button
                type="button"
                className="projects-workspace__panel-plus"
                aria-label={project.instructions ? "Edit project instructions" : "Add project instructions"}
                title={project.instructions ? "Edit project instructions" : "Add project instructions"}
                onClick={openInstructionsModal}
              >
                {project.instructions ? <Pencil size={15} /> : <Plus size={16} />}
              </button>
            </div>

            <p
              className={
                "projects-workspace__panel-copy" +
                (project.instructions ? " projects-workspace__panel-copy--clamped" : "")
              }
            >
              {project.instructions
                ? getInstructionsPreview(project.instructions)
                : "Add project instructions to guide future responses in this space."}
            </p>
          </section>

          <section className="projects-workspace__panel projects-workspace__panel--files">
            <div className="projects-workspace__panel-head">
              <h2>Files</h2>
              <button
                type="button"
                className="projects-workspace__panel-plus"
                aria-label="Add project files"
                title="Add project files"
                onClick={() => projectFilesInputRef.current?.click()}
              >
                <Plus size={16} />
              </button>
            </div>

            <input
              ref={projectFilesInputRef}
              type="file"
              className="composer-file"
              multiple
              onChange={(event) => addProjectFiles(event.target.files)}
            />

            {isUploadingProjectFiles ? (
              <div className="projects-workspace__files-loading" role="status" aria-live="polite">
                <span>Loading files...</span>
              </div>
            ) : null}

            {Array.isArray(project.files) && project.files.length > 0 ? (
              <div className="projects-workspace__file-list">
                {project.files.map((file, index) => (
                  <ProjectFileTile
                    key={file?.id || `${file?.name || "file"}-${index}`}
                    file={file}
                    onRemove={removeProjectFile}
                    formatBytes={formatBytes}
                  />
                ))}
              </div>
            ) : (
              <div className="projects-workspace__files-empty">
                <FolderOutlineIcon />
                <p>Add PDFs, documents, or reference files for this project.</p>
              </div>
            )}
          </section>
      </aside>

      {modelMenuOpen && modelMenuStyle
        ? createPortal(
            <div
              ref={modelMenuRef}
              className="model-menu projects-view__model-menu"
              style={modelMenuStyle}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="model-menu-head">
                <input
                  className="model-search"
                  value={modelQuery}
                  onChange={(event) => setModelQuery(event.target.value)}
                  placeholder="Search model"
                  autoFocus={shouldAutoFocusOverlayInputs}
                />
              </div>

              <div className="model-menu-list">
                {bestAutoModel ? (
                  <>
                    <button
                      type="button"
                      className={`model-item ${bestAutoModel.id === activeModel ? "active" : ""}`}
                      onClick={() => {
                        setActiveModel(bestAutoModel.id);
                        setModelMenuOpen(false);
                        setModelQuery("");
                      }}
                    >
                      <img src={bestAutoModel.logo} alt="" />
                      <span className="model-item-main">
                        <span className="model-item-name">{bestAutoModel.name}</span>
                      </span>
                    </button>
                    <div className="model-auto-note">Choose the best model for each task.</div>
                    <div className="model-menu-separator" aria-hidden="true" />
                  </>
                ) : null}

                {standardFilteredModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    className={`model-item ${model.id === activeModel ? "active" : ""}`}
                    onClick={() => {
                      setActiveModel(model.id);
                      setModelMenuOpen(false);
                      setModelQuery("");
                    }}
                  >
                    <img src={model.logo} alt="" />
                    <span className="model-item-main">
                      <span className="model-item-name">{model.name}</span>
                      {NEW_MODEL_BADGE_IDS.has(model.id) ? (
                        <span className="model-badge model-badge-new">
                          <svg viewBox="0 0 24 24" aria-hidden="true" className="model-badge-icon">
                            <path
                              d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                          <span>NEW</span>
                        </span>
                      ) : null}
                    </span>
                  </button>
                ))}

                {filteredModels.length === 0 ? <div className="model-empty">No results</div> : null}
              </div>
            </div>,
            document.body
          )
        : null}

      {instructionsModalOpen
        ? createPortal(
            <div
              className="projects-modal-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setInstructionsModalOpen(false);
                }
              }}
            >
              <div className="projects-modal projects-modal--instructions" onMouseDown={(event) => event.stopPropagation()}>
                <div className="projects-modal__header">
                  <div className="projects-modal__heading">
                    <h2 className="projects-modal__title">Project instructions</h2>
                    <p className="projects-modal__copy">
                      Add context, tone, or guidance for replies inside this project.
                    </p>
                  </div>
                </div>

                <div className="projects-modal__body">
                  <div className="projects-modal__field projects-modal__field--solo">
                    <textarea
                      value={instructionsDraft}
                      onChange={(event) => setInstructionsDraft(event.target.value)}
                      placeholder="Add instructions for this project..."
                    />
                  </div>
                </div>

                <div className="projects-modal__footer">
                  <button
                    type="button"
                    className="projects-modal__button ghost"
                    onClick={() => setInstructionsModalOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="projects-modal__button solid"
                    onClick={handleSaveInstructions}
                  >
                    Save instructions
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}

      {moveChat
        ? createPortal(
            <div
              className="projects-modal-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setMoveChatId(null);
                  setMoveProjectQuery("");
                }
              }}
            >
              <div
                className="projects-modal projects-modal--move"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="projects-modal__header">
                  <div className="projects-modal__heading">
                    <h2 className="projects-modal__title">Move chat</h2>
                    <p className="projects-modal__copy">
                      This chat is in {project.name}. Select a different project below.
                    </p>
                  </div>

                  <button
                    type="button"
                    className="projects-modal__close"
                    onClick={() => {
                      setMoveChatId(null);
                      setMoveProjectQuery("");
                    }}
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="projects-modal__body projects-modal__body--move">
                  <div className="projects-move-chat-modal__picker">
                    <label className="projects-move-chat-modal__search">
                      <Search size={18} aria-hidden="true" />
                      <input
                        type="text"
                        value={moveProjectQuery}
                        onChange={(event) => setMoveProjectQuery(event.target.value)}
                        placeholder="Search or choose a project"
                        autoFocus={shouldAutoFocusOverlayInputs}
                      />
                    </label>

                    <div className="projects-move-chat-modal__results">
                      {filteredMoveProjects.length ? (
                        filteredMoveProjects.map((candidateProject) => (
                          <button
                            key={candidateProject.id}
                            type="button"
                            className="projects-move-chat-modal__project"
                            onClick={() => handleMoveChat(candidateProject.id)}
                          >
                            <span className="projects-move-chat-modal__project-name">
                              {candidateProject.name}
                            </span>
                            <span className="projects-move-chat-modal__project-meta">
                              {formatProjectUpdatedTime(candidateProject.updatedAt)}
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="projects-move-chat-modal__empty">
                          {availableProjects.length
                            ? "No projects found"
                            : "No other projects available"}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
