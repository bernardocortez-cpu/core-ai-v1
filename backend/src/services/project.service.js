const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { getProjectFileLimit } = require("../config/plans");

const PROJECT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const PROJECT_SELECT = {
  id: true,
  name: true,
  brief: true,
  instructions: true,
  pinned: true,
  activeChatId: true,
  createdAt: true,
  updatedAt: true,
  files: {
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      size: true,
      path: true,
      storedName: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  chats: {
    select: {
      id: true,
      conversationId: true,
      createdAt: true,
      updatedAt: true,
      conversation: {
        select: {
          id: true,
          title: true,
          updatedAt: true,
        },
      },
    },
  },
};

function projectNotFound() {
  const err = new Error("PROJECT_NOT_FOUND");
  err.status = 404;
  return err;
}

function projectChatNotFound() {
  const err = new Error("PROJECT_CHAT_NOT_FOUND");
  err.status = 404;
  return err;
}

function projectFileNotFound() {
  const err = new Error("PROJECT_FILE_NOT_FOUND");
  err.status = 404;
  return err;
}

function conversationNotFound() {
  const err = new Error("CONVERSATION_NOT_FOUND");
  err.status = 404;
  return err;
}

function invalidProjectActiveChat() {
  const err = new Error("INVALID_PROJECT_ACTIVE_CHAT");
  err.status = 400;
  return err;
}

function sanitizeFilename(name) {
  const cleaned = String(name || "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "file";
}

function parseAttachmentDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    const err = new Error("INVALID_PROJECT_FILE");
    err.status = 400;
    throw err;
  }

  return {
    type: match[1],
    contentBase64: match[2].replace(/\s+/g, ""),
  };
}

function mimeToExtension(mimeType) {
  const mime = String(mimeType || "").trim().toLowerCase();
  const known = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
    "text/plain": ".txt",
    "text/markdown": ".md",
    "application/json": ".json",
    "text/csv": ".csv",
    "application/pdf": ".pdf",
    "application/zip": ".zip",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  };
  return known[mime] || "";
}

function sortSerializedChats(chats) {
  return [...(Array.isArray(chats) ? chats : [])].sort(
    (left, right) =>
      new Date(right?.updatedAt || 0).getTime() - new Date(left?.updatedAt || 0).getTime()
  );
}

function serializeProjectFile(file) {
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    size: file.size,
    url: file.path,
    uploadedAt: file.createdAt,
  };
}

function serializeProject(project) {
  const chats = sortSerializedChats(
    (Array.isArray(project?.chats) ? project.chats : []).map((chat) => ({
      id: chat.id,
      title: String(chat?.conversation?.title || "New chat"),
      messages: [],
      conversationId: chat?.conversation?.id || chat?.conversationId || null,
      conversationRefId: null,
      updatedAt: chat?.conversation?.updatedAt || chat?.updatedAt || project?.updatedAt || new Date().toISOString(),
    }))
  );

  const activeChatId = chats.some((chat) => chat.id === project?.activeChatId)
    ? project.activeChatId
    : chats[0]?.id || null;

  return {
    id: project.id,
    name: String(project.name || "Untitled project"),
    brief: String(project.brief || ""),
    instructions: String(project.instructions || ""),
    updatedAt: project.updatedAt,
    createdAt: project.createdAt,
    pinned: Boolean(project.pinned),
    activeChatId,
    chatsCount: chats.length,
    chats,
    files: (Array.isArray(project?.files) ? project.files : []).map(serializeProjectFile),
  };
}

async function getProjectForUser({ userId, projectId, tx = prisma }) {
  const project = await tx.project.findFirst({
    where: { id: projectId, userId },
    select: PROJECT_SELECT,
  });
  if (!project) throw projectNotFound();
  return project;
}

async function normalizeProjectActiveChatIdsTx(tx, projectIds) {
  const ids = [...new Set((Array.isArray(projectIds) ? projectIds : []).filter(Boolean))];
  if (ids.length === 0) return;

  for (const projectId of ids) {
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        activeChatId: true,
        chats: {
          select: {
            id: true,
            conversation: {
              select: {
                updatedAt: true,
              },
            },
          },
        },
      },
    });

    if (!project) continue;

    const orderedChats = [...project.chats].sort(
      (left, right) =>
        new Date(right?.conversation?.updatedAt || 0).getTime() -
        new Date(left?.conversation?.updatedAt || 0).getTime()
    );

    const nextActiveChatId = orderedChats.some((chat) => chat.id === project.activeChatId)
      ? project.activeChatId
      : orderedChats[0]?.id || null;

    if (nextActiveChatId === project.activeChatId) continue;

    await tx.project.update({
      where: { id: project.id },
      data: {
        activeChatId: nextActiveChatId,
        updatedAt: new Date(),
      },
    });
  }
}

async function normalizeProjectActiveChatIds(projectIds) {
  await prisma.$transaction(async (tx) => {
    await normalizeProjectActiveChatIdsTx(tx, projectIds);
  });
}

async function listProjects({ userId }) {
  const projects = await prisma.project.findMany({
    where: { userId },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: PROJECT_SELECT,
  });

  return {
    projects: projects.map(serializeProject),
  };
}

async function createProject({ userId, name, brief }) {
  const project = await prisma.project.create({
    data: {
      userId,
      name: String(name || "").trim(),
      brief: String(brief || "").trim(),
    },
    select: PROJECT_SELECT,
  });

  return { project: serializeProject(project) };
}

async function patchProject({ userId, projectId, name, brief, instructions, pinned, activeChatId }) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: {
      id: true,
      activeChatId: true,
      updatedAt: true,
      chats: {
        select: {
          id: true,
        },
      },
    },
  });
  if (!project) throw projectNotFound();

  const data = {};
  if (typeof name === "string") data.name = name.trim();
  if (typeof brief === "string") data.brief = brief.trim();
  if (typeof instructions === "string") data.instructions = instructions.trim();
  if (typeof pinned === "boolean") data.pinned = pinned;
  if (activeChatId !== undefined) {
    if (activeChatId === null) {
      data.activeChatId = null;
    } else {
      const exists = project.chats.some((chat) => chat.id === activeChatId);
      if (!exists) throw invalidProjectActiveChat();
      data.activeChatId = activeChatId;
    }
  }

  const onlyActiveChatChanged =
    activeChatId !== undefined &&
    typeof name !== "string" &&
    typeof brief !== "string" &&
    typeof instructions !== "string" &&
    typeof pinned !== "boolean";
  if (onlyActiveChatChanged) {
    data.updatedAt = project.updatedAt;
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data,
    select: PROJECT_SELECT,
  });

  return { project: serializeProject(updated) };
}

async function deleteProject({ userId, projectId }) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { id: true },
  });
  if (!project) throw projectNotFound();

  await prisma.project.delete({ where: { id: projectId } });

  const projectDir = path.join(process.cwd(), "uploads", "projects", projectId);
  try {
    await fs.rm(projectDir, { recursive: true, force: true });
  } catch {}

  return { ok: true };
}

async function attachConversationToProject({ userId, projectId, conversationId }) {
  const [project, conversation] = await Promise.all([
    prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true, name: true },
    }),
    prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    }),
  ]);

  if (!project) throw projectNotFound();
  if (!conversation) throw conversationNotFound();

  let targetChatId = null;

  await prisma.$transaction(async (tx) => {
    const existingChats = await tx.projectChat.findMany({
      where: {
        conversationId,
        project: {
          userId,
        },
      },
      select: {
        id: true,
        projectId: true,
      },
    });

    const sourceProjectIds = existingChats
      .filter((chat) => chat.projectId !== projectId)
      .map((chat) => chat.projectId);

    const sourceChatIds = existingChats
      .filter((chat) => chat.projectId !== projectId)
      .map((chat) => chat.id);

    if (sourceChatIds.length > 0) {
      await tx.projectChat.deleteMany({
        where: {
          id: { in: sourceChatIds },
        },
      });
    }

    const existingTargetChat = existingChats.find((chat) => chat.projectId === projectId) || null;
    if (existingTargetChat) {
      targetChatId = existingTargetChat.id;
    } else {
      const createdChat = await tx.projectChat.create({
        data: {
          projectId,
          conversationId,
        },
        select: {
          id: true,
        },
      });
      targetChatId = createdChat.id;
    }

    const touchedProjectIds = [...new Set([projectId, ...sourceProjectIds])];
    if (touchedProjectIds.length > 0) {
      await tx.project.updateMany({
        where: { id: { in: touchedProjectIds } },
        data: { updatedAt: new Date() },
      });
      await normalizeProjectActiveChatIdsTx(tx, touchedProjectIds);
    }
  });

  return {
    ok: true,
    projectId: project.id,
    projectName: project.name,
    projectChatId: targetChatId,
  };
}

async function removeConversationFromProject({ userId, projectId, projectChatId }) {
  const projectChat = await prisma.projectChat.findFirst({
    where: {
      id: projectChatId,
      projectId,
      project: {
        userId,
      },
    },
    select: {
      id: true,
      projectId: true,
    },
  });

  if (!projectChat) throw projectChatNotFound();

  await prisma.$transaction(async (tx) => {
    await tx.projectChat.delete({
      where: { id: projectChat.id },
    });

    await tx.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });

    await normalizeProjectActiveChatIdsTx(tx, [projectId]);
  });

  return { ok: true };
}

async function addProjectFile({ userId, projectId, name, type, size, dataUrl }) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: {
      id: true,
      user: {
        select: {
          plan: true,
        },
      },
      _count: {
        select: {
          files: true,
        },
      },
    },
  });
  if (!project) throw projectNotFound();

  const fileLimit = getProjectFileLimit(project?.user?.plan);

  if ((project._count?.files || 0) >= fileLimit) {
    const err = new Error("PROJECT_FILE_LIMIT_REACHED");
    err.status = 400;
    err.details = { limit: fileLimit };
    throw err;
  }

  const parsed = parseAttachmentDataUrl(dataUrl);
  const buffer = Buffer.from(parsed.contentBase64, "base64");
  const actualSize = buffer.byteLength;
  const nextSize = Number(size || actualSize);

  if (!Number.isFinite(nextSize) || nextSize <= 0 || actualSize <= 0 || actualSize > PROJECT_MAX_FILE_SIZE_BYTES) {
    const err = new Error("PROJECT_FILE_TOO_LARGE");
    err.status = 400;
    throw err;
  }

  const safeName = sanitizeFilename(name);
  const ext = path.extname(safeName) || mimeToExtension(parsed.type || type);
  const base = path.basename(safeName, path.extname(safeName)).slice(0, 80) || "file";
  const storedName = `${Date.now()}-${crypto.randomUUID()}-${base}${ext}`;
  const projectDir = path.join(process.cwd(), "uploads", "projects", projectId);
  const diskPath = path.join(projectDir, storedName);
  const mediaPath = `/media/projects/${projectId}/${storedName}`;

  await fs.mkdir(projectDir, { recursive: true });
  await fs.writeFile(diskPath, buffer);

  try {
    const [file] = await prisma.$transaction([
      prisma.projectFile.create({
        data: {
          projectId,
          name: safeName,
          type: String(parsed.type || type || "application/octet-stream").trim() || "application/octet-stream",
          size: actualSize,
          path: mediaPath,
          storedName,
        },
        select: {
          id: true,
          name: true,
          type: true,
          size: true,
          path: true,
          storedName: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.project.update({
        where: { id: projectId },
        data: { updatedAt: new Date() },
        select: { id: true },
      }),
    ]);

    return {
      file: serializeProjectFile(file),
    };
  } catch (err) {
    try {
      await fs.unlink(diskPath);
    } catch {}
    throw err;
  }
}

async function deleteProjectFile({ userId, projectId, fileId }) {
  const file = await prisma.projectFile.findFirst({
    where: {
      id: fileId,
      projectId,
      project: {
        userId,
      },
    },
    select: {
      id: true,
      path: true,
      storedName: true,
      projectId: true,
    },
  });

  if (!file) throw projectFileNotFound();

  await prisma.$transaction([
    prisma.projectFile.delete({
      where: { id: file.id },
    }),
    prisma.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
      select: { id: true },
    }),
  ]);

  const diskPath = path.join(process.cwd(), "uploads", "projects", file.projectId, file.storedName);
  try {
    await fs.unlink(diskPath);
  } catch {}

  return { ok: true };
}

async function touchProjectsForConversation({ conversationId }) {
  if (!conversationId) return;

  await prisma.project.updateMany({
    where: {
      chats: {
        some: {
          conversationId,
        },
      },
    },
    data: {
      updatedAt: new Date(),
    },
  });
}

module.exports = {
  listProjects,
  createProject,
  patchProject,
  deleteProject,
  attachConversationToProject,
  removeConversationFromProject,
  addProjectFile,
  deleteProjectFile,
  touchProjectsForConversation,
  normalizeProjectActiveChatIds,
  getProjectForUser,
};
