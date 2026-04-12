import { api, resolveApiUrl } from "./api";

export const PROJECTS_STORAGE_KEY = "coreai_projects_index_v1";
export const PROJECTS_STORAGE_UPDATED_EVENT = "coreai:projects-storage-updated";

function safeDispatchProjectsUpdated() {
  try {
    window.dispatchEvent(new CustomEvent(PROJECTS_STORAGE_UPDATED_EVENT));
  } catch {
    // ignore
  }
}

export function createProjectLinkId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function sortProjectTargets(projects) {
  return [...(Array.isArray(projects) ? projects : [])].sort((left, right) => {
    const leftPinned = left?.pinned ? 1 : 0;
    const rightPinned = right?.pinned ? 1 : 0;

    if (leftPinned !== rightPinned) return rightPinned - leftPinned;

    return new Date(right?.updatedAt || 0).getTime() - new Date(left?.updatedAt || 0).getTime();
  });
}

function sortProjectChats(chats) {
  return [...(Array.isArray(chats) ? chats : [])].sort(
    (left, right) =>
      new Date(right?.updatedAt || 0).getTime() - new Date(left?.updatedAt || 0).getTime()
  );
}

function normalizeProjectFile(file) {
  const url = String(file?.url || file?.path || "").trim();
  const type = String(file?.type || "");
  const isImage = type.startsWith("image/");

  return {
    id: file?.id || createProjectLinkId(),
    name: String(file?.name || "Untitled file"),
    size: Number(file?.size || 0),
    type,
    url,
    previewUrl: isImage && url ? resolveApiUrl(url) : "",
    uploadedAt: file?.uploadedAt || file?.createdAt || new Date().toISOString(),
  };
}

function normalizeProjectChat(chat, project) {
  return {
    id: chat?.id || createProjectLinkId(),
    title: String(chat?.title || "New chat"),
    messages: Array.isArray(chat?.messages) ? chat.messages : [],
    conversationId: chat?.conversationId ?? null,
    conversationRefId: chat?.conversationRefId ?? null,
    updatedAt: chat?.updatedAt || project?.updatedAt || new Date().toISOString(),
  };
}

export function normalizeStoredProject(project) {
  const chats = sortProjectChats(
    (Array.isArray(project?.chats) ? project.chats : []).map((chat) =>
      normalizeProjectChat(chat, project)
    )
  );

  const activeChatId = chats.some((chat) => chat.id === project?.activeChatId)
    ? project.activeChatId
    : chats[0]?.id || null;

  return {
    id: project?.id || createProjectLinkId(),
    name: String(project?.name || "Untitled project"),
    brief: String(project?.brief || ""),
    updatedAt: project?.updatedAt || new Date().toISOString(),
    pinned: Boolean(project?.pinned),
    instructions: String(project?.instructions || ""),
    files: (Array.isArray(project?.files) ? project.files : []).map(normalizeProjectFile),
    chats,
    activeChatId,
    chatsCount: chats.length || Number(project?.chatsCount || 0),
  };
}

export function readStoredProjectsIndex() {
  if (typeof window === "undefined") return [];

  try {
    const rawValue = window.localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!rawValue) return [];

    const parsedValue = JSON.parse(rawValue);
    return Array.isArray(parsedValue) ? parsedValue.map(normalizeStoredProject) : [];
  } catch {
    return [];
  }
}

export function writeStoredProjectsIndex(projects) {
  if (typeof window === "undefined") return [];

  const normalizedProjects = Array.isArray(projects)
    ? projects.map(normalizeStoredProject)
    : [];

  try {
    window.localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(normalizedProjects));
  } catch {
    // ignore
  }

  safeDispatchProjectsUpdated();
  return normalizedProjects;
}

export function clearStoredProjectsIndex() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(PROJECTS_STORAGE_KEY);
  } catch {
    // ignore
  }

  safeDispatchProjectsUpdated();
}

export function chatMatchesConversation(chat, { conversationId, conversationRefId }) {
  if (conversationId != null && chat?.conversationId === conversationId) return true;
  if (conversationRefId && chat?.conversationRefId === conversationRefId) return true;
  return false;
}

export function findConversationProjectMatch(projects, { conversationId, conversationRefId }) {
  const normalizedProjects = Array.isArray(projects) ? projects : [];

  for (const project of normalizedProjects) {
    const chats = Array.isArray(project?.chats) ? project.chats : [];
    const chat = chats.find((candidateChat) =>
      chatMatchesConversation(candidateChat, {
        conversationId,
        conversationRefId,
      })
    );

    if (chat) {
      return {
        project,
        chat,
      };
    }
  }

  return null;
}

export async function loadProjectsFromApi() {
  const res = await api.get("/projects");
  return writeStoredProjectsIndex(res?.data?.projects || []);
}

export async function createProjectRequest(payload) {
  const res = await api.post("/projects", payload);
  return normalizeStoredProject(res?.data?.project || {});
}

export async function patchProjectRequest(projectId, payload) {
  const res = await api.patch(`/projects/${encodeURIComponent(projectId)}`, payload);
  return normalizeStoredProject(res?.data?.project || {});
}

export async function deleteProjectRequest(projectId) {
  const res = await api.delete(`/projects/${encodeURIComponent(projectId)}`);
  return res?.data || { ok: true };
}

export async function attachConversationToProjectRequest({ projectId, conversationId }) {
  const res = await api.post(`/projects/${encodeURIComponent(projectId)}/chats`, {
    conversationId,
  });
  return res?.data || null;
}

export async function removeConversationFromProjectRequest({ projectId, projectChatId }) {
  const res = await api.delete(
    `/projects/${encodeURIComponent(projectId)}/chats/${encodeURIComponent(projectChatId)}`
  );
  return res?.data || { ok: true };
}

export async function uploadProjectFileRequest({ projectId, name, type, size, dataUrl }) {
  const res = await api.post(`/projects/${encodeURIComponent(projectId)}/files`, {
    name,
    type,
    size,
    dataUrl,
  });
  return normalizeProjectFile(res?.data?.file || {});
}

export async function deleteProjectFileRequest({ projectId, fileId }) {
  const res = await api.delete(
    `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`
  );
  return res?.data || { ok: true };
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("FILE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}
