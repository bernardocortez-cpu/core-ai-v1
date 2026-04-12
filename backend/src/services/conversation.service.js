const prisma = require("../lib/prisma");
const { getModel } = require("../ai/models");
const { getProvider } = require("../ai/providers");
const { runInProviderQueue } = require("../ai/queues");
const { getMessageAttachmentLimit, normalizePlan } = require("../config/plans");
const projectService = require("./project.service");

const DEFAULT_CONVERSATION_TITLE = "New chat";
const LEGACY_DEFAULT_CONVERSATION_TITLE = "Novo chat";
const AUTO_TITLE_MODEL_ID = "gemini-2.5 flash lite";
const PLACEHOLDER_TITLES = [DEFAULT_CONVERSATION_TITLE, LEGACY_DEFAULT_CONVERSATION_TITLE];
const GENERIC_AUTO_TITLES = new Set([
  "new chat",
  "novo chat",
  "chat",
  "conversation",
  "conversa",
  "help",
  "ajuda",
  "question",
  "pergunta",
]);
const CONVERSATION_LIST_SELECT = {
  id: true,
  title: true,
  mode: true,
  pinned: true,
  pinnedAt: true,
  createdAt: true,
  updatedAt: true,
};

function conversationNotFound() {
  const err = new Error("CONVERSATION_NOT_FOUND");
  err.status = 404;
  return err;
}

function isPlaceholderConversationTitle(title) {
  const s = String(title || "")
    .trim()
    .toLowerCase();
  return PLACEHOLDER_TITLES.some((x) => x.toLowerCase() === s);
}

async function assertMessageAttachmentLimit({ userId, attachments }) {
  const attachmentCount = Array.isArray(attachments)
    ? attachments.length
    : attachments && typeof attachments === "object" && Array.isArray(attachments.items)
      ? attachments.items.length
      : 0;
  if (attachmentCount <= 0) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true },
  });

  const plan = normalizePlan(user?.plan);
  const limit = getMessageAttachmentLimit(plan);
  if (attachmentCount <= limit) {
    return { plan, limit, requested: attachmentCount };
  }

  const err = new Error("ATTACHMENTS_PER_MESSAGE_LIMIT_REACHED");
  err.status = 403;
  err.details = { plan, limit, requested: attachmentCount };
  throw err;
}

function sanitizeGeneratedConversationTitle(raw) {
  let title = String(raw || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((x) => x.trim())
    .find(Boolean) || "";

  title = title
    .replace(/^["'`([{<\s]+/, "")
    .replace(/["'`)\]}>]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  title = title.replace(/[.!?;:,]+$/g, "").trim();
  if (!title) return null;

  const words = title.split(/\s+/).filter(Boolean);
  if (words.length > 10) title = words.slice(0, 10).join(" ");
  if (title.length > 120) {
    const clipped = title.slice(0, 120).trim();
    const lastSpace = clipped.lastIndexOf(" ");
    title = lastSpace >= 48 ? clipped.slice(0, lastSpace).trim() : clipped;
  }
  if (!title) return null;

  const normalized = title.toLowerCase();
  if (GENERIC_AUTO_TITLES.has(normalized)) return null;
  if (isPlaceholderConversationTitle(title)) return null;
  return title;
}

async function getConversationForAutoTitle({ userId, conversationId }) {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: {
      id: true,
      title: true,
      mode: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 6,
        select: {
          role: true,
          content: true,
        },
      },
    },
  });

  if (
    !convo ||
    !["chat", "creative_studio"].includes(String(convo.mode || "")) ||
    !isPlaceholderConversationTitle(convo.title)
  ) {
    return null;
  }
  return convo;
}

async function generateConversationTitleFromTexts({ mode, userText }) {
  const modelObj = getModel(AUTO_TITLE_MODEL_ID);
  const provider = modelObj ? getProvider(modelObj.provider) : null;
  if (!modelObj || !provider || typeof provider.streamChat !== "function") return null;

  const isCreative = String(mode || "") === "creative_studio";
  const system = {
    role: "system",
    content: isCreative
      ? "Generate a short title for a creative generation conversation in the user's language. " +
        "Base it primarily on the user's creative prompt. Mention the asset type only if obvious. " +
        "Return title only, no quotes, no markdown, no emoji, no trailing punctuation. " +
        "Keep it concise and natural, ideally 4 to 8 words. Avoid generic titles like Image, Design, Prompt, New chat."
      : "Generate a short conversation title in the user's language from the user's first message only. " +
        "Return title only, no quotes, no markdown, no emoji, no trailing punctuation. " +
        "Keep it concise and natural, ideally 4 to 8 words. Avoid generic titles like Chat, Help, Question, New chat.",
  };

  const userMsg = {
    role: "user",
    content: (isCreative ? "CREATIVE_PROMPT:\n" : "FIRST_USER_MESSAGE:\n") + String(userText || "").slice(0, 1200),
  };

  let raw = "";
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId =
    controller &&
    setTimeout(() => {
      try {
        controller.abort();
      } catch {}
    }, 5000);

  try {
    await runInProviderQueue(
      modelObj.provider,
      ({ signal }) =>
        provider.streamChat({
          remoteModel: modelObj.remoteModel,
          messages: [system, userMsg],
          onDelta: (delta) => {
            if (typeof delta === "string") raw += delta;
          },
          signal,
        }),
      { type: "text", priority: 0, maxRetries: 0, signal: controller?.signal }
    );
  } catch {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  return sanitizeGeneratedConversationTitle(raw);
}

async function persistAutoConversationTitle({ userId, conversationId, title }) {
  const updated = await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      userId,
      title: { in: PLACEHOLDER_TITLES },
    },
    data: { title },
  });

  if (!updated.count) return null;

  const conversation = await prisma.conversation.findFirst({ where: { id: conversationId, userId }, select: CONVERSATION_LIST_SELECT });
  return conversation || null;
}

async function maybeGenerateConversationTitleFromSeed({
  userId,
  conversationId,
  userMessage,
}) {
  const convo = await getConversationForAutoTitle({ userId, conversationId });
  if (!convo) return null;

  const userText = String(userMessage || "").trim();
  if (!userText) return null;

  const title = await generateConversationTitleFromTexts({
    mode: convo.mode,
    userText,
  });
  if (!title) return null;

  return persistAutoConversationTitle({ userId, conversationId, title });
}

async function maybeGenerateConversationTitle({ userId, conversationId }) {
  const convo = await getConversationForAutoTitle({ userId, conversationId });
  if (!convo) return null;

  const firstUser = convo.messages.find((m) => m.role === "user" && String(m.content || "").trim());
  if (!firstUser) return null;

  return maybeGenerateConversationTitleFromSeed({
    userId,
    conversationId,
    userMessage: firstUser.content,
  });
}

async function listConversations({ userId }) {
  const items = await prisma.conversation.findMany({
    // Only list conversations that actually have messages (history appears after the 1st message).
    where: { userId, messages: { some: {} } },
    orderBy: [{ pinned: "desc" }, { pinnedAt: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      mode: true,
      pinned: true,
      pinnedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  const conversations = items.map(({ _count, ...c }) => ({
    ...c,
    messageCount: _count?.messages || 0,
  }));

  return { conversations };
}

async function createConversation({ userId, title, mode }) {
  const convo = await prisma.conversation.create({
    data: {
      userId,
      title: typeof title === "string" && title.trim() ? title.trim() : DEFAULT_CONVERSATION_TITLE,
      mode: mode || "chat",
    },
    select: CONVERSATION_LIST_SELECT,
  });

  return { conversation: convo };
}

async function getConversation({ userId, conversationId }) {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: {
      id: true,
      title: true,
      mode: true,
      pinned: true,
      pinnedAt: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          content: true,
          attachments: true,
          artifact: true,
          createdAt: true,
        },
      },
    },
  });

  if (!convo) throw conversationNotFound();
  return { conversation: convo };
}

async function patchConversation({ userId, conversationId, title, pinned }) {
  const exists = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true, updatedAt: true },
  });
  if (!exists) throw conversationNotFound();

  const data = {};
  if (typeof title === "string") data.title = title.trim();
  if (typeof pinned === "boolean") {
    data.pinned = pinned;
    data.pinnedAt = pinned ? new Date() : null;
  }

  // Keep "last activity" (updatedAt) tied to messages, not pin/rename,
  // so unpinned ordering matches the old localStorage behavior.
  if (Object.keys(data).length > 0) data.updatedAt = exists.updatedAt;

  const convo = await prisma.conversation.update({
    where: { id: conversationId },
    data,
    select: CONVERSATION_LIST_SELECT,
  });

  return { conversation: convo };
}

async function updateConversation({ userId, conversationId, title }) {
  return patchConversation({ userId, conversationId, title });
}

async function deleteConversation({ userId, conversationId }) {
  const exists = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true },
  });
  if (!exists) throw conversationNotFound();

  const linkedProjects = await prisma.projectChat.findMany({
    where: { conversationId },
    select: { projectId: true },
  });

  await prisma.conversation.delete({ where: { id: conversationId } });
  await projectService.normalizeProjectActiveChatIds(
    linkedProjects.map((item) => item.projectId)
  );
  return { ok: true };
}

async function addMessage({ userId, conversationId, role, content, attachments, artifact }) {
  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true, title: true, mode: true },
  });
  if (!convo) throw conversationNotFound();

  if (role === "user") {
    await assertMessageAttachmentLimit({ userId, attachments });
  }

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        role,
        content,
        attachments: attachments ?? null,
        artifact: artifact ?? null,
      },
      select: {
        id: true,
        role: true,
        content: true,
        attachments: true,
        artifact: true,
        createdAt: true,
      },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
      select: { id: true },
    }),
  ]);

  let conversation = null;
  if (
    (role === "user" || role === "assistant") &&
    ["chat", "creative_studio"].includes(String(convo.mode || "")) &&
    isPlaceholderConversationTitle(convo.title)
  ) {
    conversation = await maybeGenerateConversationTitle({ userId, conversationId });
  }

  await projectService.touchProjectsForConversation({ conversationId });

  return conversation ? { message, conversation } : { message };
}

async function patchMessage({ userId, conversationId, messageId, content, artifact, hasArtifact = false }) {
  const message = await prisma.message.findFirst({
    where: {
      id: messageId,
      conversationId,
      conversation: { userId },
    },
    select: {
      id: true,
      role: true,
      content: true,
      attachments: true,
      artifact: true,
      createdAt: true,
    },
  });

  if (!message) throw conversationNotFound();

  const data = {};
  if (typeof content === "string") data.content = content;
  if (hasArtifact) {
    data.artifact = artifact ?? null;
  }

  const updated = await prisma.message.update({
    where: { id: messageId },
    data,
    select: {
      id: true,
      role: true,
      content: true,
      attachments: true,
      artifact: true,
      createdAt: true,
    },
  });

  return { message: updated };
}

module.exports = {
  listConversations,
  createConversation,
  getConversation,
  updateConversation,
  patchConversation,
  deleteConversation,
  addMessage,
  patchMessage,
  maybeGenerateConversationTitleFromSeed,
};
