const { z } = require("zod");
const conversationService = require("../services/conversation.service");
const { MAX_MESSAGE_CONTENT_CHARS } = require("../config/limits");

const createConversationSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  mode: z.enum(["chat", "creative_studio"]).optional(),
});

const updateConversationSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((v) => typeof v.title === "string" || typeof v.pinned === "boolean", {
    message: "MISSING_UPDATE_FIELDS",
  });

const addMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(MAX_MESSAGE_CONTENT_CHARS),
  attachments: z.any().optional(),
  artifact: z.any().optional(),
});

const patchMessageSchema = z
  .object({
    content: z.string().min(0).max(MAX_MESSAGE_CONTENT_CHARS).optional(),
    artifact: z.any().nullable().optional(),
  })
  .refine((v) => Object.prototype.hasOwnProperty.call(v, "content") || Object.prototype.hasOwnProperty.call(v, "artifact"), {
    message: "MISSING_UPDATE_FIELDS",
  });

async function list(req, res, next) {
  try {
    const out = await conversationService.listConversations({ userId: req.user.id });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function create(req, res, next) {
  try {
    const body = createConversationSchema.parse(req.body || {});
    const out = await conversationService.createConversation({
      userId: req.user.id,
      title: body.title,
      mode: body.mode,
    });
    res.status(201).json(out);
  } catch (e) {
    next(e);
  }
}

async function getOne(req, res, next) {
  try {
    const conversationId = z.string().min(1).parse(req.params.id);
    const out = await conversationService.getConversation({ userId: req.user.id, conversationId });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function update(req, res, next) {
  try {
    const conversationId = z.string().min(1).parse(req.params.id);
    const body = updateConversationSchema.parse(req.body || {});
    const out = await conversationService.patchConversation({
      userId: req.user.id,
      conversationId,
      title: body.title,
      pinned: body.pinned,
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function remove(req, res, next) {
  try {
    const conversationId = z.string().min(1).parse(req.params.id);
    const out = await conversationService.deleteConversation({ userId: req.user.id, conversationId });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function addMessage(req, res, next) {
  try {
    const conversationId = z.string().min(1).parse(req.params.id);
    const body = addMessageSchema.parse(req.body);

    const out = await conversationService.addMessage({
      userId: req.user.id,
      conversationId,
      role: body.role,
      content: body.content,
      attachments: body.attachments,
      artifact: body.artifact,
    });

    res.status(201).json(out);
  } catch (e) {
    next(e);
  }
}

async function patchMessage(req, res, next) {
  try {
    const conversationId = z.string().min(1).parse(req.params.id);
    const messageId = z.string().min(1).parse(req.params.messageId);
    const body = patchMessageSchema.parse(req.body || {});

    const out = await conversationService.patchMessage({
      userId: req.user.id,
      conversationId,
      messageId,
      content: body.content,
      artifact: body.artifact,
      hasArtifact: Object.prototype.hasOwnProperty.call(body, "artifact"),
    });

    res.json(out);
  } catch (e) {
    next(e);
  }
}

module.exports = { list, create, getOne, update, remove, addMessage, patchMessage };
