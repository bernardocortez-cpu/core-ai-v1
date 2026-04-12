const { z } = require("zod");
const memoryService = require("../services/memory.service");

const patchMemorySchema = z
  .object({
    content: z.string().min(1).max(500).optional(),
    category: z
      .enum(["PERSONAL_INFO", "PREFERENCES", "WORK", "STYLE", "TECH_STACK", "OTHER"])
      .optional(),
  })
  .refine((v) => typeof v.content === "string" || typeof v.category === "string", {
    message: "MISSING_UPDATE_FIELDS",
  });

const toggleSchema = z.object({
  enabled: z.boolean().optional(),
});

async function list(req, res, next) {
  try {
    const out = await memoryService.listMemories({ userId: req.user.id });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function patch(req, res, next) {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const body = patchMemorySchema.parse(req.body || {});
    const updated = await memoryService.patchMemory({
      userId: req.user.id,
      id,
      content: body.content,
      category: body.category,
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
}

async function removeOne(req, res, next) {
  try {
    const id = z.string().min(1).parse(req.params.id);
    const out = await memoryService.deleteMemory({ userId: req.user.id, id });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function removeAll(req, res, next) {
  try {
    const out = await memoryService.deleteAllMemory({ userId: req.user.id });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function toggle(req, res, next) {
  try {
    const body = toggleSchema.parse(req.body || {});
    const out =
      typeof body.enabled === "boolean"
        ? await memoryService.setMemoryEnabled({ userId: req.user.id, enabled: body.enabled })
        : await memoryService.toggleMemoryEnabled({ userId: req.user.id });
    res.json(out);
  } catch (e) {
    next(e);
  }
}

module.exports = {
  list,
  patch,
  removeOne,
  removeAll,
  toggle,
};

