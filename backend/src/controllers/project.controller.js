const { z } = require("zod");
const projectService = require("../services/project.service");

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  brief: z.string().max(2000).optional().default(""),
});

const patchProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    brief: z.string().max(2000).optional(),
    instructions: z.string().max(12000).optional(),
    pinned: z.boolean().optional(),
    activeChatId: z.union([z.string().min(1), z.null()]).optional(),
  })
  .refine(
    (value) =>
      typeof value.name === "string" ||
      typeof value.brief === "string" ||
      typeof value.instructions === "string" ||
      typeof value.pinned === "boolean" ||
      value.activeChatId !== undefined,
    {
      message: "MISSING_UPDATE_FIELDS",
    }
  );

const attachProjectChatSchema = z.object({
  conversationId: z.string().min(1),
});

const createProjectFileSchema = z.object({
  name: z.string().trim().min(1).max(240),
  type: z.string().max(200).optional().default(""),
  size: z.number().int().positive().max(5 * 1024 * 1024).optional(),
  dataUrl: z.string().min(1),
});

async function list(req, res, next) {
  try {
    const out = await projectService.listProjects({ userId: req.user.id });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const body = createProjectSchema.parse(req.body || {});
    const out = await projectService.createProject({
      userId: req.user.id,
      name: body.name,
      brief: body.brief,
    });
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
}

async function patch(req, res, next) {
  try {
    const projectId = z.string().min(1).parse(req.params.id);
    const body = patchProjectSchema.parse(req.body || {});
    const out = await projectService.patchProject({
      userId: req.user.id,
      projectId,
      name: body.name,
      brief: body.brief,
      instructions: body.instructions,
      pinned: body.pinned,
      activeChatId: body.activeChatId,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const projectId = z.string().min(1).parse(req.params.id);
    const out = await projectService.deleteProject({
      userId: req.user.id,
      projectId,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

async function attachChat(req, res, next) {
  try {
    const projectId = z.string().min(1).parse(req.params.id);
    const body = attachProjectChatSchema.parse(req.body || {});
    const out = await projectService.attachConversationToProject({
      userId: req.user.id,
      projectId,
      conversationId: body.conversationId,
    });
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
}

async function removeChat(req, res, next) {
  try {
    const projectId = z.string().min(1).parse(req.params.id);
    const projectChatId = z.string().min(1).parse(req.params.chatId);
    const out = await projectService.removeConversationFromProject({
      userId: req.user.id,
      projectId,
      projectChatId,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

async function addFile(req, res, next) {
  try {
    const projectId = z.string().min(1).parse(req.params.id);
    const body = createProjectFileSchema.parse(req.body || {});
    const out = await projectService.addProjectFile({
      userId: req.user.id,
      projectId,
      name: body.name,
      type: body.type,
      size: body.size,
      dataUrl: body.dataUrl,
    });
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
}

async function removeFile(req, res, next) {
  try {
    const projectId = z.string().min(1).parse(req.params.id);
    const fileId = z.string().min(1).parse(req.params.fileId);
    const out = await projectService.deleteProjectFile({
      userId: req.user.id,
      projectId,
      fileId,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list,
  create,
  patch,
  remove,
  attachChat,
  removeChat,
  addFile,
  removeFile,
};
