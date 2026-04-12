const { z } = require("zod");
const prisma = require("../lib/prisma");
const creativeService = require("../services/creative.service");
const { listCreativeModels } = require("../ai/creativeModels");
const {
  normalizePlan,
  getMonthlyCreativeGenerationLimit,
  getMonthlyCreativeCreditLimit,
  getCreativeModelCreditCost,
} = require("../config/plans");
const { getProvider } = require("../ai/providers");

const generateImageSchema = z.object({
  modelId: z.string().min(1),
  prompt: z.string().min(1).max(8000),
  size: z.string().min(1).max(64).optional(), // provider-specific, e.g. "1024x1024"
  // Optional "image-to-image" input. We keep it flexible so the frontend can reuse
  // the same attachment payload shape as the normal chat.
  inputImage: z
    .union([
      z.string().min(1).max(25_000_000), // data URL or URL
      z
        .object({
          dataUrl: z.string().min(1).max(25_000_000).optional(),
          url: z.string().min(1).max(4096).optional(),
          mime: z.string().min(1).max(64).optional(),
          type: z.string().min(1).max(64).optional(),
          image_url: z
            .object({
              url: z.string().min(1).max(4096),
            })
            .optional(),
        })
        .passthrough(),
    ])
    .optional(),
  // Alternate shapes to support "chat-like" payloads.
  attachments: z.array(z.any()).max(20).optional(),
  content: z.array(z.any()).max(50).optional(),
});

const generateVideoSchema = z.object({
  modelId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  prompt: z.string().min(1).max(8000),
  size: z.string().min(1).max(64).optional(),
  inputImage: z
    .union([
      z.string().min(1).max(30_000_000),
      z
        .object({
          dataUrl: z.string().min(1).max(30_000_000).optional(),
          url: z.string().min(1).max(4096).optional(),
          mime: z.string().min(1).max(128).optional(),
        })
        .passthrough(),
    ])
    .optional(),
  inputVideo: z
    .union([
      z.string().min(1).max(40_000_000),
      z
        .object({
          dataUrl: z.string().min(1).max(40_000_000).optional(),
          url: z.string().min(1).max(4096).optional(),
          mime: z.string().min(1).max(128).optional(),
        })
        .passthrough(),
    ])
    .optional(),
  attachments: z.array(z.any()).max(20).optional(),
  content: z.array(z.any()).max(50).optional(),
});

const generateMusicSchema = z.object({
  modelId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  prompt: z.string().min(1).max(8000),
  inputImage: z
    .union([
      z.string().min(1).max(30_000_000),
      z
        .object({
          dataUrl: z.string().min(1).max(30_000_000).optional(),
          url: z.string().min(1).max(4096).optional(),
          mime: z.string().min(1).max(128).optional(),
        })
        .passthrough(),
    ])
    .optional(),
  attachments: z.array(z.any()).max(20).optional(),
  content: z.array(z.any()).max(50).optional(),
});

async function models(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { plan: true },
    });

    const plan = normalizePlan(user?.plan);
    const limit = getMonthlyCreativeGenerationLimit(plan);
    const creditLimit = getMonthlyCreativeCreditLimit(plan);

    res.json({
      plan,
      limit,
      creditLimit,
      models: listCreativeModels().map((m) => ({
        id: m.id,
        type: m.type,
        provider: m.provider,
        implemented: Boolean(m.implemented),
        creditCost: getCreativeModelCreditCost(m.id),
      })),
    });
  } catch (e) {
    next(e);
  }
}

async function generateImage(req, res, next) {
  try {
    const body = generateImageSchema.parse(req.body || {});

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { plan: true },
    });

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    const controller = new AbortController();
    if (closed) controller.abort();

    const out = await creativeService.generateImage({
      userId: req.user.id,
      plan: user?.plan,
      modelId: body.modelId,
      prompt: body.prompt,
      size: body.size,
      inputImage: body.inputImage,
      attachments: body.attachments,
      content: body.content,
      signal: controller.signal,
    });

    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function generateVideo(req, res, next) {
  try {
    const body = generateVideoSchema.parse(req.body || {});

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { plan: true },
    });

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    const controller = new AbortController();
    if (closed) controller.abort();

    const out = await creativeService.generateVideo({
      userId: req.user.id,
      plan: user?.plan,
      conversationId: body.conversationId,
      modelId: body.modelId,
      prompt: body.prompt,
      size: body.size,
      inputImage: body.inputImage,
      inputVideo: body.inputVideo,
      attachments: body.attachments,
      content: body.content,
      signal: controller.signal,
    });

    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function generateMusic(req, res, next) {
  try {
    const body = generateMusicSchema.parse(req.body || {});

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { plan: true },
    });

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    const controller = new AbortController();
    if (closed) controller.abort();

    const out = await creativeService.generateMusic({
      userId: req.user.id,
      plan: user?.plan,
      conversationId: body.conversationId,
      modelId: body.modelId,
      prompt: body.prompt,
      inputImage: body.inputImage,
      attachments: body.attachments,
      content: body.content,
      signal: controller.signal,
    });

    res.json(out);
  } catch (e) {
    next(e);
  }
}

async function openaiModels(req, res, next) {
  try {
    const provider = getProvider("openai");
    if (!provider || typeof provider.listModels !== "function") {
      const err = new Error("PROVIDER_NOT_CONFIGURED");
      err.status = 501;
      err.details = { provider: "openai" };
      throw err;
    }

    const models = await provider.listModels();
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const key = String(process.env.OPENAI_API_KEY || "");
    const org = String(process.env.OPENAI_ORG_ID || "").trim();
    const project = String(process.env.OPENAI_PROJECT_ID || "").trim();

    res.json({
      debug: {
        baseUrl,
        keyLast4: key ? key.slice(-4) : null,
        hasOrgHeader: Boolean(org),
        hasProjectHeader: Boolean(project),
      },
      count: models.length,
      models,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { models, generateImage, generateVideo, generateMusic, openaiModels };
