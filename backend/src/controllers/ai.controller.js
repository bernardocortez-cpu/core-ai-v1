const { z } = require("zod");
const aiService = require("../services/ai.service");
const prisma = require("../lib/prisma");
const { listModels } = require("../ai/models");
const { getPromptCacheMetrics } = require("../ai/usageCache");
const { normalizePlan, isPaidPlan } = require("../config/plans");
const { MAX_MESSAGE_CONTENT_CHARS, MAX_MESSAGE_CONTENT_PARTS } = require("../config/limits");
const { isTransientDbError } = require("../utils/dbErrors");

// Request schema for chat streaming.
// `messages` is the conversation context the frontend sends (role/content).
const contentPartSchema = z
  .object({
    type: z.string().min(1),
  })
  .passthrough();

const contentSchema = z.union([
  z.string().min(1).max(MAX_MESSAGE_CONTENT_CHARS),
  // OpenAI-style parts array (for images/files). We keep this permissive and cap count.
  z.array(contentPartSchema).min(1).max(MAX_MESSAGE_CONTENT_PARTS),
]);

const chatSchema = z.object({
  conversationId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: contentSchema,
      })
    )
    .min(1),
  selectedModel: z.string().min(1).optional(), // UI model id
  selectionMode: z.enum(["auto", "manual"]).optional(),
  routingText: z.string().min(1).max(MAX_MESSAGE_CONTENT_CHARS).optional(),
  webSearchEnabled: z.boolean().optional(),
  reasoningEnabled: z.boolean().optional(),
  locale: z.string().min(2).max(16).optional(), // BCP-47-ish (e.g. "pt-PT", "en-US")
});

function normalizeLocale(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const cleaned = s.replace(/_/g, "-").split(";")[0].trim();
  const [lang0, region0] = cleaned.split("-");
  const lang = String(lang0 || "").toLowerCase();
  if (!/^[a-z]{2,3}$/.test(lang)) return null;
  const region = region0 ? String(region0).toUpperCase() : "";
  if (region && !/^[A-Z]{2}$/.test(region)) return lang; // keep language only
  return region ? `${lang}-${region}` : lang;
}

function localeFromAcceptLanguage(headerValue) {
  const h = String(headerValue || "").trim();
  if (!h) return null;
  const first = h.split(",")[0]?.trim() || "";
  const norm = normalizeLocale(first);
  if (!norm || norm === "*") return null;
  return norm;
}

function pickRequestLocale(bodyLocale, acceptLanguage) {
  const fromBody = normalizeLocale(bodyLocale);
  if (fromBody) return fromBody;
  const fromHeader = localeFromAcceptLanguage(acceptLanguage);
  if (fromHeader) return fromHeader;
  return "en-US";
}

function sseHeaders(res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // nginx
  if (typeof res.flushHeaders === "function") res.flushHeaders();
}

function sseSend(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  // SSE requires each line to start with "data:"
  const lines = String(payload).split("\n");
  for (const line of lines) res.write(`data: ${line}\n`);
  res.write("\n");
}

async function chat(req, res, next) {
  try {
    const body = chatSchema.parse(req.body || {});

    // Safety: prevent huge JSON payloads (e.g. very large base64 images) from overloading the server.
    // Allow moderate image/PDF payloads (data: URLs) without breaking SSE.
    const maxJsonChars = Number.parseInt(process.env.MAX_CHAT_PAYLOAD_CHARS || "8000000", 10) || 8000000;
    try {
      const approx = JSON.stringify(body).length;
      if (approx > maxJsonChars) {
        const err = new Error("PAYLOAD_TOO_LARGE");
        err.status = 413;
        err.details = { approxChars: approx, maxChars: maxJsonChars };
        throw err;
      }
    } catch (e) {
      if (e?.status === 413) throw e;
      // If JSON.stringify fails (shouldn't), ignore and proceed.
    }
    const userId = req.user.id;

    // Load plan from DB (single source of truth)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });

    sseHeaders(res);

    let closed = false;
    req.on("close", () => {
      closed = true;
    });

    const controller = new AbortController();
    if (closed) controller.abort();

    const locale = pickRequestLocale(body.locale, req.headers["accept-language"]);

    // Send initial meta event to help the frontend show "which model is running"
    sseSend(res, "meta", {
      ok: true,
      stream: true,
      selectionMode: body.selectedModel ? "manual" : "auto",
    });

    const onDelta = (chunk) => {
      if (closed) return;
      sseSend(res, "delta", { text: chunk });
    };
    const onConversationUpdate = (conversation) => {
      if (closed || !conversation?.id) return;
      sseSend(res, "conversation", { conversation });
    };
    const onArtifactIntent = (artifact) => {
      if (closed || !artifact?.type) return;
      sseSend(res, "artifact", { artifact });
    };

    let out;
    try {
      out = await aiService.streamChat({
        userId,
        plan: user?.plan,
        selectionMode: body.selectionMode,
        selectedModelId: body.selectedModel,
        messages: body.messages,
        conversationId: body.conversationId,
        projectId: body.projectId,
        routingText: body.routingText,
        webSearchEnabled: body.webSearchEnabled,
        reasoningEnabled: body.reasoningEnabled,
        locale,
        onDelta,
        onConversationUpdate,
        onArtifactIntent,
        signal: controller.signal,
      });
    } catch (e) {
      if (!closed) {
        const transient = isTransientDbError(e);
        const status = transient ? 503 : e.status || 500;
        const errorCode = transient ? "DB_UNAVAILABLE" : e.message || "ERROR";
        const providerDetails =
          e?.details && typeof e.details === "object" && typeof e.details.provider === "string"
            ? {
                provider: e.details.provider,
                code: e.details.code || null,
                message: e.details.message || null,
                status: e.status || null,
              }
            : null;
        const details =
          providerDetails || (process.env.DEBUG_ERRORS === "1" ? e.details || null : null);
        sseSend(res, "error", {
          error: errorCode,
          status,
          details,
        });
        res.end();
      }
      return;
    }

    if (!closed) {
      if (process.env.DEBUG_AI === "1") {
        const promptCache = getPromptCacheMetrics(out?.usage) || null;
        console.log("[ai.chat] done", {
          requestId: out?.requestId || null,
          userId,
          conversationId: body?.conversationId || null,
          provider: out?.provider || null,
          model: out?.model || null,
          executedModel: out?.executedModel || out?.model || null,
          remoteModel: out?.remoteModel || null,
          usedRemoteModel: out?.usedRemoteModel || null,
          selectionMode: out?.selectionMode || null,
          fallbackFrom: out?.fallbackFrom || null,
          budgetForcedToDeepseek: Boolean(out?.budgetForcedToDeepseek),
          estimatedCostUsd: out?.estimatedCostUsd ?? null,
          webSearch: Boolean(out?.webSearch),
          webSearchDenied: Boolean(out?.webSearchDenied),
          usage: out?.usage || null,
          promptCache,
        });
      }

      sseSend(res, "done", {
        requestId: out.requestId,
        provider: out.provider,
        model: out.model,
        remoteModel: out.remoteModel,
        usedRemoteModel: out.usedRemoteModel || null,
        usedApiVersion: out.usedApiVersion || null,
        usedTransport: out.usedTransport || null,
        selectionMode: out.selectionMode,
        usage: out.usage,
        fallbackFrom: out.fallbackFrom || null,
        webSearch: Boolean(out.webSearch),
        webSearchDenied: Boolean(out.webSearchDenied),
        sources: out.sources || null,
        artifact: out.artifact || null,
      });
      res.end();
    }
  } catch (e) {
    next(e);
  }
}

async function models(req, res, next) {
  try {
    const userId = req.user.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });

    const plan = normalizePlan(user?.plan);
    const paid = isPaidPlan(plan);

    const models = listModels().map((m) => ({
      id: m.id,
      provider: m.provider,
      tier: m.tier,
      allowed: paid ? true : m.tier === "light",
    }));

    res.json({ plan, models });
  } catch (e) {
    next(e);
  }
}

module.exports = { chat, models };
