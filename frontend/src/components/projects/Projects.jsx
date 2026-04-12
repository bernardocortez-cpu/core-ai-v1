import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MoreHorizontal, Pencil, Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import ProjectModal from "./ProjectModal";
import ProjectView from "./ProjectView";
import "./Projects.css";
import {
  PROJECTS_STORAGE_UPDATED_EVENT,
  attachConversationToProjectRequest,
  createProjectRequest,
  deleteProjectFileRequest,
  deleteProjectRequest,
  fileToDataUrl,
  loadProjectsFromApi,
  patchProjectRequest,
  readStoredProjectsIndex,
  removeConversationFromProjectRequest,
  sortProjectTargets,
  uploadProjectFileRequest,
  writeStoredProjectsIndex,
} from "../../services/projects";

function findLinkedConversation(chat, conversations) {
  if (!chat || !Array.isArray(conversations) || conversations.length === 0) return null;

  return (
    conversations.find((conversation) => {
      if (chat.conversationRefId && conversation?.localKey === chat.conversationRefId) return true;
      return chat.conversationId != null && conversation?.id === chat.conversationId;
    }) || null
  );
}

function toProjectTimestamp(value) {
  if (!value) return null;
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return null;
}

function sortProjectChats(chats) {
  return [...(Array.isArray(chats) ? chats : [])].sort(
    (left, right) =>
      new Date(right?.updatedAt || 0).getTime() - new Date(left?.updatedAt || 0).getTime()
  );
}

function formatProjectTime(timestamp) {
  if (!timestamp) return "Updated just now";

  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) return `Updated ${diffMinutes} min ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `Updated ${diffHours} h ago`;

  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays} d ago`;
}

function normalizeProjectPlan(plan) {
  const raw = String(plan || "").trim().toLowerCase();
  if (!raw) return "FREE";
  if (raw === "plus" || raw === "premium" || raw.includes("plus") || raw.includes("premium")) return "PREMIUM";
  if (raw === "max" || raw.includes("max")) return "MAX";
  if (raw === "pro" || raw.includes("pro")) return "PRO";
  return "FREE";
}

function getProjectFileLimit(plan) {
  const normalizedPlan = normalizeProjectPlan(plan);
  if (normalizedPlan === "MAX") return 50;
  if (normalizedPlan === "PREMIUM") return 30;
  if (normalizedPlan === "PRO") return 20;
  return 5;
}

function getMessageAttachmentLimit(plan) {
  const normalizedPlan = normalizeProjectPlan(plan);
  return normalizedPlan === "FREE" ? 2 : 10;
}

function ProjectsEmptyIcon() {
  return (
    <svg
      className="projects-empty-icon"
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

export default function Projects({
  conversations = [],
  isAuthenticated = false,
  currentPlan = "FREE",
  showGlobalToast,
  onOpenPlan,
  onRequireAuth,
  onCreateProjectConversation,
  onActivateProjectConversation,
  onOpenProjectConversation,
  onRequestProjectConversationRename,
  onRequestProjectConversationDelete,
}) {
  const [projects, setProjectsState] = useState(() => readStoredProjectsIndex());
  const projectsRef = useRef(projects);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createModalKey, setCreateModalKey] = useState(0);
  const [editingProjectId, setEditingProjectId] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [uploadingProjectFileCounts, setUploadingProjectFileCounts] = useState({});
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const isFreePlan = useMemo(() => normalizeProjectPlan(currentPlan) === "FREE", [currentPlan]);
  const projectFileLimit = useMemo(() => getProjectFileLimit(currentPlan), [currentPlan]);
  const messageAttachmentLimit = useMemo(() => getMessageAttachmentLimit(currentPlan), [currentPlan]);
  const projectsPageRef = useRef(null);
  const searchInputRef = useRef(null);
  const searchViewportGuardActiveRef = useRef(false);
  const searchViewportGuardRafRef = useRef(0);
  const searchViewportGuardTimersRef = useRef([]);
  const searchViewportGuardCloseTimerRef = useRef(0);
  const searchViewportGuardListenersRef = useRef(null);
  const searchScrollContainerRef = useRef(null);
  const searchScrollTopRef = useRef(0);
  const searchWindowScrollTopRef = useRef(0);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const refreshProjects = useCallback(async () => {
    if (!isAuthenticated) {
      const clearedProjects = writeStoredProjectsIndex([]);
      projectsRef.current = clearedProjects;
      setProjectsState(clearedProjects);
      return clearedProjects;
    }

    try {
      const nextProjects = await loadProjectsFromApi();
      projectsRef.current = nextProjects;
      setProjectsState(nextProjects);
      return nextProjects;
    } catch (error) {
      console.error("Erro a carregar projetos:", error);
      return projectsRef.current;
    }
  }, [isAuthenticated]);

  const clearSearchViewportRestoreJobs = useCallback(() => {
    if (typeof window === "undefined") return;

    if (searchViewportGuardRafRef.current) {
      window.cancelAnimationFrame(searchViewportGuardRafRef.current);
      searchViewportGuardRafRef.current = 0;
    }

    searchViewportGuardTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    searchViewportGuardTimersRef.current = [];
  }, []);

  const clearSearchViewportGuardTimers = useCallback(() => {
    if (typeof window === "undefined") return;

    clearSearchViewportRestoreJobs();

    if (searchViewportGuardCloseTimerRef.current) {
      window.clearTimeout(searchViewportGuardCloseTimerRef.current);
      searchViewportGuardCloseTimerRef.current = 0;
    }
  }, [clearSearchViewportRestoreJobs]);

  const clearSearchViewportGuard = useCallback(() => {
    if (typeof window === "undefined") return;

    clearSearchViewportGuardTimers();

    const listenerState = searchViewportGuardListenersRef.current;
    if (listenerState) {
      const { schedule, visualViewport: viewport, container } = listenerState;
      if (viewport) {
        viewport.removeEventListener("resize", schedule);
        viewport.removeEventListener("scroll", schedule);
      }
      if (container) {
        container.removeEventListener("scroll", schedule);
      }
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      searchViewportGuardListenersRef.current = null;
    }

    searchViewportGuardActiveRef.current = false;
    searchScrollContainerRef.current = null;
  }, [clearSearchViewportGuardTimers]);

  const shouldStabilizeSearchViewport = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    if (!window.matchMedia("(max-width: 1366px)").matches) return false;
    if (typeof navigator === "undefined") return false;

    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";

    return (
      /iPad|iPhone|iPod/.test(ua) ||
      (platform === "MacIntel" &&
        typeof navigator.maxTouchPoints === "number" &&
        navigator.maxTouchPoints > 1)
    );
  }, []);

  const resolveSearchScrollContainer = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return null;
    return input.closest(".chat-main-body");
  }, []);

  const restoreSearchScrollPosition = useCallback(() => {
    const container = searchScrollContainerRef.current;
    if (typeof window !== "undefined") {
      const targetWindowScrollTop = searchWindowScrollTopRef.current;
      if (Math.abs(window.scrollY - targetWindowScrollTop) >= 1) {
        window.scrollTo(0, targetWindowScrollTop);
      }
    }

    if (!container) return;

    const targetScrollTop = searchScrollTopRef.current;
    if (Math.abs(container.scrollTop - targetScrollTop) < 1) return;

    container.scrollTop = targetScrollTop;
  }, []);

  const scheduleSearchViewportRestore = useCallback(
    (delays = []) => {
      if (typeof window === "undefined" || !searchViewportGuardActiveRef.current) return;

      clearSearchViewportRestoreJobs();

      const keepLocked = () => {
        if (!searchViewportGuardActiveRef.current) {
          searchViewportGuardRafRef.current = 0;
          return;
        }

        restoreSearchScrollPosition();
        searchViewportGuardRafRef.current = window.requestAnimationFrame(keepLocked);
      };

      searchViewportGuardRafRef.current = window.requestAnimationFrame(keepLocked);

      searchViewportGuardTimersRef.current = delays.map((delay) =>
        window.setTimeout(() => {
          restoreSearchScrollPosition();
        }, delay)
      );
    },
    [clearSearchViewportRestoreJobs, restoreSearchScrollPosition]
  );

  const setProjects = useCallback((updater) => {
    const nextProjects =
      typeof updater === "function" ? updater(projectsRef.current) : updater;

    const normalizedProjects = writeStoredProjectsIndex(nextProjects);
    projectsRef.current = normalizedProjects;
    setProjectsState(normalizedProjects);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setActiveProjectId(null);
      return;
    }

    void refreshProjects();
  }, [isAuthenticated, refreshProjects]);

  useEffect(() => {
    function handleProjectsStorageUpdated() {
      const nextProjects = readStoredProjectsIndex();
      projectsRef.current = nextProjects;
      setProjectsState(nextProjects);
    }

    window.addEventListener(PROJECTS_STORAGE_UPDATED_EVENT, handleProjectsStorageUpdated);
    return () => window.removeEventListener(PROJECTS_STORAGE_UPDATED_EVENT, handleProjectsStorageUpdated);
  }, []);

  useEffect(() => {
    if (!Array.isArray(conversations) || conversations.length === 0) return;

    setProjects((previousProjects) => {
      let hasChanges = false;

      const nextProjects = previousProjects.map((project) => {
        const projectChats = Array.isArray(project?.chats) ? project.chats : [];
        let projectChanged = false;

        const syncedChats = projectChats.map((chat) => {
          const linkedConversation = findLinkedConversation(chat, conversations);
          if (!linkedConversation) return chat;

          const nextTitle =
            typeof linkedConversation.title === "string" && linkedConversation.title.trim()
              ? linkedConversation.title
              : chat.title;
          const nextConversationId = linkedConversation.id ?? chat.conversationId ?? null;
          const nextUpdatedAt = toProjectTimestamp(linkedConversation.updatedAt) || chat.updatedAt;

          if (
            nextTitle === chat.title &&
            nextConversationId === chat.conversationId &&
            nextUpdatedAt === chat.updatedAt
          ) {
            return chat;
          }

          hasChanges = true;
          projectChanged = true;

          return {
            ...chat,
            title: nextTitle,
            conversationId: nextConversationId,
            updatedAt: nextUpdatedAt,
          };
        });

        const orderedChats = sortProjectChats(syncedChats);
        const orderChanged = orderedChats.some(
          (chat, index) => chat.id !== syncedChats[index]?.id
        );

        if (!projectChanged && !orderChanged) return project;

        hasChanges = true;

        return {
          ...project,
          chats: orderedChats,
        };
      });

      return hasChanges ? nextProjects : previousProjects;
    });
  }, [conversations, setProjects]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = deferredSearchQuery.trim().toLowerCase();

    const visibleProjects = normalizedQuery
      ? projects.filter((project) => {
          const name = String(project.name || "").toLowerCase();
          const brief = String(project.brief || "").toLowerCase();
          return name.includes(normalizedQuery) || brief.includes(normalizedQuery);
        })
      : projects;

    return sortProjectTargets(visibleProjects);
  }, [projects, deferredSearchQuery]);

  useLayoutEffect(() => {
    if (!searchViewportGuardActiveRef.current) return;
    restoreSearchScrollPosition();
  }, [searchQuery, deferredSearchQuery, filteredProjects.length, restoreSearchScrollPosition]);

  useEffect(() => () => clearSearchViewportGuard(), [clearSearchViewportGuard]);

  useEffect(() => {
    const page = projectsPageRef.current;
    const container = page?.closest(".chat-main-body");
    if (!container) return;

    container.classList.add("chat-main-body--projects");
    return () => {
      container.classList.remove("chat-main-body--projects");
    };
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) return;
    if (projects.some((project) => project.id === activeProjectId)) return;
    setActiveProjectId(null);
  }, [activeProjectId, projects]);

  function handleSearchFocus() {
    if (!shouldStabilizeSearchViewport()) return;

    const container = resolveSearchScrollContainer();
    if (!container) return;

    clearSearchViewportGuard();

    searchViewportGuardActiveRef.current = true;
    searchScrollContainerRef.current = container;
    searchScrollTopRef.current = container.scrollTop;
    searchWindowScrollTopRef.current = typeof window !== "undefined" ? window.scrollY : 0;

    const schedule = () => {
      scheduleSearchViewportRestore([96, 220, 360]);
    };

    const visualViewport = window.visualViewport;
    if (visualViewport) {
      visualViewport.addEventListener("resize", schedule);
      visualViewport.addEventListener("scroll", schedule);
    }
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    container.addEventListener("scroll", schedule, { passive: true });

    searchViewportGuardListenersRef.current = {
      schedule,
      visualViewport,
      container,
    };

    schedule();
  }

  function handleSearchBlur() {
    if (!searchViewportGuardActiveRef.current || typeof window === "undefined") return;

    if (searchViewportGuardCloseTimerRef.current) {
      window.clearTimeout(searchViewportGuardCloseTimerRef.current);
      searchViewportGuardCloseTimerRef.current = 0;
    }

    scheduleSearchViewportRestore([0, 120, 260, 420]);
    searchViewportGuardCloseTimerRef.current = window.setTimeout(() => {
      restoreSearchScrollPosition();
      clearSearchViewportGuard();
    }, 520);
  }

  function requireProjectsAuth() {
    if (isAuthenticated) return true;
    onRequireAuth?.();
    return false;
  }

  async function handleCreateProject(payload) {
    if (!requireProjectsAuth()) return;

    try {
      const createdProject = await createProjectRequest(payload);

      setProjects((previousProjects) =>
        sortProjectTargets([
          createdProject,
          ...previousProjects.filter((project) => project.id !== createdProject.id),
        ])
      );

      return createdProject;
    } catch (error) {
      console.error("Erro a criar projeto:", error);
      throw error;
    } finally {
      await refreshProjects();
    }
  }

  function handleToggleProjectPin(projectId) {
    if (!requireProjectsAuth()) return;

    const project = projectsRef.current.find((item) => item.id === projectId);
    if (!project) return;

    setProjects((previousProjects) =>
      previousProjects.map((project) => {
        if (project.id !== projectId) return project;

        return {
          ...project,
          pinned: !project.pinned,
        };
      })
    );

    setOpenMenuId(null);

    void patchProjectRequest(projectId, { pinned: !project.pinned })
      .catch((error) => {
        console.error("Erro a atualizar pin do projeto:", error);
      })
      .finally(() => {
        void refreshProjects();
      });
  }

  function handleOpenEditProject(projectId) {
    setEditingProjectId(projectId);
    setOpenMenuId(null);
  }

  async function handleUpdateProject(payload) {
    if (!editingProjectId || !requireProjectsAuth()) return;

    const projectId = editingProjectId;
    const timestamp = new Date().toISOString();

    setProjects((previousProjects) =>
      previousProjects.map((project) => {
        if (project.id !== projectId) return project;

        return {
          ...project,
          name: payload.name,
          brief: payload.brief,
          updatedAt: timestamp,
        };
      })
    );

    try {
      const updatedProject = await patchProjectRequest(projectId, payload);

      setProjects((previousProjects) =>
        previousProjects.map((project) => (project.id === projectId ? updatedProject : project))
      );
      setEditingProjectId(null);
      return updatedProject;
    } catch (error) {
      console.error("Erro a atualizar projeto:", error);
      throw error;
    } finally {
      void refreshProjects();
    }
  }

  function handleDeleteProject(projectId) {
    if (!requireProjectsAuth()) return;

    setProjects((previousProjects) => previousProjects.filter((project) => project.id !== projectId));
    setOpenMenuId(null);

    void deleteProjectRequest(projectId)
      .catch((error) => {
        console.error("Erro a apagar projeto:", error);
      })
      .finally(() => {
        void refreshProjects();
      });
  }

  function handlePersistProjectActiveChat(projectId, chatId) {
    if (!isAuthenticated) return;

    void patchProjectRequest(projectId, { activeChatId: chatId })
      .catch((error) => {
        console.error("Erro a guardar chat ativo do projeto:", error);
        void refreshProjects();
      });
  }

  function handleSaveProjectInstructions(projectId, instructions) {
    if (!isAuthenticated) return;

    void patchProjectRequest(projectId, { instructions })
      .catch((error) => {
        console.error("Erro a guardar instrucoes do projeto:", error);
      })
      .finally(() => {
        void refreshProjects();
      });
  }

  function handleRemoveProjectChat(projectId, chatId) {
    if (!isAuthenticated) return;

    void removeConversationFromProjectRequest({ projectId, projectChatId: chatId })
      .catch((error) => {
        console.error("Erro a remover chat do projeto:", error);
      })
      .finally(() => {
        void refreshProjects();
      });
  }

  function handleMoveProjectChat({ conversationId, targetProjectId }) {
    if (!isAuthenticated || !conversationId || !targetProjectId) return;

    void attachConversationToProjectRequest({
      projectId: targetProjectId,
      conversationId,
    })
      .catch((error) => {
        console.error("Erro a mover chat entre projetos:", error);
      })
      .finally(() => {
        void refreshProjects();
      });
  }

  async function handleAddProjectFiles(projectId, files) {
    if (!requireProjectsAuth()) return;

    const incomingFiles = Array.from(files || []);
    if (incomingFiles.length === 0) return;

    const currentProject =
      projectsRef.current.find((project) => project.id === projectId) ||
      readStoredProjectsIndex().find((project) => project.id === projectId) ||
      null;
    const existingCount = Array.isArray(currentProject?.files) ? currentProject.files.length : 0;
    const remainingSlots = Math.max(0, projectFileLimit - existingCount);

    if (remainingSlots <= 0) {
      showGlobalToast?.(`This plan allows up to ${projectFileLimit} project files.`);
      return;
    }

    const acceptedFiles = incomingFiles.slice(0, remainingSlots);

    if (acceptedFiles.length < incomingFiles.length) {
      showGlobalToast?.(`You can add ${remainingSlots} more project file${remainingSlots === 1 ? "" : "s"} on this plan.`);
    }

    setUploadingProjectFileCounts((currentValue) => ({
      ...currentValue,
      [projectId]: Math.max(0, Number(currentValue?.[projectId] || 0)) + 1,
    }));

    try {
      for (const file of acceptedFiles) {
        const dataUrl = await fileToDataUrl(file);
        await uploadProjectFileRequest({
          projectId,
          name: file.name,
          type: file.type,
          size: file.size,
          dataUrl,
        });
      }
    } catch (error) {
      console.error("Erro a carregar ficheiros do projeto:", error);
      if (error?.message === "PROJECT_FILE_LIMIT_REACHED") {
        const limit = Number(error?.details?.limit) || projectFileLimit;
        showGlobalToast?.(`This plan allows up to ${limit} project files.`);
      } else if (error?.message === "PROJECT_FILE_TOO_LARGE") {
        showGlobalToast?.("One project file is larger than 5 MB.");
      } else {
        showGlobalToast?.("Could not upload the project file.");
      }
    } finally {
      setUploadingProjectFileCounts((currentValue) => {
        const nextCount = Math.max(0, Number(currentValue?.[projectId] || 0) - 1);
        if (nextCount <= 0) {
          const nextValue = { ...currentValue };
          delete nextValue[projectId];
          return nextValue;
        }
        return {
          ...currentValue,
          [projectId]: nextCount,
        };
      });
    }

    await refreshProjects();
  }

  function handleRemoveProjectFile(projectId, fileId) {
    if (!isAuthenticated || !fileId) return;

    void deleteProjectFileRequest({ projectId, fileId })
      .catch((error) => {
        console.error("Erro a remover ficheiro do projeto:", error);
      })
      .finally(() => {
        void refreshProjects();
      });
  }

  function handleOpenProject(projectId) {
    setActiveProjectId(projectId);
    setOpenMenuId(null);
  }

  function openCreateModal() {
    setCreateModalKey((currentValue) => currentValue + 1);
    setIsCreateModalOpen(true);
  }

  const editingProject = projects.find((project) => project.id === editingProjectId) || null;
  const activeProject = projects.find((project) => project.id === activeProjectId) || null;
  const isUploadingActiveProjectFiles =
    activeProject && Number(uploadingProjectFileCounts?.[activeProject.id] || 0) > 0;
  const hasProjects = projects.length > 0;
  const hasFilteredProjects = filteredProjects.length > 0;
  const isSearching = deferredSearchQuery.trim().length > 0;

  return (
    <>
      {!isAuthenticated ? (
        <div className="projects-page" ref={projectsPageRef}>
          <div className="projects-page__content">
            <div className="projects-empty">
              <ProjectsEmptyIcon />
              <h2 className="projects-empty__title">Log in to use projects</h2>
              <p className="projects-empty__copy">
                Access your projects from anywhere. Your work syncs seamlessly across all your devices.
              </p>
              <button type="button" className="projects-empty__action" onClick={() => onRequireAuth?.()}>
                <Plus size={18} aria-hidden="true" />
                <span>Log in</span>
              </button>
            </div>
          </div>
        </div>
      ) : activeProject ? (
        <ProjectView
          projects={projects}
          project={activeProject}
          projectFileLimit={projectFileLimit}
          messageAttachmentLimit={messageAttachmentLimit}
          isFreePlan={isFreePlan}
          isUploadingProjectFiles={Boolean(isUploadingActiveProjectFiles)}
          setProjects={setProjects}
          conversations={conversations}
          showGlobalToast={showGlobalToast}
          onOpenPlan={onOpenPlan}
          onCreateProjectConversation={onCreateProjectConversation}
          onActivateProjectConversation={onActivateProjectConversation}
          onOpenProjectConversation={onOpenProjectConversation}
          onRequestProjectConversationRename={onRequestProjectConversationRename}
          onRequestProjectConversationDelete={onRequestProjectConversationDelete}
          onPersistProjectActiveChat={handlePersistProjectActiveChat}
          onSaveProjectInstructions={handleSaveProjectInstructions}
          onRemoveProjectChat={handleRemoveProjectChat}
          onMoveProjectChat={handleMoveProjectChat}
          onAddProjectFiles={handleAddProjectFiles}
          onRemoveProjectFile={handleRemoveProjectFile}
          onExitProject={() => setActiveProjectId(null)}
        />
      ) : (
        <div className="projects-page" ref={projectsPageRef}>
          <div className="projects-page__sticky">
            <div className="projects-page__head">
              <h1 className="projects-page__title">Projects</h1>

              <button
                type="button"
                className="projects-page__create"
                onClick={openCreateModal}
              >
                <Plus size={18} aria-hidden="true" />
                <span>New project</span>
              </button>
            </div>

            <div className="projects-toolbar">
              <label className="projects-search">
                <Search size={18} aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onFocus={handleSearchFocus}
                  onBlur={handleSearchBlur}
                  placeholder="Search projects..."
                />
              </label>
            </div>
          </div>

          <div className="projects-page__content">
            {!hasProjects ? (
              <div className="projects-empty">
                <ProjectsEmptyIcon />
                <h2 className="projects-empty__title">Want to start a project?</h2>
                <p className="projects-empty__copy">
                  Organize conversations, context, and instructions in one place while keeping the Core
                  visual language.
                </p>

                <button
                  type="button"
                  className="projects-empty__action"
                  onClick={openCreateModal}
                >
                  <Plus size={18} aria-hidden="true" />
                  <span>New project</span>
                </button>
              </div>
            ) : hasFilteredProjects ? (
              <div className="projects-grid">
                {filteredProjects.map((project) => {
                  const projectBrief = String(project.brief || "").trim();
                  const chatsCount = Array.isArray(project.chats)
                    ? project.chats.length
                    : Number(project.chatsCount || 0);

                  return (
                    <article
                      key={project.id}
                      className={`projects-card projects-card--interactive${openMenuId === project.id ? " has-open-menu" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleOpenProject(project.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleOpenProject(project.id);
                        }
                      }}
                    >
                      <div className="projects-card__head">
                        <div className="projects-card__title-wrap">
                          <div className="projects-card__name">{project.name}</div>
                          <div className="projects-card__time">{formatProjectTime(project.updatedAt)}</div>
                        </div>

                        <div className="projects-card__actions">
                          <button
                            type="button"
                            className="chat-more-btn"
                            aria-label="Project actions"
                            aria-expanded={openMenuId === project.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenMenuId((currentValue) =>
                                currentValue === project.id ? null : project.id
                              );
                            }}
                          >
                            <MoreHorizontal size={16} aria-hidden="true" />
                          </button>

                          {openMenuId === project.id ? (
                            <>
                              <div
                                className="chat-menu-backdrop"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setOpenMenuId(null);
                                }}
                              />

                              <div
                                className="chat-menu projects-card__menu"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <button
                                  type="button"
                                  onClick={() => handleOpenEditProject(project.id)}
                                >
                                  <Pencil size={16} className="menu-icon" />
                                  <span>Edit project</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleToggleProjectPin(project.id)}
                                >
                                  {project.pinned ? (
                                    <PinOff size={16} className="menu-icon" />
                                  ) : (
                                    <Pin size={16} className="menu-icon" />
                                  )}
                                  <span>{project.pinned ? "Unpin project" : "Pin project"}</span>
                                </button>

                                <div className="chat-menu-divider" aria-hidden="true" />

                                <button
                                  type="button"
                                  className="danger"
                                  onMouseDown={(event) => event.preventDefault()}
                                  onClick={() => handleDeleteProject(project.id)}
                                >
                                  <Trash2 size={16} className="menu-icon" />
                                  <span>Delete project</span>
                                </button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      </div>

                      {projectBrief ? <p className="projects-card__brief">{projectBrief}</p> : null}

                      <div className="projects-card__meta">
                        {project.pinned ? <span>Pinned</span> : null}
                        <span>{chatsCount} chat{chatsCount === 1 ? "" : "s"}</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="projects-empty projects-empty--results">
                <ProjectsEmptyIcon />
                <h2 className="projects-empty__title">No projects found</h2>
                <p className="projects-empty__copy">
                  Refine your search or create a new project to continue.
                </p>
              </div>
            )}

            {isSearching && hasFilteredProjects ? (
              <div className="projects-search-feedback">
                {filteredProjects.length} result{filteredProjects.length > 1 ? "s" : ""} for "
                {deferredSearchQuery.trim()}"
              </div>
            ) : null}
          </div>
        </div>
      )}

      <ProjectModal
        key={`create-${createModalKey}`}
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSubmit={handleCreateProject}
      />

      <ProjectModal
        key={editingProject ? `edit-${editingProject.id}` : "edit-closed"}
        isOpen={Boolean(editingProject)}
        project={editingProject}
        onClose={() => setEditingProjectId(null)}
        onSubmit={handleUpdateProject}
      />
    </>
  );
}
