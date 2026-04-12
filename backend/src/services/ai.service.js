const fs = require("fs/promises");
const path = require("path");
const prisma = require("../lib/prisma");
const { z } = require("zod");
const { randomUUID } = require("crypto");
const {
  isPaidPlan,
  normalizePlan,
  getMonthlyTextInternalBudgetUsd,
  getMessageAttachmentLimit,
} = require("../config/plans");
const planService = require("./plan.service");
const memoryService = require("./memory.service");
const { getModel } = require("../ai/models");
const { chooseModel } = require("../ai/router");
const { runInProviderQueue } = require("../ai/queues");
const { getProvider } = require("../ai/providers");
const {
  ARTIFACT_MARKER_PREFIX,
  inferExplicitArtifactRequest,
  buildArtifactModeSystemMessage,
  extractArtifactEnvelope,
  artifactFromTextEnvelope,
} = require("../ai/artifacts");
const { searchLayer, buildInjectedWebContext } = require("../ai/websearch");

const memoryExtractorLastRunByUser = new Map();
const projectFileTextCache = new Map();
const PROJECT_CONTEXT_TEXT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "tsv",
  "js",
  "ts",
  "jsx",
  "tsx",
  "py",
  "java",
  "c",
  "cpp",
  "cc",
  "cxx",
  "cs",
  "go",
  "rs",
  "php",
  "rb",
  "sql",
  "yaml",
  "yml",
  "html",
  "css",
  "xml",
  "log",
]);

const memoryOpsSchema = z
  .object({
    add: z
      .array(
        z.object({
          content: z.string().min(1),
          category: z
            .enum(["PERSONAL_INFO", "PREFERENCES", "WORK", "STYLE", "TECH_STACK", "OTHER"])
            .optional(),
        })
      )
      .optional(),
    update: z
      .array(
        z.object({
          id: z.string().min(1),
          content: z.string().min(1),
          category: z
            .enum(["PERSONAL_INFO", "PREFERENCES", "WORK", "STYLE", "TECH_STACK", "OTHER"])
            .optional(),
        })
      )
      .optional(),
    delete: z.array(z.object({ id: z.string().min(1) })).optional(),
  })
  .strict();

function extractFirstJsonObject(text) {
  const s = String(text || "");
  const i = s.indexOf("{");
  const j = s.lastIndexOf("}");
  if (i < 0 || j < 0 || j <= i) return null;
  return s.slice(i, j + 1);
}

const MEMORY_AUTO_MAX_CHARS =
  Number.parseInt(process.env.MEMORY_AUTO_MAX_CHARS || "500", 10) || 500;

function buildRecentMemoryContextBlock({ messages, userText }) {
  const maxMessages =
    Number.parseInt(process.env.MEMORY_EXTRACTOR_CONTEXT_MESSAGES || "12", 10) || 12;
  const maxChars =
    Number.parseInt(process.env.MEMORY_EXTRACTOR_CONTEXT_MAX_CHARS || "8000", 10) || 8000;

  const currentUserText = memoryService.normalizeContent(userText || "");
  const filtered = (Array.isArray(messages) ? messages : [])
    .filter((m) => {
      const role = String(m?.role || "");
      return role === "user" || role === "assistant";
    })
    .map((m) => ({
      role: String(m.role || "user"),
      text: memoryService.normalizeContent(extractTextFromContent(m.content || "")),
    }))
    .filter((m) => m.text)
    .slice(-Math.max(1, maxMessages));

  if (filtered.length === 0) return "(none)";

  if (
    currentUserText &&
    filtered.length > 0 &&
    filtered[filtered.length - 1].role === "user" &&
    filtered[filtered.length - 1].text === currentUserText
  ) {
    filtered.pop();
  }

  if (filtered.length === 0) return "(none)";

  const lines = [];
  let used = 0;
  for (const item of filtered) {
    const label = item.role === "assistant" ? "ASSISTANT" : "USER";
    const room = Math.max(0, maxChars - used - label.length - 4);
    if (room <= 0) break;
    const line = `${label}: ${item.text.slice(0, room)}`;
    lines.push(line);
    used += line.length + 1;
    if (used >= maxChars) break;
  }

  return lines.join("\n") || "(none)";
}

async function runMemoryExtractorOnce({
  modelObj,
  existingLines,
  recentContext,
  userText,
  plan,
  signal,
}) {
  const provider = getProvider(modelObj.provider);
  if (!provider) return null;

  const system = {
    role: "system",
    content:
      "You extract persistent user memory from chat. " +
      "Never guess or infer; only include facts explicitly stated by the USER. " +
      "A request to remember/save something can be phrased in ANY language; decide based on intent, not keywords. " +
      "Write every added or updated memory in the same language as the USER's LAST_TURN message. " +
      "Do not translate memories into another language unless the USER spoke in that language in LAST_TURN. " +
      "If an existing memory has the same meaning but is written in a different language, prefer update over add and rewrite it into the language of LAST_TURN. " +
      "Do not create duplicate memories that only differ by language, wording, formatting, abbreviations, or level of detail. " +
      "Return JSON only (no markdown, no extra keys). " +
      "Schema: {\"add\":[{\"content\":\"...\",\"category\":\"...\"}],\"update\":[{\"id\":\"...\",\"content\":\"...\",\"category\":\"...\"}],\"delete\":[{\"id\":\"...\"}]}. " +
      "Only include stable, reusable facts/preferences about the user (preferences, background, work, style, tech stack). " +
      "Be more proactive about saving useful long-term memory; when in doubt, prefer saving over skipping. " +
      "Treat ongoing projects/products/features the user is building as WORK. " +
      "Be proactively helpful and slightly biased toward saving useful durable memory instead of missing it. " +
      "If a fact, preference, goal, constraint, or piece of work context is likely to remain useful in future chats, prefer add/update even when the USER did not explicitly ask to remember it. " +
      "Capture durable goals, constraints, priorities, default assumptions, business context, target audience, preferred language/locale, and recurring workflow choices when they are likely to help future conversations. " +
      "If the user is building a product/company/app/platform, prefer saving compact WORK memories about what it is, who it is for, what matters, and how they want it run or positioned. " +
      "Also save durable context about ongoing projects, products, businesses, clients, recurring tasks, success criteria, decision principles, and ways of working when specific enough to be useful later. " +
      "When LAST_TURN says things like 'save this', 'remember this', 'guarda isto', 'memoriza isso', or otherwise refers deictically, resolve the reference from RECENT_CONTEXT. " +
      "If RECENT_CONTEXT does not make the target unambiguous, return empty ops instead of guessing. " +
      "For WORK memories, store a self-contained description that includes both the identifier/name and what it is, goal, or scope. " +
      "Bad WORK memory: 'Dashboard CEO'. Good WORK memory: 'Dashboard CEO da Core AI: painel interno para monitorizar métricas do negócio, pagamentos e saúde do produto.' " +
      "Do not merge unrelated projects/features into a single memory. If two different work items appear in context, keep them separate or do nothing unless the user clearly specified which one to save. " +
      "Prefer update over add when the same project/feature gets more detail. " +
      `Keep WORK memories concise but complete (1-3 sentences, <= ${MEMORY_AUTO_MAX_CHARS} chars). ` +
      "If the user expresses response style preferences (long/short, detailed/direct), capture it under STYLE. " +
      "If the user mentions recurring product, startup, or business decisions, capture them under WORK even when they are not phrased as explicit preferences. " +
      `If the user mentions what tools/frameworks they use, capture a compact TECH_STACK line (<= ${MEMORY_AUTO_MAX_CHARS} chars). ` +
      `If the user states their name, preferred name, how they want to be addressed, or their age, store it under PERSONAL_INFO (<= ${MEMORY_AUTO_MAX_CHARS} chars). ` +
      `If the user states long-lived personal profile details such as nationality, city/country, occupation, company role, or broad experience level, store them under PERSONAL_INFO when explicit (<= ${MEMORY_AUTO_MAX_CHARS} chars). ` +
      `If the user states stable dislikes/likes, default operating choices, or persistent constraints, capture them under PREFERENCES (<= ${MEMORY_AUTO_MAX_CHARS} chars). ` +
      "If the user explicitly asks you to remember/save their portfolio/holdings, store a compact snapshot under OTHER " +
      `as: "Portfolio snapshot: TICKER EUR_AMOUNT; ..." (max 6 positions, <= ${MEMORY_AUTO_MAX_CHARS} chars). ` +
      "Do not store secrets (passwords, API keys) or highly sensitive personal data unless the user explicitly requests it. " +
      "Ignore clearly temporary or session-only info that is unlikely to help future chats. When unsure, prefer a concise memory if it looks durable and useful. Avoid duplicates. Use update when new info supersedes or restates an existing memory.",
  };

  const userMsg = {
    role: "user",
    content:
      "EXISTING_MEMORIES (tab-separated: id\\tcategory\\tcontent):\n" +
      (existingLines || "(none)") +
      "\n\nRECENT_CONTEXT (older to newer; user/assistant messages only):\n" +
      String(recentContext || "(none)") +
      "\n\nLAST_TURN (USER message only):\n" +
      String(userText || "").slice(0, 6000),
  };

  let raw = "";
  try {
    await runInProviderQueue(
      modelObj.provider,
      ({ signal: qSignal }) =>
        provider.streamChat({
          remoteModel: modelObj.remoteModel,
          messages: [system, userMsg],
          onDelta: (d) => {
            if (typeof d === "string") raw += d;
          },
          signal: qSignal,
        }),
      // Low priority: memory extraction is background and should not block interactive chat.
      { type: "text", plan, priority: 0, signal, maxRetries: 1 }
    );
  } catch (e) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[memory] extractor error", {
        message: e?.message || String(e),
        provider: modelObj.provider,
        model: modelObj.id,
        remoteModel: modelObj.remoteModel,
      });
    }
    return null;
  }

  const json = extractFirstJsonObject(raw);
  if (!json) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[memory] extractor non-json output", {
        provider: modelObj.provider,
        model: modelObj.id,
        sample: String(raw || "").slice(0, 400),
      });
    }
    return null;
  }

  try {
    return memoryOpsSchema.parse(JSON.parse(json));
  } catch {
    if (process.env.DEBUG_AI === "1") {
      console.error("[memory] extractor invalid json", {
        provider: modelObj.provider,
        model: modelObj.id,
        sample: String(raw || "").slice(0, 400),
      });
    }
    return null;
  }
}

// NOTE: We intentionally avoid deterministic keyword-based "memory capture" rules here.
// Memory extraction is performed by a small LLM so it works across languages and phrasing.

async function buildMemoryCapabilitySystemMessage({ userId, plan }) {
  const normalizedPlan = normalizePlan(plan);
  const limit = memoryService.getMemoryLimit(normalizedPlan);
  if (!limit || limit <= 0) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { memoryEnabled: true },
  });
  if (!user?.memoryEnabled) return null;

  return {
    role: "system",
    content:
      "Persistent user memory is ENABLED for this user. " +
      "When the user explicitly asks you to remember something, comply if it is a stable preference/fact. " +
      "Do not claim you cannot remember across chats. " +
      "If the user asks to remember something highly changeable (e.g. a portfolio snapshot), you may still store it as a snapshot when explicitly requested.",
  };
}

const MEMORY_CORE_CATEGORY_PRIORITY = {
  PERSONAL_INFO: 5,
  STYLE: 4,
  PREFERENCES: 3,
  WORK: 2,
  TECH_STACK: 2,
  OTHER: 1,
};

function unique(arr) {
  return [...new Set(arr)];
}

function extractMemoryMatchTokens(text) {
  const src = String(text || "").toLowerCase();
  const words = src.match(/\p{L}[\p{L}\p{N}_./+-]*/gu) || [];
  return unique(
    words
      .map((w) => w.normalize("NFKC"))
      .filter((w) => w.length >= 3)
  );
}

function extractNumericTokens(text) {
  return unique(String(text || "").match(/\b\d+(?:[.,]\d+)?\b/g) || []);
}

function computeMemoryRelevanceScore(memory, userText) {
  const content = memoryService.normalizeContent(memory?.content || "");
  if (!content) return 0;

  const query = memoryService.normalizeContent(userText || "");
  if (!query) return 0;

  const memTokens = extractMemoryMatchTokens(content);
  const queryTokens = extractMemoryMatchTokens(query);
  const memNums = extractNumericTokens(content);
  const queryNums = extractNumericTokens(query);

  let score = 0;

  if (queryTokens.length > 0 && memTokens.length > 0) {
    const qSet = new Set(queryTokens);
    const overlap = memTokens.filter((t) => qSet.has(t));
    score += overlap.length * 3;
    if (overlap.length > 0) {
      score += Math.min(10, (overlap.length / Math.max(1, Math.min(memTokens.length, queryTokens.length))) * 10);
    }
  }

  if (queryNums.length > 0 && memNums.length > 0) {
    const qNumSet = new Set(queryNums);
    const numOverlap = memNums.filter((n) => qNumSet.has(n));
    score += numOverlap.length * 4;
  }

  const category = String(memory?.category || "OTHER").toUpperCase();
  if (category === "WORK" || category === "TECH_STACK") score += 0.6;
  if (category === "PREFERENCES" || category === "STYLE") score += 0.4;

  return score;
}

function pickCoreMemories(items, maxCount) {
  return [...items]
    .sort((a, b) => {
      const catDiff =
        (MEMORY_CORE_CATEGORY_PRIORITY[String(b?.category || "OTHER").toUpperCase()] || 0) -
        (MEMORY_CORE_CATEGORY_PRIORITY[String(a?.category || "OTHER").toUpperCase()] || 0);
      if (catDiff !== 0) return catDiff;
      return new Date(b?.updatedAt || 0).getTime() - new Date(a?.updatedAt || 0).getTime();
    })
    .slice(0, Math.max(0, maxCount));
}

function pickRelevantMemories(items, userText, maxCount) {
  const scored = items
    .map((m) => ({ memory: m, score: computeMemoryRelevanceScore(m, userText) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.memory?.updatedAt || 0).getTime() - new Date(a.memory?.updatedAt || 0).getTime();
    });

  return scored.slice(0, Math.max(0, maxCount)).map((x) => x.memory);
}

async function buildUserMemorySystemMessage({ userId, plan, userText }) {
  const normalizedPlan = normalizePlan(plan);
  const limit = memoryService.getMemoryLimit(normalizedPlan);
  if (!limit || limit <= 0) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { memoryEnabled: true },
  });
  if (!user?.memoryEnabled) return null;

  const itemsRaw = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: { content: true, category: true, source: true, updatedAt: true },
  });

  if (!itemsRaw || itemsRaw.length === 0) return null;

  // Safety: don't inject potentially hallucinated sensitive facts (keep them in DB but omit from prompt).
  // Users can always edit/re-add manually via settings.
  const items = itemsRaw.filter((m) => {
    const src = String(m?.source || "AUTO").toUpperCase();
    if (src === "MANUAL") return true;

    const c = memoryService.normalizeContent(m?.content || "").toLowerCase();
    if (!c) return false;

    return true;
  });

  if (items.length === 0) return null;

  const maxCoreMemories =
    Number.parseInt(process.env.MEMORY_CONTEXT_CORE_MAX || "15", 10) || 15;
  const maxRelevantMemories =
    Number.parseInt(process.env.MEMORY_CONTEXT_RELEVANT_MAX || "25", 10) || 25;
  const maxChars =
    Number.parseInt(process.env.MEMORY_CONTEXT_MAX_CHARS || "7000", 10) || 7000;

  const coreMemories = pickCoreMemories(items, Math.min(maxCoreMemories, items.length));
  const coreKeys = new Set(
    coreMemories
      .map((m) => memoryService.normalizeContent(m?.content || "").toLowerCase())
      .filter(Boolean)
  );

  const relevantCandidates = items.filter((m) => {
    const key = memoryService.normalizeContent(m?.content || "").toLowerCase();
    return key && !coreKeys.has(key);
  });
  const relevantMemories = pickRelevantMemories(
    relevantCandidates,
    userText,
    Math.min(maxRelevantMemories, relevantCandidates.length)
  );

  const selected = [];
  const seen = new Set();
  for (const m of [...coreMemories, ...relevantMemories]) {
    const c = memoryService.normalizeContent(m?.content || "");
    const key = c.toLowerCase();
    if (!c || seen.has(key)) continue;
    seen.add(key);
    selected.push({ ...m, content: c });
  }

  const sections = [];
  const selectedCore = [];
  const selectedRelevant = [];
  const relevantKeySet = new Set(
    relevantMemories
      .map((m) => memoryService.normalizeContent(m?.content || "").toLowerCase())
      .filter(Boolean)
  );

  for (const m of selected) {
    if (relevantKeySet.has(String(m.content || "").toLowerCase())) selectedRelevant.push(m);
    else selectedCore.push(m);
  }

  const pushSectionLines = (title, memories) => {
    if (!Array.isArray(memories) || memories.length === 0) return;
    const lines = [];
    for (const m of memories) {
      const line = `- (${String(m.category || "OTHER")}) ${m.content}`;
      const nextLen =
        sections.join("\n").length + lines.join("\n").length + line.length + title.length + 16;
      if (nextLen > maxChars) break;
      lines.push(line);
    }
    if (lines.length > 0) sections.push(`${title}\n${lines.join("\n")}`);
  };

  pushSectionLines("[CORE MEMORY]", selectedCore);
  pushSectionLines("[RELEVANT TO THIS MESSAGE]", selectedRelevant);

  if (sections.length === 0) return null;

  if (process.env.DEBUG_AI === "1") {
    console.error("[memory] injecting", {
      userId,
      plan: normalizedPlan,
      count: selected.length,
      coreCount: selectedCore.length,
      relevantCount: selectedRelevant.length,
      candidates: items.length,
      hasUserText: Boolean(String(userText || "").trim()),
    });
  }

  return {
    role: "system",
    content:
      "[USER MEMORY]\n" +
      "This is verified context about the user. Use it to personalize answers when relevant. " +
      "Do not invent extra details. Do not mention this block unless the user asks.\n" +
      `${sections.join("\n\n")}\n` +
      "[/USER MEMORY]",
  };
}

async function maybeUpdateConversationSummary({ userId, conversationId, plan, signal } = {}) {
  const enabled = String(process.env.CONVERSATION_SUMMARY_ENABLED || "1").trim() !== "0";
  if (!enabled) return;
  if (!conversationId) return;

  const maxContextMessages =
    Number.parseInt(process.env.CONVERSATION_CONTEXT_MAX_MESSAGES || "24", 10) || 24;
  const minDelta =
    Number.parseInt(process.env.CONVERSATION_SUMMARY_EVERY_N_MESSAGES || "8", 10) || 8;
  const maxNewMessages =
    Number.parseInt(process.env.CONVERSATION_SUMMARY_MAX_NEW_MESSAGES || "40", 10) || 40;

  const convo = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: { id: true, summary: true, summaryMessageCount: true },
  });
  if (!convo) return;

  const total = await prisma.message.count({ where: { conversationId } });
  const targetSummarized = Math.max(0, total - maxContextMessages);
  if (targetSummarized <= 0) return;

  const already = Number(convo.summaryMessageCount || 0) || 0;
  const prevSummary = String(convo.summary || "").trim();
  const delta = targetSummarized - already;

  // If we already have a summary and only a couple new messages fell outside the window, skip.
  if (prevSummary && delta > 0 && delta < minDelta) return;

  const take = Math.max(0, Math.min(maxNewMessages, delta));
  if (take <= 0) return;

  const newMsgs = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    skip: already,
    take,
    select: { role: true, content: true },
  });

  if (!newMsgs || newMsgs.length === 0) return;

  const modelId = String(process.env.CONVERSATION_SUMMARY_MODEL || "gpt-5-nano").trim() || "gpt-5-nano";
  const modelObj = getModel(modelId) || getModel("gpt-5-nano");
  if (!modelObj || !modelObj.provider) return;

  const provider = getProvider(modelObj.provider);
  if (!provider) return;

  const transcript = newMsgs
    .map((m) => {
      const role = String(m?.role || "").toLowerCase();
      const tag = role === "assistant" ? "ASSISTANT" : role === "system" ? "SYSTEM" : "USER";
      const content = String(m?.content || "").replace(/\s+/g, " ").trim();
      return `${tag}: ${content.slice(0, 600)}`;
    })
    .join("\n");

  const system = {
    role: "system",
    content:
      "You maintain a compact running summary of a chat conversation to reduce context size. " +
      "Update the summary using the NEW_MESSAGES chunk. " +
      "Keep it factual, omit fluff, and keep names/IDs exact. " +
      "Do not add anything that wasn't said. " +
      "Return plain text only (no JSON, no markdown fences). " +
      "Target length: 8-16 short bullet points max.",
  };

  const user = {
    role: "user",
    content:
      "PREVIOUS_SUMMARY:\n" +
      (prevSummary || "(none)") +
      "\n\nNEW_MESSAGES:\n" +
      transcript +
      "\n\nWrite the UPDATED_SUMMARY now.",
  };

  let raw = "";
  try {
    await runInProviderQueue(
      modelObj.provider,
      ({ signal: qSignal }) =>
        provider.streamChat({
          remoteModel: modelObj.remoteModel,
          messages: [system, user],
          onDelta: (d) => {
            if (typeof d === "string") raw += d;
          },
          signal: qSignal,
        }),
      // Very low priority: this is best-effort background work.
      { type: "text", plan: normalizePlan(plan), priority: 0, signal, maxRetries: 0 }
    );
  } catch (e) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[chat.summary] error", {
        message: e?.message || String(e),
        provider: modelObj.provider,
        model: modelObj.id,
        remoteModel: modelObj.remoteModel,
      });
    }
    return;
  }

  const summary = String(raw || "").trim();
  if (!summary) return;

  try {
    await prisma.conversation.update({
      where: { id: convo.id },
      data: {
        summary,
        summaryUpdatedAt: new Date(),
        summaryMessageCount: already + newMsgs.length,
      },
      select: { id: true },
    });
  } catch (e) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[chat.summary] persist error", { message: e?.message || String(e) });
    }
  }
}

async function extractAndPersistUserMemory({
  userId,
  plan,
  contextMessages,
  userText,
  signal,
}) {
  const normalizedPlan = normalizePlan(plan);
  const limit = memoryService.getMemoryLimit(normalizedPlan);
  if (!limit || limit <= 0) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { memoryEnabled: true },
  });
  if (!user?.memoryEnabled) return;

  const existingMax =
    Number.parseInt(process.env.MEMORY_EXTRACTOR_EXISTING_MAX || "120", 10) || 120;

  const existing = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: Math.min(existingMax, Math.max(20, limit)),
    select: { id: true, content: true, category: true, source: true },
  });

  const existingLines = existing
    .map((m) => {
      const c = memoryService.normalizeContent(m.content).slice(0, Math.min(400, MEMORY_AUTO_MAX_CHARS));
      return `${m.id}\t${m.category}\t${c}`;
    })
    .join("\n");

  const recentContext = buildRecentMemoryContextBlock({ messages: contextMessages, userText });

  // Always use GPT-5 Nano for memory extraction.
  // Rationale:
  // - deterministic cost/latency
  // - consistent JSON behavior with our strict schema
  // - avoids expensive fallbacks (e.g. gpt-5.4) for a background task
  const primaryModel = getModel("gpt-5-nano");
  if (!primaryModel || !primaryModel.provider) return;

  let ops = await runMemoryExtractorOnce({
    modelObj: primaryModel,
    existingLines,
    recentContext,
    userText,
    plan: normalizedPlan,
    signal,
  });

  if (!ops) return;

  const add = Array.isArray(ops.add) ? ops.add.slice(0, 16) : [];
  const update = Array.isArray(ops.update) ? ops.update.slice(0, 16) : [];
  const del = Array.isArray(ops.delete) ? ops.delete.slice(0, 16) : [];

  const existingById = new Map(existing.map((m) => [m.id, m]));
  const existingNorm = new Set(
    existing.map((m) => memoryService.normalizeContent(m.content).toLowerCase()).filter(Boolean)
  );

  const toAdd = [];

  for (const a of add) {
    const content = memoryService.normalizeContent(a.content).slice(0, MEMORY_AUTO_MAX_CHARS);
    if (!content) continue;

    // Guardrail: reject common hallucinated "age" facts unless the user explicitly provided age.
    // This keeps v1 safe without requiring evidence spans/embeddings.
    const lcUser = String(userText || "").toLowerCase();
    const lcContent = content.toLowerCase();
    if (
      (lcContent.includes("idade") ||
        lcContent.includes("anos") ||
        lcContent.includes("age") ||
        lcContent.includes("years old")) &&
      /\b\d{1,3}\b/.test(lcContent) &&
      !(
        lcUser.includes("idade") ||
        lcUser.includes("anos") ||
        lcUser.includes("age") ||
        lcUser.includes("years old") ||
        /\btenho\s+\d{1,3}\b/.test(lcUser) ||
        /\bi['â€™]m\s+\d{1,3}\b/.test(lcUser)
      )
    ) {
      continue;
    }

    const key = content.toLowerCase();
    if (existingNorm.has(key)) continue;
    existingNorm.add(key);

    const category = a.category ? memoryService.normalizeCategory(a.category) : null;
    toAdd.push({
      content,
      category: category || "OTHER",
      source: "AUTO",
    });
  }

  await prisma.$transaction(async (tx) => {
    for (const u of update) {
      const prev = existingById.get(u.id);
      if (!prev) continue;
      const content = memoryService.normalizeContent(u.content).slice(0, MEMORY_AUTO_MAX_CHARS);
      if (!content) continue;

      const category = u.category ? memoryService.normalizeCategory(u.category) : null;

      // Avoid turning an automatic pass into a destructive overwrite of a user's manual edit.
      // We still allow updates, but preserve `source` and only update what changed.
      try {
        await tx.userMemory.update({
          where: { id: prev.id },
          data: {
            content,
            ...(category ? { category } : null),
          },
        });
      } catch (e) {
        // Ignore uniqueness collisions (likely duplicate content).
        if (String(e?.code || "") !== "P2002") throw e;
      }
    }

    if (toAdd.length > 0) {
      await tx.userMemory.createMany({
        data: toAdd.map((x) => ({ ...x, userId })),
        skipDuplicates: true,
      });
    }

    if (del.length > 0) {
      const ids = del
        .map((d) => String(d?.id || ""))
        .filter(Boolean)
        .filter((id) => existingById.has(id));
      if (ids.length > 0) {
        await tx.userMemory.deleteMany({ where: { userId, id: { in: ids } } });
      }
    }
  });

  if (process.env.DEBUG_AI === "1") {
    console.error("[memory] extracted ops", {
      userId,
      plan: normalizedPlan,
      add: toAdd.length,
      update: update.length,
      delete: del.length,
    });
  }

  await memoryService.enforceMemoryLimit({ userId, plan: normalizedPlan });
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const p of content) {
      if (!p || typeof p !== "object") continue;
      const t = String(p.type || "");
      if (t === "text" || t === "input_text") {
        const v =
          typeof p.text === "string"
            ? p.text
            : typeof p.content === "string"
              ? p.content
              : "";
        if (v) parts.push(v);
      }
    }
    return parts.join("");
  }
  return "";
}

function safeHostname(url) {
  try {
    const u = new URL(String(url || ""));
    return String(u.hostname || "").replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function replaceNumericCitationsWithHosts(text, sources) {
  const list = Array.isArray(sources) ? sources : [];
  const srcFor = (n) => {
    const idx = Number(n) - 1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= list.length) return null;
    const src = list[idx];
    const url = typeof src?.url === "string" ? src.url : "";
    if (!url) return null;
    const host = (typeof src?.host === "string" && src.host) || safeHostname(url) || "source";
    return { host, url };
  };

  // Match common citation marker variants:
  // - ASCII: [1]
  // - Fullwidth: ï¼»1ï¼½
  // - CJK: ã€1ã€‘
  // Avoid breaking existing Markdown links like `[1](https://...)` by not matching when `(` follows.
  const re =
    /(?:\[\s*(\d{1,3})\s*\](?!\s*\()|\uFF3B\s*(\d{1,3})\s*\uFF3D(?!\s*\()|ã€\s*(\d{1,3})\s*ã€‘(?!\s*\())/g;

  return String(text || "").replace(re, (m, a, b, c) => {
    const n = a || b || c;
    const src = srcFor(n);
    if (!src) return "";
    return ` [${src.host}](${src.url})`;
  });
}

function createCitationStreamTransformer({ sources } = {}) {
  const list = Array.isArray(sources) ? sources : [];
  if (list.length === 0) {
    return { push: (chunk) => String(chunk || ""), flush: () => "" };
  }

  let carry = "";
  const maxCarry = 12; // enough to hold "[123]" split across chunks

  function process(s) {
    return replaceNumericCitationsWithHosts(s, list);
  }

  return {
    push(chunk) {
      const input = carry + String(chunk || "");
      if (input.length <= maxCarry) {
        carry = input;
        return "";
      }
      const head = input.slice(0, input.length - maxCarry);
      carry = input.slice(input.length - maxCarry);
      return process(head);
    },
    flush() {
      const out = process(carry);
      carry = "";
      return out;
    },
  };
}

function buildArtifactAssistantText({ artifactType, locale }) {
  const lang = String(locale || "").toLowerCase();
  const isPortuguese = lang.startsWith("pt");
  if (artifactType === "document") {
    return isPortuguese ? "Preparei o documento." : "I prepared the document.";
  }
  return isPortuguese ? "Preparei os slides." : "I prepared the slides.";
}

function contentHasMediaParts(content) {
  if (!Array.isArray(content)) return false;
  return content.some((p) => {
    if (!p || typeof p !== "object") return false;
    const t = String(p.type || "");
    return t === "image_url" || t === "file" || t === "document" || t === "input_file";
  });
}

function keepOnlyTextParts(content) {
  return extractTextFromContent(content);
}

function keepOnlyMediaParts(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    const t = String(p.type || "");
    if (t === "image_url" || t === "file" || t === "document" || t === "input_file") out.push(p);
  }
  return out;
}

function assertMessageAttachmentLimit({ plan, attachmentCount }) {
  const count = Number(attachmentCount || 0);
  if (count <= 0) return null;

  const normalizedPlan = normalizePlan(plan);
  const limit = getMessageAttachmentLimit(normalizedPlan);
  if (count <= limit) {
    return { plan: normalizedPlan, limit, requested: count };
  }

  const err = new Error("ATTACHMENTS_PER_MESSAGE_LIMIT_REACHED");
  err.status = 403;
  err.details = { plan: normalizedPlan, limit, requested: count };
  throw err;
}

function keepOnlyDocParts(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    const t = String(p.type || "");
    if (t === "file" || t === "document" || t === "input_file") out.push(p);
  }
  return out;
}

function keepOnlyImageParts(content) {
  if (!Array.isArray(content)) return [];
  const out = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    const t = String(p.type || "");
    if (t === "image_url") out.push(p);
  }
  return out;
}

function decodeDataUrl(dataUrl) {
  const raw = String(dataUrl || "");
  const m = raw.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  try {
    return { mime, buf: Buffer.from(b64, "base64") };
  } catch {
    return null;
  }
}

function getDocPartFile(part) {
  if (!part || typeof part !== "object") return null;
  const t = String(part.type || "");
  if (t === "file" && part.file && typeof part.file === "object") return part.file;
  if (t === "document" && part.document && typeof part.document === "object") return part.document;
  if (t === "input_file" && part.input_file && typeof part.input_file === "object") return part.input_file;
  return null;
}

function isPdfLike({ mimeType, name }) {
  const mt = String(mimeType || "").toLowerCase();
  const nm = String(name || "").toLowerCase();
  return mt.includes("pdf") || nm.endsWith(".pdf");
}

function isDocxLike({ mimeType, name }) {
  const mt = String(mimeType || "").toLowerCase();
  const nm = String(name || "").toLowerCase();
  return mt.includes("officedocument.wordprocessingml.document") || nm.endsWith(".docx");
}

async function extractDocPartsTextLocally({ docParts, signal }) {
  const parts = Array.isArray(docParts) ? docParts : [];
  if (parts.length === 0) return null;

  const maxBytesPerFile =
    Number.parseInt(process.env.ATTACHMENTS_DOC_MAX_BYTES || "6000000", 10) || 6000000;
  const maxPages =
    Math.max(1, Number.parseInt(process.env.ATTACHMENTS_PDF_MAX_PAGES || "20", 10) || 20);
  const maxCharsPerFile =
    Math.max(2000, Number.parseInt(process.env.ATTACHMENTS_DOC_MAX_CHARS_PER_FILE || "18000", 10) || 18000);
  const maxTotalChars =
    Math.max(5000, Number.parseInt(process.env.ATTACHMENTS_DOC_MAX_TOTAL_CHARS || "45000", 10) || 45000);

  let total = 0;
  let processed = 0;
  const chunks = [];

  for (const p of parts) {
    if (signal?.aborted) break;
    const f = getDocPartFile(p);
    const url = f?.url;
    const name = String(f?.name || "");
    const mimeType = String(f?.mimeType || f?.mime || "");
    if (!url) continue;

    const decoded = decodeDataUrl(url);
    if (!decoded?.buf) continue;
    if (decoded.buf.length > maxBytesPerFile) {
      chunks.push(`Ficheiro: ${name || "(sem nome)"}\n[Ignorado: demasiado grande para analisar automaticamente.]`);
      processed += 1;
      continue;
    }

    let extracted = "";
    try {
      if (isPdfLike({ mimeType: mimeType || decoded.mime, name })) {
        const pdfParse = require("pdf-parse");
        const out = await pdfParse(decoded.buf, { max: maxPages });
        extracted = String(out?.text || "").trim();
      } else if (isDocxLike({ mimeType: mimeType || decoded.mime, name })) {
        const mammoth = require("mammoth");
        const out = await mammoth.extractRawText({ buffer: decoded.buf });
        extracted = String(out?.value || "").trim();
      } else {
        extracted = decoded.buf.toString("utf8").trim();
      }
    } catch (e) {
      if (process.env.DEBUG_AI === "1") {
        console.error("[attachments] local doc extract error", { name, mimeType, message: e?.message || String(e) });
      }
      extracted = "";
    }

    processed += 1;
    if (!extracted) {
      chunks.push(`Ficheiro: ${name || "(sem nome)"}\n[Sem texto extraÃƒÂ­vel ou formato nÃƒÂ£o suportado.]`);
      continue;
    }

    const remaining = Math.max(0, maxTotalChars - total);
    if (remaining <= 0) break;

    const clipped = extracted.slice(0, Math.min(maxCharsPerFile, remaining));
    total += clipped.length;
    chunks.push(`Ficheiro: ${name || "(sem nome)"}\n\n${clipped}${extracted.length > clipped.length ? "\n...[truncado]" : ""}`);
  }

  if (chunks.length === 0) return null;
  const header = `Anexos analisados (docs): ${processed}/${parts.length}.`;
  return `${header}\n\n${chunks.join("\n\n")}`.trim();
}

function getProjectContextConfig() {
  return {
    maxFiles: Math.max(1, Number.parseInt(process.env.PROJECT_CONTEXT_MAX_FILES || "4", 10) || 4),
    maxBytesPerFile:
      Math.max(200000, Number.parseInt(process.env.PROJECT_CONTEXT_MAX_FILE_BYTES || "6000000", 10) || 6000000),
    maxCharsPerFile:
      Math.max(
        1000,
        Number.parseInt(process.env.PROJECT_CONTEXT_MAX_CHARS_PER_FILE || "12000", 10) || 12000
      ),
    maxTotalChars:
      Math.max(2000, Number.parseInt(process.env.PROJECT_CONTEXT_MAX_TOTAL_CHARS || "24000", 10) || 24000),
    maxInstructionChars:
      Math.max(
        1000,
        Number.parseInt(process.env.PROJECT_CONTEXT_MAX_INSTRUCTIONS_CHARS || "8000", 10) || 8000
      ),
    maxBriefChars:
      Math.max(400, Number.parseInt(process.env.PROJECT_CONTEXT_MAX_BRIEF_CHARS || "2000", 10) || 2000),
    maxPdfPages:
      Math.max(1, Number.parseInt(process.env.PROJECT_CONTEXT_PDF_MAX_PAGES || "12", 10) || 12),
    maxCacheEntries:
      Math.max(16, Number.parseInt(process.env.PROJECT_CONTEXT_CACHE_ENTRIES || "256", 10) || 256),
  };
}

function clipProjectContextText(text, maxChars) {
  const src = String(text || "").trim();
  if (!src) return "";
  if (src.length <= maxChars) return src;
  return `${src.slice(0, maxChars)}\n...[truncado]`;
}

function formatProjectFileSize(bytes) {
  if (!Number.isFinite(Number(bytes))) return "";
  const value = Number(bytes);
  const units = ["B", "KB", "MB", "GB"];
  let current = value;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function isTextLikeProjectFile(file) {
  const mime = String(file?.type || "").trim().toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json") return true;

  const name = String(file?.name || "").trim().toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  return PROJECT_CONTEXT_TEXT_EXTENSIONS.has(ext);
}

function buildProjectFileManifestLine(file) {
  const meta = [];
  if (file?.type) meta.push(String(file.type));
  const sizeLabel = formatProjectFileSize(file?.size);
  if (sizeLabel) meta.push(sizeLabel);
  return `- ${String(file?.name || "Untitled file")}${meta.length > 0 ? ` (${meta.join(", ")})` : ""}`;
}

function computeProjectFileRelevanceScore(file, userText) {
  const tokens = extractMemoryMatchTokens(userText);
  const haystack = `${String(file?.name || "")} ${String(file?.type || "")}`;
  const fileTokens = extractMemoryMatchTokens(haystack);
  const tokenSet = new Set(tokens);

  let score = 0;
  if (tokenSet.size > 0 && fileTokens.length > 0) {
    const overlap = fileTokens.filter((token) => tokenSet.has(token));
    score += overlap.length * 6;
    if (overlap.length > 0) {
      score += Math.min(5, overlap.length / Math.max(1, Math.min(fileTokens.length, tokenSet.size)));
    }
  }

  if (isPdfLike(file) || isDocxLike(file)) score += 1;
  if (isTextLikeProjectFile(file)) score += 0.6;
  return score;
}

function sortProjectFilesForContext(files, userText) {
  return [...(Array.isArray(files) ? files : [])].sort((left, right) => {
    const scoreDiff = computeProjectFileRelevanceScore(right, userText) - computeProjectFileRelevanceScore(left, userText);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(right?.updatedAt || right?.createdAt || 0).getTime() - new Date(left?.updatedAt || left?.createdAt || 0).getTime();
  });
}

async function extractProjectFileText({ projectId, file, signal }) {
  const config = getProjectContextConfig();
  const cacheKey = `${String(file?.id || "")}:${String(file?.updatedAt || file?.createdAt || "")}`;

  if (projectFileTextCache.has(cacheKey)) {
    return projectFileTextCache.get(cacheKey);
  }

  const promise = (async () => {
    if (signal?.aborted) return null;
    if (!projectId || !file?.storedName) {
      return { kind: "notice", text: "Ficheiro sem caminho legivel para contexto automatico." };
    }

    const diskPath = path.join(process.cwd(), "uploads", "projects", projectId, file.storedName);

    let buffer;
    try {
      buffer = await fs.readFile(diskPath);
    } catch {
      return { kind: "notice", text: "Ficheiro nao foi encontrado no disco." };
    }

    if (!buffer || buffer.length === 0) {
      return { kind: "notice", text: "Ficheiro vazio." };
    }

    if (buffer.length > config.maxBytesPerFile) {
      return { kind: "notice", text: "Ficheiro demasiado grande para analise automatica." };
    }

    let extracted = "";
    try {
      if (isPdfLike(file)) {
        const pdfParse = require("pdf-parse");
        const out = await pdfParse(buffer, { max: config.maxPdfPages });
        extracted = String(out?.text || "").trim();
      } else if (isDocxLike(file)) {
        const mammoth = require("mammoth");
        const out = await mammoth.extractRawText({ buffer });
        extracted = String(out?.value || "").trim();
      } else if (isTextLikeProjectFile(file)) {
        extracted = buffer.toString("utf8").trim();
      } else {
        return { kind: "notice", text: "Tipo de ficheiro ainda nao suportado para leitura automatica." };
      }
    } catch (e) {
      if (process.env.DEBUG_AI === "1") {
        console.error("[project.context] file extract error", {
          projectId,
          fileId: file?.id || null,
          name: file?.name || null,
          type: file?.type || null,
          message: e?.message || String(e),
        });
      }
      return { kind: "notice", text: "Nao foi possivel extrair texto deste ficheiro." };
    }

    if (!extracted) {
      return { kind: "notice", text: "Sem texto extraivel neste ficheiro." };
    }

    return { kind: "text", text: extracted };
  })();

  if (projectFileTextCache.size >= config.maxCacheEntries) {
    projectFileTextCache.clear();
  }
  projectFileTextCache.set(cacheKey, promise);

  try {
    return await promise;
  } catch (e) {
    projectFileTextCache.delete(cacheKey);
    throw e;
  }
}

async function resolveProjectContext({ userId, projectId, conversationId }) {
  const projectSelect = {
    id: true,
    name: true,
    brief: true,
    instructions: true,
    files: {
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        size: true,
        storedName: true,
        createdAt: true,
        updatedAt: true,
      },
    },
  };

  const explicitProjectId = String(projectId || "").trim();
  if (explicitProjectId) {
    const explicitProject = await prisma.project.findFirst({
      where: { id: explicitProjectId, userId },
      select: projectSelect,
    });
    if (explicitProject) return explicitProject;
  }

  const currentConversationId = String(conversationId || "").trim();
  if (!currentConversationId) return null;

  const projectChat = await prisma.projectChat.findFirst({
    where: {
      conversationId: currentConversationId,
      project: {
        userId,
      },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      project: {
        select: projectSelect,
      },
    },
  });

  return projectChat?.project || null;
}

async function buildProjectContextSystemMessages({ userId, projectId, conversationId, userText, signal }) {
  const project = await resolveProjectContext({ userId, projectId, conversationId });
  if (!project) return [];

  const config = getProjectContextConfig();
  const projectName = String(project.name || "Untitled project").trim() || "Untitled project";
  const brief = clipProjectContextText(project?.brief, config.maxBriefChars);
  const instructions = clipProjectContextText(project?.instructions, config.maxInstructionChars);
  const files = Array.isArray(project?.files) ? project.files : [];

  const hasVisibleContext = Boolean(brief || instructions || files.length > 0);
  if (!hasVisibleContext) return [];

  const overviewLines = [
    "The user is chatting inside a saved project. Use the project instructions and project files below as context whenever they are relevant.",
    `Project: ${projectName}`,
  ];

  if (brief) {
    overviewLines.push(`[PROJECT BRIEF]\n${brief}\n[/PROJECT BRIEF]`);
  }

  if (instructions) {
    overviewLines.push(`[PROJECT INSTRUCTIONS]\n${instructions}\n[/PROJECT INSTRUCTIONS]`);
  }

  if (files.length > 0) {
    overviewLines.push(`[PROJECT FILE MANIFEST]\n${files.map(buildProjectFileManifestLine).join("\n")}\n[/PROJECT FILE MANIFEST]`);
  }

  const messages = [
    {
      role: "system",
      content: overviewLines.join("\n\n"),
    },
  ];

  if (files.length === 0) return messages;

  const selectedFiles = sortProjectFilesForContext(files, userText).slice(0, config.maxFiles);
  const extractedChunks = [];
  const notices = [];
  let totalChars = 0;

  for (const file of selectedFiles) {
    if (signal?.aborted) break;
    const extracted = await extractProjectFileText({
      projectId: project.id,
      file,
      signal,
    });
    if (!extracted) continue;

    if (extracted.kind === "notice") {
      notices.push(`- ${String(file?.name || "Untitled file")}: ${extracted.text}`);
      continue;
    }

    const remaining = Math.max(0, config.maxTotalChars - totalChars);
    if (remaining <= 0) break;

    const clipped = clipProjectContextText(extracted.text, Math.min(config.maxCharsPerFile, remaining));
    if (!clipped) continue;

    totalChars += clipped.length;
    extractedChunks.push(`Ficheiro: ${String(file?.name || "Untitled file")}\n\n${clipped}`);
  }

  if (extractedChunks.length === 0 && notices.length === 0) return messages;

  const fileContextLines = [
    `[PROJECT FILE CONTEXT]\nSelected files analysed: ${selectedFiles.length}/${files.length}.`,
  ];

  if (notices.length > 0) {
    fileContextLines.push(`[PROJECT FILE NOTES]\n${notices.join("\n")}\n[/PROJECT FILE NOTES]`);
  }

  if (extractedChunks.length > 0) {
    fileContextLines.push(extractedChunks.join("\n\n"));
  }

  fileContextLines.push("[/PROJECT FILE CONTEXT]");

  messages.push({
    role: "system",
    content: fileContextLines.join("\n\n"),
  });

  return messages;
}

function trimMediaPartsInContent(content, maxMediaParts) {
  if (!Array.isArray(content)) return content;
  const maxN = Math.max(0, Number(maxMediaParts) || 0);
  if (maxN <= 0) return keepOnlyTextParts(content);

  let keptMedia = 0;
  const out = [];
  for (const p of content) {
    if (!p || typeof p !== "object") continue;
    const t = String(p.type || "");

    const isMedia = t === "image_url" || t === "file" || t === "document" || t === "input_file";
    if (!isMedia) {
      out.push(p);
      continue;
    }

    if (keptMedia >= maxN) continue;
    keptMedia += 1;
    out.push(p);
  }

  return out.length > 0 ? out : keepOnlyTextParts(content);
}

function getAttachmentExtractorMaxMediaParts(plan) {
  const globalRaw = process.env.ATTACHMENTS_MAX_MEDIA_PARTS;
  if (globalRaw != null && globalRaw !== "") {
    const n = Number.parseInt(String(globalRaw), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const paid = isPaidPlan(plan);
  const maxMediaPartsDefault = paid ? 10 : 4;
  const raw = paid
    ? process.env.ATTACHMENT_EXTRACTOR_MAX_MEDIA_PARTS_PAID
    : process.env.ATTACHMENT_EXTRACTOR_MAX_MEDIA_PARTS_FREE;
  if (raw == null || raw === "") return maxMediaPartsDefault;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : maxMediaPartsDefault;
}

function describeAttachmentPart(part, index, total) {
  const t = String(part?.type || "");
  const position = `Anexo ${index}/${total}`;

  if (t === "image_url") {
    const detail = String(part?.image_url?.detail || "").trim();
    return detail ? `${position} - imagem (${detail})` : `${position} - imagem`;
  }

  const file = getDocPartFile(part);
  const name = String(file?.name || "").trim();
  const mimeType = String(file?.mimeType || file?.mime || "").trim();
  const kind = isPdfLike({ mimeType, name })
    ? "pdf"
    : isDocxLike({ mimeType, name })
      ? "docx"
      : mimeType || "ficheiro";

  if (name) return `${position} - ${kind} - ${name}`;
  return `${position} - ${kind}`;
}

function buildAttachmentExtractorUserContent({ userText, batch, batchOffset, total }) {
  const contextText = String(userText || "").trim().slice(0, 4000);
  const intro = [
    "Objetivo: ler os anexos como se fosses um modelo com vision e devolver contexto fiel para um modelo sem visao.",
    "Analisa todos os anexos deste lote sem saltar nenhum.",
    "Prioridades:",
    "1. Transcrever com fidelidade todo o texto legivel.",
    "2. Seguir a ordem natural de leitura e manter a estrutura original sempre que possivel.",
    "3. Identificar perguntas, opcoes, titulos, legendas, labels, tabelas, codigo, formulas, graficos, unidades, eixos, mensagens de erro e pequenos textos laterais.",
    "4. Descrever elementos sem texto, incluindo diagramas, circuitos, setas, ligacoes, componentes, simbolos e estrutura visual.",
    "5. Nao resumir cedo demais, nao juntar anexos diferentes e nao inventar detalhes ausentes.",
    "6. Se alguma parte estiver ilegivel, cortada, tapada ou ambigua, assinala isso explicitamente.",
    "Checklist obrigatoria: inclui tambem notas de rodape, cabecalhos, rodapes, etiquetas pequenas, referencias numericas e qualquer texto dentro de caixas, botoes ou imagens.",
    "Formato obrigatorio por anexo:",
    "- Anexo N",
    "- Tipo",
    "- Texto visivel",
    "- Elementos visuais relevantes",
    "- Estrutura / perguntas / dados",
    "- Interpretacao util",
    "- Partes ambiguas ou ilegiveis",
  ];
  if (contextText) {
    intro.push("", "Pergunta do utilizador (contexto):", contextText);
  }

  const out = [{ type: "text", text: intro.join("\n") }];
  for (let i = 0; i < batch.length; i += 1) {
    const globalIndex = batchOffset + i + 1;
    out.push({
      type: "text",
      text:
        `${describeAttachmentPart(batch[i], globalIndex, total)}\n` +
        "Le isto individualmente e garante que a resposta final tem uma secao propria para este anexo.",
    });
    out.push(batch[i]);
  }
  return out;
}

async function extractAttachmentsTextWithGemini({ userText, content, signal, plan }) {
  const extractorId = process.env.ATTACHMENT_EXTRACTOR_MODEL_ID || "gemini-2.5 pro";
  const geminiModel = getModel(extractorId) || getModel("gemini-3.1 pro") || getModel("gemini-3 pro");
  if (!geminiModel || geminiModel.provider !== "gemini") return null;
  const gemini = getProvider("gemini");
  if (!gemini) return null;

  const paid = isPaidPlan(plan);
  const maxMediaParts = getAttachmentExtractorMaxMediaParts(plan);
  const batchSize =
    Number.parseInt(process.env.ATTACHMENT_EXTRACTOR_BATCH_SIZE || "4", 10) || 4;

  const allMediaParts = keepOnlyMediaParts(content);
  const mediaParts = allMediaParts.slice(0, Math.max(1, maxMediaParts));
  if (mediaParts.length === 0) return null;

  const system = {
    role: "system",
    content:
      "Ã‰s um motor de extraÃ§Ã£o de anexos (imagem/PDF). " +
      "Extrai o mÃ¡ximo de conteÃºdo Ãºtil dos anexos e devolve em PortuguÃªs. " +
      "Se for PDF, extrai tÃ­tulos, tÃ³picos e texto relevante. Se for imagem, descreve e extrai texto visÃ­vel. " +
      "Devolve apenas o conteÃºdo extraÃ­do (sem desculpas).",
  };

  try {
    if (process.env.DEBUG_AI === "1") {
      console.error("[attachments] extractor", {
        extractorId,
        remoteModel: geminiModel.remoteModel,
        mediaParts: mediaParts.map((p) => String(p?.type || "")),
        paid,
        batchSize,
        maxMediaParts,
      });
    }

    const effectiveBatch = Math.max(1, batchSize);
    const chunks = [];
    for (let i = 0; i < mediaParts.length; i += effectiveBatch) {
      const batch = mediaParts.slice(i, i + effectiveBatch);
      let out = "";
      const user = {
        role: "user",
        content: [
          {
            type: "text",
            text: "Pergunta do utilizador (para contexto):\n" + String(userText || "").slice(0, 4000),
          },
          ...batch,
        ],
      };

      await runInProviderQueue(
        "gemini",
        ({ signal: qSignal }) =>
          gemini.streamChat({
            remoteModel: geminiModel.remoteModel,
            messages: [system, user],
            onDelta: (d) => {
              if (typeof d === "string") out += d;
            },
            signal: qSignal,
          }),
        { type: "text", plan, signal, maxRetries: 1 }
      );

      const trimmed = out.trim();
      if (trimmed) chunks.push(trimmed);
    }

    const combined = chunks.join("\n\n").trim();
    const ignored = allMediaParts.length - mediaParts.length;
    const header = `Anexos analisados: ${mediaParts.length}/${allMediaParts.length}.`;
    if (ignored > 0) {
      return `${header}\n\n${combined ? `${combined}\n\n` : ""}[+${ignored} attachments not processed]`;
    }

    if (!combined) return null;
    return `${header}\n\n${combined}`;
  } catch (e) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[attachments] gemini extractor error", {
        message: e?.message || String(e),
        status: e?.status,
        details: e?.details,
      });
    }
    return null;
  }
}

async function extractAttachmentsTextWithGeminiVisionPrompt({ userText, content, signal, plan }) {
  const extractorId = process.env.ATTACHMENT_EXTRACTOR_MODEL_ID || "gemini-2.5 pro";
  const geminiModel = getModel(extractorId) || getModel("gemini-3.1 pro") || getModel("gemini-3 pro");
  if (!geminiModel || geminiModel.provider !== "gemini") return null;
  const gemini = getProvider("gemini");
  if (!gemini) return null;

  const paid = isPaidPlan(plan);
  const maxMediaParts = getAttachmentExtractorMaxMediaParts(plan);
  const batchSize =
    Number.parseInt(process.env.ATTACHMENT_EXTRACTOR_BATCH_SIZE || "4", 10) || 4;

  const allMediaParts = keepOnlyMediaParts(content);
  const mediaParts = allMediaParts.slice(0, Math.max(1, maxMediaParts));
  if (mediaParts.length === 0) return null;

  const system = {
    role: "system",
    content: [
      "Es um motor de leitura de anexos para dar visao a modelos sem capacidade visual.",
      "Le imagens, screenshots, pdfs, fichas, tabelas, graficos, diagramas, codigo e circuitos.",
      "Quando houver texto, preserva-o com a maior fidelidade possivel antes de interpretar.",
      "Quando houver elementos sem texto, descreve apenas o que e observavel e util.",
      "Nao omitas anexos, secoes, labels pequenas, notas de rodape, cabecalhos, rodapes, eixos, unidades ou detalhes laterais.",
      "Se houver tabelas ou listas, reconstrui-as de forma legivel.",
      "Se houver diagramas ou circuitos, identifica componentes, ligacoes, setas, simbolos e funcao aparente sem inventar.",
      "Nao respondas com desculpas. Nao inventes conteudo.",
      "Devolve apenas a analise estruturada pedida pelo utilizador.",
    ].join(" "),
  };

  try {
    if (process.env.DEBUG_AI === "1") {
      console.error("[attachments] extractor", {
        extractorId,
        remoteModel: geminiModel.remoteModel,
        mediaParts: mediaParts.map((p) => String(p?.type || "")),
        paid,
        batchSize,
        maxMediaParts,
      });
    }

    const effectiveBatch = Math.max(1, batchSize);
    const chunks = [];
    for (let i = 0; i < mediaParts.length; i += effectiveBatch) {
      const batch = mediaParts.slice(i, i + effectiveBatch);
      let out = "";
      const user = {
        role: "user",
        content: buildAttachmentExtractorUserContent({
          userText,
          batch,
          batchOffset: i,
          total: mediaParts.length,
        }),
      };

      await runInProviderQueue(
        "gemini",
        ({ signal: qSignal }) =>
          gemini.streamChat({
            remoteModel: geminiModel.remoteModel,
            messages: [system, user],
            onDelta: (d) => {
              if (typeof d === "string") out += d;
            },
            signal: qSignal,
          }),
        { type: "text", plan, signal, maxRetries: 1 }
      );

      const trimmed = out.trim();
      if (trimmed) chunks.push(trimmed);
    }

    const combined = chunks.join("\n\n").trim();
    const ignored = allMediaParts.length - mediaParts.length;
    const header = `Anexos analisados: ${mediaParts.length}/${allMediaParts.length}.`;
    if (ignored > 0) {
      return `${header}\n\n${combined ? `${combined}\n\n` : ""}[+${ignored} attachments not processed]`;
    }

    if (!combined) return null;
    return `${header}\n\n${combined}`;
  } catch (e) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[attachments] gemini extractor error", {
        message: e?.message || String(e),
        status: e?.status,
        details: e?.details,
      });
    }
    return null;
  }
}

function toChatMessages(messages) {
  // Normalize to OpenAI-style messages shape (role/content).
  // `content` can be a string or a provider-compatible parts array (for images/files).
  if (!Array.isArray(messages)) return [];
  return messages
    .map((m) => ({
      role: m?.role,
      content: m?.content,
    }))
    .filter((m) => {
      if (typeof m.role !== "string") return false;
      if (typeof m.content === "string") return m.content.length > 0;
      if (Array.isArray(m.content)) return m.content.length > 0;
      return false;
    });
}

const TEXT_MODEL_INTERNAL_PRICING_USD_PER_MILLION = {
  "gpt-5.4 pro": { input: 25, output: 80 },
  "gpt-5.4": { input: 12, output: 36 },
  "gpt-5.2 pro": { input: 15, output: 45 },
  "gpt-5.2": { input: 8, output: 24 },
  "gpt-5.1": { input: 6, output: 18 },
  "gpt-5": { input: 5, output: 15 },
  "gpt-5-mini": { input: 0.6, output: 2.4 },
  "gpt-5-nano": { input: 0.2, output: 0.8 },

  "claude-opus-4.6": { input: 18, output: 90 },
  "claude-opus-4.5": { input: 15, output: 75 },
  "claude-sonnet-4.6": { input: 5, output: 25 },
  "claude-sonnet-4.5": { input: 4, output: 20 },
  "claude-haiku-4.5": { input: 1, output: 5 },

  "gemini-3.1 pro": { input: 7, output: 28 },
  "gemini-3 pro": { input: 5, output: 20 },
  "gemini-2.5 pro": { input: 3.5, output: 10.5 },
  "gemini-2.5 flash": { input: 0.4, output: 1.2 },
  "gemini-2.5 flash lite": { input: 0.15, output: 0.45 },

  "grok-4.2": { input: 12, output: 48 },
  "grok-4.1": { input: 10, output: 40 },
  "grok-4": { input: 8, output: 32 },

  "deepseek-v3.2": { input: 0.3, output: 0.9 },
  "deepseek-r1": { input: 2, output: 8 },

  "kimi-k2-5": { input: 1.5, output: 6 },

  "qwen3.5-plus": { input: 0.8, output: 3.2 },
  "qwen3.5-flash": { input: 0.2, output: 0.8 },
  "qwen3-max": { input: 2, output: 8 },

  "nemotron 3 super": { input: 0.1, output: 0.5 },
  "minimax m2.7": { input: 0.3, output: 1.2 },

  "perplexity-sonar-pro": { input: 3, output: 15 },
  "perplexity-sonar": { input: 1, output: 5 },

  "llama-4": { input: 1, output: 4 },
};

const PROVIDER_DEFAULT_INTERNAL_PRICING_USD_PER_MILLION = {
  openai: { input: 10, output: 30 },
  anthropic: { input: 6, output: 24 },
  gemini: { input: 3, output: 9 },
  grok: { input: 10, output: 40 },
  deepseek: { input: 0.3, output: 0.9 },
  moonshot: { input: 1.5, output: 6 },
  qwen: { input: 1, output: 4 },
  openrouter: { input: 1, output: 4 },
  perplexity: { input: 3, output: 15 },
  meta: { input: 1, output: 4 },
};

function getUtcMonthStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function asFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function estimateTextCostUsd({ modelId, provider, usage }) {
  const pricing =
    TEXT_MODEL_INTERNAL_PRICING_USD_PER_MILLION[String(modelId || "").trim().toLowerCase()] ||
    PROVIDER_DEFAULT_INTERNAL_PRICING_USD_PER_MILLION[String(provider || "").trim().toLowerCase()] ||
    null;

  if (!pricing) return null;

  const promptTokens = asFiniteNumber(usage?.prompt_tokens);
  const completionTokens = asFiniteNumber(usage?.completion_tokens);
  if (promptTokens <= 0 && completionTokens <= 0) return null;

  const total =
    (promptTokens / 1000000) * asFiniteNumber(pricing.input) +
    (completionTokens / 1000000) * asFiniteNumber(pricing.output);

  return Number.isFinite(total) ? Number(total.toFixed(6)) : null;
}

async function getMonthlyTextSpendUsd({ userId, periodStart }) {
  const agg = await prisma.aIRequest.aggregate({
    where: {
      userId,
      mode: { startsWith: "chat" },
      status: "succeeded",
      createdAt: { gte: periodStart },
    },
    _sum: {
      estimatedCostUsd: true,
    },
  });

  return asFiniteNumber(agg?._sum?.estimatedCostUsd);
}

async function refreshMonthlyTextBudgetSummary({
  userId,
  normalizedPlan,
  periodStart,
  budgetUsd,
  monthSpendUsd,
}) {
  if (!userId || !periodStart) return;
  try {
    const [user, resolvedMonthSpendUsd] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, plan: true },
      }),
      monthSpendUsd != null
        ? Promise.resolve(asFiniteNumber(monthSpendUsd))
        : getMonthlyTextSpendUsd({ userId, periodStart }),
    ]);

    if (!user?.email) return;

    const effectivePlan = normalizePlan(normalizedPlan || user.plan);
    const effectiveBudgetUsd = asFiniteNumber(
      budgetUsd != null ? budgetUsd : getMonthlyTextInternalBudgetUsd(effectivePlan)
    );
    const budgetExceeded =
      effectiveBudgetUsd > 0 && resolvedMonthSpendUsd >= effectiveBudgetUsd;

    await prisma.$executeRaw`
      INSERT INTO "text_budget_months" (
        "id",
        "userId",
        "userEmail",
        "plan",
        "periodStart",
        "textCostUsd",
        "budgetUsd",
        "budgetExceeded",
        "forcedToDeepseekAt",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${userId},
        ${user.email},
        CAST(${effectivePlan} AS "Plan"),
        ${periodStart},
        ${resolvedMonthSpendUsd},
        ${effectiveBudgetUsd},
        ${budgetExceeded},
        CASE WHEN ${budgetExceeded} THEN NOW() ELSE NULL END,
        NOW(),
        NOW()
      )
      ON CONFLICT ("userId", "periodStart")
      DO UPDATE SET
        "userEmail" = EXCLUDED."userEmail",
        "plan" = EXCLUDED."plan",
        "textCostUsd" = EXCLUDED."textCostUsd",
        "budgetUsd" = EXCLUDED."budgetUsd",
        "budgetExceeded" = EXCLUDED."budgetExceeded",
        "forcedToDeepseekAt" = CASE
          WHEN EXCLUDED."budgetExceeded" THEN COALESCE("text_budget_months"."forcedToDeepseekAt", NOW())
          ELSE NULL
        END,
        "updatedAt" = NOW()
    `;
  } catch (e) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[budget] summary refresh error", {
        message: e?.message || String(e),
        userId,
      });
    }
  }
}

async function getCurrentMonthlyTextBudgetState({ userId, normalizedPlan, periodStart }) {
  const configuredBudgetUsd = asFiniteNumber(
    getMonthlyTextInternalBudgetUsd(normalizedPlan)
  );
  const row = await prisma.textBudgetMonth.findUnique({
    where: {
      userId_periodStart: {
        userId,
        periodStart,
      },
    },
    select: {
      budgetUsd: true,
      textCostUsd: true,
      budgetExceeded: true,
      periodStart: true,
    },
  });

  if (row) {
    const rowBudgetUsd = asFiniteNumber(row.budgetUsd);
    const spentUsd = asFiniteNumber(row.textCostUsd);
    const budgetUsd =
      configuredBudgetUsd > 0 || normalizedPlan === "FREE"
        ? configuredBudgetUsd
        : rowBudgetUsd;
    const exceeded =
      Boolean(row.budgetExceeded) || (budgetUsd > 0 && spentUsd >= budgetUsd);

    return {
      budgetUsd,
      spentUsd,
      remainingUsd: Number(Math.max(0, budgetUsd - spentUsd).toFixed(6)),
      periodStart: row.periodStart.toISOString(),
      exceeded,
      fromTable: true,
    };
  }

  const budgetUsd = configuredBudgetUsd;
  if (budgetUsd <= 0) return null;

  const spentUsd = await getMonthlyTextSpendUsd({ userId, periodStart });
  return {
    budgetUsd,
    spentUsd,
    remainingUsd: Number(Math.max(0, budgetUsd - spentUsd).toFixed(6)),
    periodStart: periodStart.toISOString(),
    exceeded: spentUsd >= budgetUsd,
    fromTable: false,
  };
}

function assertModelAllowed({ plan, model }) {
  const paid = isPaidPlan(plan);
  // FREE: allow DeepSeek V3.2 (special-case) + all "light" models.
  if (!paid && model.tier !== "light" && model.id !== "deepseek-v3.2") {
    const err = new Error("MODEL_NOT_ALLOWED_FOR_PLAN");
    err.status = 403;
    err.details = { plan, modelId: model.id };
    throw err;
  }
}

async function createAIRequest({
  userId,
  conversationId,
  messageId,
  mode,
  provider,
  model,
  selectionMode,
}) {
  return prisma.aIRequest.create({
    data: {
      userId,
      conversationId: conversationId || null,
      messageId: messageId || null,
      mode: mode || "chat",
      provider,
      model,
      selectionMode,
      status: "queued",
    },
  });
}

async function updateAIRequest(id, data) {
  return prisma.aIRequest.update({
    where: { id },
    data,
  });
}

function launchAIRequestUpdate(id, data) {
  Promise.resolve()
    .then(() => updateAIRequest(id, data))
    .catch((e) => {
      if (process.env.DEBUG_AI === "1") {
        console.error("[ai.request] async update error", { id, message: e?.message || String(e) });
      }
    });
}

async function runPostResponseMaintenance({
  userId,
  conversationId,
  normalizedPlan,
  periodStart,
  budgetUsd,
  chatMessages,
  userText,
}) {
  await refreshMonthlyTextBudgetSummary({
    userId,
    normalizedPlan,
    periodStart,
    budgetUsd,
  });

  try {
    const blockingMs =
      Number.parseInt(process.env.MEMORY_EXTRACTOR_BLOCKING_TIMEOUT_MS || "1500", 10) || 0;

    const minIntervalMs =
      Number.parseInt(process.env.MEMORY_EXTRACTOR_MIN_INTERVAL_MS || "5000", 10) || 5000;
    const now = Date.now();
    const last = Number(memoryExtractorLastRunByUser.get(userId) || "0") || 0;
    const shouldRunExtractor = minIntervalMs <= 0 || now - last >= minIntervalMs;

    if (shouldRunExtractor) {
      memoryExtractorLastRunByUser.set(userId, now);
      if (memoryExtractorLastRunByUser.size > 10000) memoryExtractorLastRunByUser.clear();
    }

    const persistPromise = (shouldRunExtractor
      ? extractAndPersistUserMemory({
          userId,
          plan: normalizedPlan,
          contextMessages: chatMessages,
          userText,
        })
      : Promise.resolve()
    ).catch((e) => {
      if (process.env.DEBUG_AI === "1") {
        console.error("[memory] persist error", { message: e?.message || String(e) });
      }
    });

    const summaryPromise = maybeUpdateConversationSummary({
      userId,
      conversationId,
      plan: normalizedPlan,
    }).catch((e) => {
      if (process.env.DEBUG_AI === "1") {
        console.error("[chat.summary] error", { message: e?.message || String(e) });
      }
    });

    if (blockingMs > 0) {
      await Promise.race([
        persistPromise,
        summaryPromise,
        new Promise((resolve) => setTimeout(resolve, blockingMs)),
      ]);
    }
  } catch {
    // ignore extractor errors
  }
}

function launchPostResponseMaintenance(args) {
  Promise.resolve()
    .then(() => runPostResponseMaintenance(args))
    .catch((e) => {
      if (process.env.DEBUG_AI === "1") {
        console.error("[post.response] maintenance error", { message: e?.message || String(e) });
      }
    });
}

async function streamChat({
  userId,
  plan,
  selectionMode, // "manual" | "auto"
  selectedModelId, // optional UI model id
  messages,
  conversationId,
  projectId,
  routingText,
  webSearchEnabled, // optional (frontend toggle)
  reasoningEnabled, // optional (frontend toggle)
  locale, // optional BCP-47-ish, from client/header
  onDelta,
  onArtifactIntent,
  signal,
}) {
  const normalizedPlan = normalizePlan(plan);
  const budgetWindowStart = getUtcMonthStart(new Date());
  const effectiveLocale = (() => {
    const raw = String(locale || "").trim();
    if (!raw) return "en-US";
    const cleaned = raw.replace(/_/g, "-").split(";")[0].trim();
    const [lang0, region0] = cleaned.split("-");
    const lang = String(lang0 || "").toLowerCase();
    if (!/^[a-z]{2,3}$/.test(lang)) return "en-US";
    const region = region0 ? String(region0).toUpperCase() : "";
    if (region && !/^[A-Z]{2}$/.test(region)) return lang;
    if (!region) {
      if (lang === "pt") return "pt-PT";
      if (lang === "en") return "en-US";
      return lang;
    }
    return `${lang}-${region}`;
  })();

  // IMPORTANT:
  // The frontend historically sent the *entire* conversation every request (`messages`).
  // That explodes prompt tokens (cost + latency). When `conversationId` is present, we instead
  // build the context from the DB and keep only a recent window, while still appending the
  // latest user message from the request (so images/files parts are preserved).
  const requestChatMessages = toChatMessages(messages);
  const requestLastUser = [...requestChatMessages].reverse().find((m) => m.role === "user") || null;
  const requestAttachmentCount = keepOnlyMediaParts(requestLastUser?.content).length;

  let chatMessages = requestChatMessages;

  if (conversationId) {
    try {
      const maxDbMessages =
        Number.parseInt(process.env.CONVERSATION_CONTEXT_MAX_MESSAGES || "24", 10) || 24;

      const convo = await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        select: {
          id: true,
          summary: true,
          summaryUpdatedAt: true,
          summaryMessageCount: true,
          messages: {
            orderBy: { createdAt: "desc" },
            take: Math.max(0, Math.min(200, maxDbMessages)),
            select: { role: true, content: true, createdAt: true },
          },
        },
      });

      if (convo) {
        const dbWindow = [...(convo.messages || [])].reverse().map((m) => ({
          role: String(m.role || "user"),
          content: String(m.content || ""),
        }));

        const out = [];

        const summary = String(convo.summary || "").trim();
        if (summary) {
          out.push({
            role: "system",
            content: `[CHAT SUMMARY]\n${summary}\n[/CHAT SUMMARY]`,
          });
        }

        out.push(...dbWindow);

        // Append the current request's last user message if it isn't already the last DB message.
        // - if it has media parts, we always append (DB stores a text-only version at best).
        // - if it's text-only and matches the last DB user message exactly, we skip to avoid duplication.
        if (requestLastUser) {
          const reqContent = requestLastUser.content;
          const reqTextOnly = String(keepOnlyTextParts(reqContent) || "").trim();
          const hasParts = Array.isArray(reqContent);

          const lastDb = out.length > 0 ? out[out.length - 1] : null;
          const lastDbIsSameText =
            !hasParts &&
            lastDb &&
            lastDb.role === "user" &&
            typeof lastDb.content === "string" &&
            String(lastDb.content || "").trim() === reqTextOnly;

          if (!lastDbIsSameText) out.push(requestLastUser);
        }

        // Use DB-built messages only if we ended up with at least 1 message.
        if (out.length > 0) chatMessages = out;
      }
    } catch (e) {
      if (process.env.DEBUG_AI === "1") {
        console.error("[chat.context] db context failed", { message: e?.message || String(e) });
      }
    }
  }

  const lastUser = [...chatMessages].reverse().find((m) => m.role === "user");
  const text = extractTextFromContent(lastUser?.content || "");
  const routingUserText = String(routingText || "").trim() || text;
  const obviousArtifactType = inferExplicitArtifactRequest(routingUserText);
  if (obviousArtifactType && typeof onArtifactIntent === "function") {
    onArtifactIntent({ type: obviousArtifactType });
  }
  let hadDelta = false;
  const onDeltaWrapped =
    typeof onDelta === "function"
      ? (delta) => {
          hadDelta = true;
          onDelta(delta);
        }
      : () => {
          hadDelta = true;
        };

  // 0) Hard daily cost protection (in-memory, per process).
  // Run this before monthly plan consumption so we don't charge users for blocked requests.
  const { assertDailyLimitOrThrow } = require("../ai/queues");
  assertDailyLimitOrThrow("text");
  assertMessageAttachmentLimit({
    plan: normalizedPlan,
    attachmentCount: requestAttachmentCount,
  });

  // 1) Plan: consume 1 message unit (atomic per month)
  await planService.assertAndConsumeMessage({ userId });

  // 2) Model: manual or auto
  let picked = null;
  const userRequestedModelId =
    selectedModelId && String(selectedModelId).trim() && String(selectedModelId).trim() !== "__best__"
      ? String(selectedModelId).trim()
      : null;
  let budgetForcedToDeepseek = false;
  let budgetState = null;
  try {
    const projectContextMessages = await buildProjectContextSystemMessages({
      userId,
      projectId,
      conversationId,
      userText: routingUserText,
      signal,
    });
    if (projectContextMessages.length > 0) {
      chatMessages.unshift(...projectContextMessages);
    }
  } catch (e) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[project.context] injection error", {
        userId,
        projectId: projectId || null,
        conversationId: conversationId || null,
        message: e?.message || String(e),
      });
    }
  }

  if (selectedModelId) {
    // The frontend uses "__best__" for "Melhor Â· AutomÃ¡tico".
    if (selectedModelId === "__best__") selectedModelId = null;
  }

  // Reasoning toggle: add a small system instruction for deeper reasoning (safe across providers).
  // IMPORTANT: we do NOT ask the model to reveal chain-of-thought; we only nudge depth/rigor.
  if (reasoningEnabled) {
    chatMessages.unshift({
      role: "system",
      content:
        "Modo RaciocÃ­nio: responde com mais rigor e profundidade. " +
        "Usa uma estrutura clara (passos, bullets, tabela se fizer sentido). " +
        "NÃ£o mostres o teu raciocÃ­nio interno; mostra apenas a resposta final bem explicada.",
    });
  }

  chatMessages.unshift(buildArtifactModeSystemMessage({ locale: effectiveLocale }));

  if (selectedModelId) {
    picked = getModel(selectedModelId);
    if (!picked) {
      const err = new Error("UNKNOWN_MODEL");
      err.status = 400;
      err.details = { selectedModelId };
      throw err;
    }
    assertModelAllowed({ plan: normalizedPlan, model: picked });
    selectionMode = "manual";
  } else {
    picked = await chooseModel({
      text: routingUserText,
      plan: normalizedPlan,
      reasoningEnabled: Boolean(reasoningEnabled),
    });
    if (!picked) {
      const err = new Error("NO_MODEL_AVAILABLE");
      err.status = 503;
      throw err;
    }
    assertModelAllowed({ plan: normalizedPlan, model: picked });
    selectionMode = "auto";
  }

  const budgetStatus = await getCurrentMonthlyTextBudgetState({
    userId,
    normalizedPlan,
    periodStart: budgetWindowStart,
  });
  const monthlyTextBudgetUsd = budgetStatus?.budgetUsd || 0;
  if (budgetStatus) {
    budgetState = {
      budgetUsd: budgetStatus.budgetUsd,
      spentUsd: budgetStatus.spentUsd,
      remainingUsd: budgetStatus.remainingUsd,
      periodStart: budgetStatus.periodStart,
    };

    const shouldForceBudgetFallback =
      isPaidPlan(normalizedPlan) && budgetStatus.budgetUsd > 0 && budgetStatus.exceeded;

    if (shouldForceBudgetFallback) {
      await refreshMonthlyTextBudgetSummary({
        userId,
        normalizedPlan,
        periodStart: budgetWindowStart,
        budgetUsd: budgetStatus.budgetUsd,
        monthSpendUsd: budgetStatus.spentUsd,
      });
    }

    if (shouldForceBudgetFallback && picked.id !== "deepseek-v3.2") {
      const forcedModel = getModel("deepseek-v3.2");
      if (!forcedModel) {
        const err = new Error("BUDGET_FALLBACK_MODEL_MISSING");
        err.status = 500;
        throw err;
      }
      picked = forcedModel;
      budgetForcedToDeepseek = true;
    }
  }

  // 3) Provider adapter
  const provider = getProvider(picked.provider);
  if (!provider) {
    const err = new Error("PROVIDER_NOT_IMPLEMENTED");
    err.status = 501;
    err.details = { provider: picked.provider };
    throw err;
  }

  // 4) Monitoring row
  const reqRow = await createAIRequest({
    userId,
    conversationId,
    messageId: null,
    mode: "chat",
    provider: picked.provider,
    model: picked.remoteModel,
    selectionMode,
  });

  const startedAt = Date.now();
  await updateAIRequest(reqRow.id, { status: "running" });

  // 4a) Web Search layer (decoupled from model/provider).
  // When enabled, we call `searchLayer()` first and inject the results into the prompt
  // as a system message. We do NOT switch the chosen provider/model.
  let webSearchMeta = {
    requested: Boolean(webSearchEnabled),
    denied: false,
    used: false,
    provider: null,
    fetchedAt: null,
    sources: null,
  };

  // 4b) Attachments: make *all* models able to use images/docs by extracting them into text.
  // Frontend sends images/PDFs as parts (data: URLs). Most providers are text-only.
  const lastUserIndex = (() => {
    for (let i = chatMessages.length - 1; i >= 0; i -= 1) {
      if (chatMessages[i]?.role === "user") return i;
    }
    return -1;
  })();

  if (lastUserIndex >= 0 && contentHasMediaParts(chatMessages[lastUserIndex]?.content)) {
    const baseText = keepOnlyTextParts(chatMessages[lastUserIndex]?.content);
    const receivedMediaParts = keepOnlyMediaParts(chatMessages[lastUserIndex]?.content).length;
    const maxMediaParts = getAttachmentExtractorMaxMediaParts(normalizedPlan);
    const willAnalyze = Math.min(receivedMediaParts, maxMediaParts);
    const attachMetaLine =
      `\n\n[Anexos recebidos: ${receivedMediaParts}. Limite do plano: ${maxMediaParts}. ` +
      `A analisar: ${willAnalyze}.]`;

    // Keep at most N media parts (plan-based) to avoid huge payloads.
    const contentBeforeTrim = chatMessages[lastUserIndex]?.content;
    if (Array.isArray(contentBeforeTrim)) {
      chatMessages[lastUserIndex] = {
        ...chatMessages[lastUserIndex],
        content: trimMediaPartsInContent(contentBeforeTrim, willAnalyze),
      };
    }

    // Attachments strategy:
    // - Images: pass through (vision-capable models can read them).
    // - Docs/PDFs: extract into text so all text models can use them.
    const attachmentsMode = String(process.env.ATTACHMENTS_MODE || "hybrid").trim().toLowerCase(); // hybrid | extractor | direct
    const wantExtractor = attachmentsMode === "extractor" || attachmentsMode === "hybrid";
    const docParts = keepOnlyDocParts(chatMessages[lastUserIndex]?.content);

    const docMode = String(process.env.ATTACHMENTS_DOC_MODE || "gemini").trim().toLowerCase(); // local | gemini | none
    const wantDocExtract = wantExtractor && picked.provider !== "gemini" && docParts.length > 0 && docMode !== "none";

    let extracted = null;
    if (wantDocExtract) {
      if (docMode === "gemini") {
        extracted = await extractAttachmentsTextWithGeminiVisionPrompt({
          userText: baseText,
          content: docParts,
          plan: normalizedPlan,
          signal,
        });
      } else {
        extracted = await extractDocPartsTextLocally({ docParts, signal });
        const wantGeminiFallback =
          !extracted && String(process.env.ATTACHMENTS_DOC_FALLBACK || "").trim().toLowerCase() === "gemini";
        if (wantGeminiFallback) {
          extracted = await extractAttachmentsTextWithGeminiVisionPrompt({
            userText: baseText,
            content: docParts,
            plan: normalizedPlan,
            signal,
          });
        }
      }
    }

    if (extracted) {
      const note = `${attachMetaLine}\n\n[ConteÃºdo extraÃ­do dos anexos]\n${extracted}`;
      const c0 = chatMessages[lastUserIndex]?.content;

      // Prefer keeping parts so vision-capable models can read images directly.
      if (typeof c0 === "string") {
        chatMessages[lastUserIndex] = { ...chatMessages[lastUserIndex], content: `${c0}${note}` };
      } else if (Array.isArray(c0)) {
        chatMessages[lastUserIndex] = {
          ...chatMessages[lastUserIndex],
          content: [...c0, { type: "text", text: note }],
        };
      } else {
        chatMessages[lastUserIndex] = { ...chatMessages[lastUserIndex], content: `${baseText}${note}` };
      }
    } else if (wantDocExtract) {
      // If extraction fails, at least keep a hint that an attachment exists.
      const hint = `${attachMetaLine}\n\n[Anexo enviado: nÃ£o foi possÃ­vel extrair o conteÃºdo automaticamente.]`;
      const c0 = chatMessages[lastUserIndex]?.content;

      // Prefer keeping parts so vision-capable models can read images directly.
      if (typeof c0 === "string") {
        chatMessages[lastUserIndex] = { ...chatMessages[lastUserIndex], content: `${c0}${hint}` };
      } else if (Array.isArray(c0)) {
        chatMessages[lastUserIndex] = {
          ...chatMessages[lastUserIndex],
          content: [...c0, { type: "text", text: hint }],
        };
      } else {
        chatMessages[lastUserIndex] = { ...chatMessages[lastUserIndex], content: `${baseText}${hint}` };
      }
    }
  }

  // 4c) Web Search injection (optional). If the search fails or times out, we answer normally.
  if (webSearchEnabled) {
    const ws = await searchLayer({
      query: routingUserText,
      messages: chatMessages,
      plan: normalizedPlan,
      maxSources: 15,
      timeoutMs: Number(process.env.WEBSEARCH_TIMEOUT_MS || "20000"),
      locale: effectiveLocale,
      signal,
    });

    if (ws?.denied) {
      webSearchMeta.denied = true;
    } else if (ws?.ok) {
      webSearchMeta.used = true;
      webSearchMeta.provider = ws.provider || "perplexity";
      webSearchMeta.fetchedAt = ws.fetchedAt || null;
      webSearchMeta.sources = ws.sources || [];

      chatMessages.unshift({
        role: "system",
        content: buildInjectedWebContext({
          fetchedAt: webSearchMeta.fetchedAt,
          summary: ws.summary || "",
          sources: webSearchMeta.sources,
        }),
      });

      console.log("[model] using injected web context");

      // Persist "webSearch=true" in AIRequest without schema changes.
      // (We keep it as a mode variant for now; can evolve to a real column later.)
      await updateAIRequest(reqRow.id, { mode: "chat_websearch" });
    }
  }

  // 4d) Persistent user memory (ChatGPT-style).
  // Centralized here so *all* models/providers receive identical memory context.
  try {
    const cap = await buildMemoryCapabilitySystemMessage({ userId, plan: normalizedPlan });
    if (cap) chatMessages.unshift(cap);
    const mem = await buildUserMemorySystemMessage({
      userId,
      plan: normalizedPlan,
      userText: routingUserText,
    });
    if (mem) chatMessages.unshift(mem);
  } catch (e) {
    if (process.env.DEBUG_AI === "1") {
      console.error("[memory] injection error", { message: e?.message || String(e) });
    }
  }

  function messagesForProvider(providerKey) {
    const supportsParts =
      providerKey === "gemini" ||
      providerKey === "anthropic" ||
      providerKey === "openai" ||
      providerKey === "grok" ||
      providerKey === "perplexity" ||
      providerKey === "qwen" ||
      providerKey === "moonshot" ||
      providerKey === "deepseek";

    const keepDocParts = providerKey === "gemini";
    return chatMessages.map((m) => ({
      ...m,
      content: supportsParts
        ? (() => {
            const c = m.content;
            if (!Array.isArray(c)) return c;
            const filtered = c.filter((p) => {
              const t = String(p?.type || "");
              if (t === "text" || t === "input_text" || t === "image_url") return true;
              if (keepDocParts && (t === "file" || t === "document" || t === "input_file")) return true;
              return false;
            });
            return filtered.length > 0 ? filtered : keepOnlyTextParts(c);
          })()
        : keepOnlyTextParts(m.content),
    }));
  }

  function isOpenAIModelNotFound(err) {
    return (
      err &&
      err.status === 404 &&
      err.details?.provider === "openai" &&
      (err.details?.code === "model_not_found" || err.message === "model_not_found")
    );
  }

  function isGrokModelNotFound(err) {
    return (
      err &&
      err.details?.provider === "grok" &&
      ((err.status === 404 && (err.details?.code === "model_not_found" || err.message === "model_not_found")) ||
        (err.status === 400 && String(err.details?.message || err.details?.body || "").toLowerCase().includes("model")))
    );
  }

  function isDeepSeekModelNotFound(err) {
    return (
      err &&
      err.details?.provider === "deepseek" &&
      ((err.status === 404 && (err.details?.code === "model_not_found" || err.message === "model_not_found")) ||
        (err.status === 400 && String(err.details?.message || err.details?.body || "").toLowerCase().includes("model")))
    );
  }

  function isMoonshotModelNotFound(err) {
    return (
      err &&
      err.details?.provider === "moonshot" &&
      ((err.status === 404 && (err.details?.code === "model_not_found" || err.message === "model_not_found")) ||
        (err.status === 400 && String(err.details?.message || err.details?.body || "").toLowerCase().includes("model")))
    );
  }

  function isPerplexityModelNotFound(err) {
    return (
      err &&
      err.details?.provider === "perplexity" &&
      ((err.status === 404 && (err.details?.code === "model_not_found" || err.message === "model_not_found")) ||
        (err.status === 400 && String(err.details?.message || err.details?.body || "").toLowerCase().includes("model")))
    );
  }

  function isQwenModelNotFound(err) {
    return (
      err &&
      err.details?.provider === "qwen" &&
      ((err.status === 404 && (err.details?.code === "model_not_found" || err.message === "model_not_found")) ||
        (err.status === 400 && String(err.details?.message || err.details?.body || "").toLowerCase().includes("model")))
    );
  }

  function isGeminiModelNotFound(err) {
    if (!err) return false;
    if (err.details?.provider !== "gemini") return false;
    const st = String(err.details?.status || "").toUpperCase();
    const msg = String(err.details?.message || err.details?.body || "").toLowerCase();
    const status = Number(err.status || 0);

    // Prefer explicit Google status.
    if (st === "NOT_FOUND") return true;
    if (st === "INVALID_ARGUMENT" && msg.includes("model")) return true;
    if (st === "PERMISSION_DENIED" && msg.includes("model")) return true;

    // Heuristics by HTTP + message.
    if (status === 404 && (msg.includes("not found") || msg.includes("models/") || msg.includes("model"))) return true;
    if (status === 400 && msg.includes("model")) return true;
    if (status === 403 && msg.includes("model")) return true;

    return false;
  }

  function isAnthropicModelNotFound(err) {
    if (!err) return false;
    if (err.details?.provider !== "anthropic") return false;
    const code = String(err.details?.code || err.message || "").toLowerCase();
    const msg = String(err.details?.message || err.details?.body || "").toLowerCase();
    const status = Number(err.status || 0);

    // Anthropic commonly uses "not_found_error" or similar; keep heuristics broad.
    if (code.includes("not_found")) return true;
    if (status === 404 && (msg.includes("not found") || msg.includes("model"))) return true;
    if (status === 400 && msg.includes("model")) return true;
    return false;
  }

  async function callModel(modelObj) {
    const providerX = getProvider(modelObj.provider);
    if (!providerX) {
      const err = new Error("PROVIDER_NOT_IMPLEMENTED");
      err.status = 501;
      err.details = { provider: modelObj.provider };
      throw err;
    }

    let artifactHint = null;
    let artifactBuffer = "";
    let artifactDecisionMade = false;
    const flushArtifactBufferAsNormal = () => {
      if (!artifactBuffer) return;
      const chunk = artifactBuffer;
      artifactBuffer = "";
      artifactDecisionMade = true;
      if (chunk) onDeltaWrapped(chunk);
    };

    const artifactAwareForward = (chunk) => {
      if (!chunk) return;
      if (artifactDecisionMade) {
        onDeltaWrapped(chunk);
        return;
      }

      artifactBuffer += chunk;
      const hasNewline = artifactBuffer.includes("\n");
      const couldStillBeMarker =
        ARTIFACT_MARKER_PREFIX.startsWith(artifactBuffer) || artifactBuffer.startsWith(ARTIFACT_MARKER_PREFIX);

      if (!hasNewline) {
        if (!couldStillBeMarker || artifactBuffer.length > 220) flushArtifactBufferAsNormal();
        return;
      }

      const envelope = extractArtifactEnvelope(artifactBuffer);
      if (envelope?.artifact) {
        artifactHint = envelope.artifact;
        artifactDecisionMade = true;
        artifactBuffer = "";
        if (typeof onArtifactIntent === "function") onArtifactIntent({ type: artifactHint.type });
        if (envelope.text) onDeltaWrapped(envelope.text);
        return;
      }

      flushArtifactBufferAsNormal();
    };

    // Some models (notably some DeepSeek outputs) tend to cite sources as numeric markers like [1][2].
    // When webSearch is active, we want citations to appear as clickable hostnames instead.
    const citationTransformer =
      webSearchMeta.used && Array.isArray(webSearchMeta.sources) && webSearchMeta.sources.length > 0
        ? createCitationStreamTransformer({ sources: webSearchMeta.sources })
        : null;

    const onDeltaWithCitations =
      citationTransformer && typeof artifactAwareForward === "function"
        ? (chunk) => {
            const transformed = citationTransformer.push(chunk);
            if (transformed) artifactAwareForward(transformed);
          }
        : artifactAwareForward;

    return runInProviderQueue(
      modelObj.provider,
      async ({ signal: qSignal }) => {
        const baseMessages = messagesForProvider(modelObj.provider);

        const mergeUsage = (a, b) => {
          if (!a && !b) return null;
          const a0 = a && typeof a === "object" ? a : {};
          const b0 = b && typeof b === "object" ? b : {};

          const num = (x) => {
            const n = Number(x);
            return Number.isFinite(n) ? n : 0;
          };

          const out = {
            prompt_tokens: num(a0.prompt_tokens) + num(b0.prompt_tokens),
            completion_tokens: num(a0.completion_tokens) + num(b0.completion_tokens),
            total_tokens: num(a0.total_tokens) + num(b0.total_tokens),
          };

          // Keep common cache-related usage fields if providers return them (DeepSeek/OpenAI-compat, Anthropic, Gemini).
          const extraSumKeys = [
            "prompt_cache_hit_tokens",
            "prompt_cache_miss_tokens",
            "cache_read_input_tokens",
            "cache_creation_input_tokens",
            "cachedContentTokenCount",
          ];
          for (const k of extraSumKeys) {
            const hasA = a0 && Object.prototype.hasOwnProperty.call(a0, k);
            const hasB = b0 && Object.prototype.hasOwnProperty.call(b0, k);
            if (!hasA && !hasB) continue;
            out[k] = num(a0[k]) + num(b0[k]);
          }

          // Preserve provider-specific nested objects (last non-null wins).
          const keepLastKeys = ["prompt_tokens_details", "completion_tokens_details", "anthropic", "gemini"];
          for (const k of keepLastKeys) {
            const v = b0?.[k] ?? a0?.[k];
            if (v && typeof v === "object") out[k] = v;
          }

          if (!out.total_tokens) out.total_tokens = out.prompt_tokens + out.completion_tokens;
          return out;
        };

        const deepseekAutoContinueEnabled =
          modelObj.provider === "deepseek" && String(process.env.DEEPSEEK_AUTO_CONTINUE || "1") !== "0";
        const maxExtraCalls = Math.max(
          0,
          Number.parseInt(process.env.DEEPSEEK_AUTO_CONTINUE_MAX_CALLS || "2", 10) || 2
        );
        const tailChars = Math.max(
          200,
          Number.parseInt(process.env.DEEPSEEK_AUTO_CONTINUE_TAIL_CHARS || "1800", 10) || 1800
        );

        const continuePrompt =
          "Continue exactly where you stopped. Do not repeat anything. " +
          "Output only the continuation in the same language and Markdown formatting. " +
          "If you were in the middle of a table or code block, continue/finish it.";

        const overlapSize = (prevSuffix, nextPrefix) => {
          const a = String(prevSuffix || "");
          const b = String(nextPrefix || "");
          const max = Math.min(a.length, b.length, 600);
          for (let k = max; k >= 20; k -= 1) {
            if (a.endsWith(b.slice(0, k))) return k;
          }
          return 0;
        };

        const createOverlapSuppressor = ({ prevSuffix, forward }) => {
          let buffered = "";
          let decided = false;
          let skip = 0;
          const maxBuffer = 1000;

          const decide = (force) => {
            if (decided) return;
            if (!force && buffered.length < maxBuffer) return;
            skip = overlapSize(prevSuffix, buffered);
            const out = buffered.slice(skip);
            decided = true;
            buffered = "";
            if (out) forward(out);
          };

          return {
            onDelta: (chunk) => {
              if (!chunk) return;
              if (decided) return forward(chunk);
              buffered += chunk;
              decide(false);
            },
            flush: () => decide(true),
            getSkip: () => skip,
          };
        };

        const isLengthFinish = (fr) => {
          const v = String(fr || "").toLowerCase();
          return v === "length" || v === "max_tokens";
        };

        let combinedText = "";
        let combinedUsage = null;
        let lastOut = null;

        let extraCallsDone = 0;
        let curMessages = baseMessages;
        let didRetryImages = false;

        const collectLastUserImageParts = (msgs) => {
          const lastUser = [...(msgs || [])].reverse().find((m) => m?.role === "user");
          const c = lastUser?.content;
          if (!Array.isArray(c)) return [];
          return c.filter((p) => p && typeof p === "object" && String(p.type || "") === "image_url");
        };

        const toTextOnlyMessages = (msgs) =>
          (msgs || []).map((m) => ({
            ...m,
            content: keepOnlyTextParts(m?.content),
          }));

        const appendToLastUser = (msgs, extraText) => {
          const out = (msgs || []).map((m) => ({ ...m }));
          for (let i = out.length - 1; i >= 0; i -= 1) {
            if (out[i]?.role !== "user") continue;
            const prev = String(out[i]?.content || "");
            out[i] = { ...out[i], content: `${prev}${extraText}` };
            break;
          }
          return out;
        };

        const isLikelyUnsupportedImagesError = (err) => {
          const status = Number(err?.status || 0);
          const body = String(err?.details?.body || err?.details?.message || err?.message || "").toLowerCase();
          if (status !== 400 && status !== 415 && status !== 422) return false;
          if (body.includes("image_url")) return true;
          if (body.includes("image") && body.includes("unsupported")) return true;
          if (body.includes("content") && body.includes("string")) return true;
          if (body.includes("invalid") && body.includes("image")) return true;
          return false;
        };

        while (true) {
          let suppressor = null;
          let segmentSkip = 0;

          const forward = onDeltaWithCitations;
          const prevSuffix = combinedText.slice(-600);
          const onDeltaSegment =
            deepseekAutoContinueEnabled && extraCallsDone > 0
              ? ((() => {
                  suppressor = createOverlapSuppressor({ prevSuffix, forward });
                  return suppressor.onDelta;
                })())
              : forward;

          let outSeg;
          try {
            outSeg = await providerX.streamChat({
              remoteModel: modelObj.remoteModel,
              messages: curMessages,
              onDelta: onDeltaSegment,
              signal: qSignal,
            });
          } catch (e) {
            // Some providers claim OpenAI-compat but reject multimodal parts. Retry once (if no output yet)
            // by extracting images into text (optional) and sending text-only messages.
            const canRetry =
              !didRetryImages &&
              extraCallsDone === 0 &&
              !combinedText &&
              !hadDelta &&
              isLikelyUnsupportedImagesError(e);

            const imageFallback = String(process.env.ATTACHMENTS_IMAGE_FALLBACK || "gemini")
              .trim()
              .toLowerCase(); // gemini | none

            const imageParts = canRetry ? collectLastUserImageParts(curMessages) : [];
            if (canRetry && imageParts.length > 0) {
              didRetryImages = true;
              let extractedImages = null;
              if (imageFallback === "gemini") {
                extractedImages = await extractAttachmentsTextWithGeminiVisionPrompt({
                  userText: text,
                  content: imageParts,
                  plan: normalizedPlan,
                  signal,
                });
              }

              const note = extractedImages
                ? `\n\n[Imagens: conteÃƒÂºdo extraÃƒÂ­do automaticamente]\n${extractedImages}`
                : `\n\n[Imagens enviadas: este modelo nÃƒÂ£o suportou anexos de imagem nesta chamada.]`;

              const txtOnly = toTextOnlyMessages(curMessages);
              curMessages = appendToLastUser(txtOnly, note);
              continue;
            }

            throw e;
          }

          lastOut = outSeg;
          let segText = String(outSeg?.text || "");

          if (suppressor) {
            suppressor.flush();
            segmentSkip = suppressor.getSkip();
            if (segmentSkip > 0) segText = segText.slice(segmentSkip);
          }

          combinedText += segText;
          combinedUsage = mergeUsage(combinedUsage, outSeg?.usage || null);

          if (!deepseekAutoContinueEnabled) break;
          if (!isLengthFinish(outSeg?.finishReason)) break;
          if (extraCallsDone >= maxExtraCalls) break;

          if (process.env.DEBUG_AI === "1") {
            console.error("[deepseek] auto-continue", { remoteModel: modelObj.remoteModel, segment: extraCallsDone + 2 });
          }
          extraCallsDone += 1;
          const tail = combinedText.slice(-tailChars);
          curMessages = [
            ...baseMessages,
            { role: "assistant", content: tail },
            { role: "user", content: continuePrompt },
          ];
        }

        const out = {
          ...(lastOut || {}),
          text: combinedText,
          usage: combinedUsage || lastOut?.usage || null,
        };

        if (!artifactDecisionMade && artifactBuffer) flushArtifactBufferAsNormal();

        if (citationTransformer) {
          const tail = citationTransformer.flush();
          if (tail) artifactAwareForward(tail);
          const fixedText = replaceNumericCitationsWithHosts(out?.text || "", webSearchMeta.sources);
          const envelope = extractArtifactEnvelope(fixedText);
          return {
            ...out,
            text: envelope?.text || fixedText,
            artifactHint: envelope?.artifact || artifactHint || null,
          };
        }

        const envelope = extractArtifactEnvelope(out?.text || "");
        return {
          ...out,
          text: envelope?.text || out?.text || "",
          artifactHint: envelope?.artifact || artifactHint || null,
        };
      },
      { type: "text", plan: normalizedPlan, signal, maxRetries: 0 }
    );
  }

  function assertNonEmptyText({ out, modelObj }) {
    const textOut = typeof out?.text === "string" ? out.text : "";
    if (textOut.trim()) return textOut;

    const err = new Error("EMPTY_PROVIDER_RESPONSE");
    err.status = 502;
    err.details = {
      provider: modelObj.provider,
      model: modelObj.id,
      remoteModel: modelObj.remoteModel,
      meta: out?.meta || null,
    };
    throw err;
  }

  // 5) Queue + rate-limit + call provider (streaming)
  try {
    const out = await callModel(picked);
    const finalText = assertNonEmptyText({ out, modelObj: picked });
    let artifact = null;
    const artifactType = out?.artifactHint?.type || obviousArtifactType || null;
    const artifactTitle = out?.artifactHint?.title || null;
    if (artifactType) {
      try {
        artifact = artifactFromTextEnvelope({
          type: artifactType,
          title: artifactTitle,
          text: finalText,
        });
        if (artifact && typeof finalText === "string" && finalText.trim()) {
          artifact = { ...artifact, sourceMarkdown: finalText };
        }
      } catch {}
    }
    const estimatedCostUsd = estimateTextCostUsd({
      modelId: picked.id,
      provider: picked.provider,
      usage: out?.usage,
    });

    const latencyMs = Date.now() - startedAt;
    launchAIRequestUpdate(reqRow.id, {
      status: "succeeded",
      latencyMs,
      inputTokens: out?.usage?.prompt_tokens ?? null,
      outputTokens: out?.usage?.completion_tokens ?? null,
      estimatedCostUsd,
    });
    launchPostResponseMaintenance({
      userId,
      conversationId,
      normalizedPlan,
      periodStart: budgetWindowStart,
      budgetUsd: monthlyTextBudgetUsd,
      chatMessages,
      userText: text,
    });

    return {
      requestId: reqRow.id,
      provider: picked.provider,
      model: budgetForcedToDeepseek && userRequestedModelId ? userRequestedModelId : picked.id,
      executedModel: picked.id,
      remoteModel: picked.remoteModel,
      usedRemoteModel: out?.usedRemoteModel || null,
      usedApiVersion: out?.usedApiVersion || null,
      usedTransport: out?.usedTransport || null,
      selectionMode,
      text: finalText,
      usage: out.usage || null,
      estimatedCostUsd,
      budgetForcedToDeepseek,
      budgetState,
      webSearch: Boolean(webSearchMeta.used),
      webSearchDenied: Boolean(webSearchMeta.denied),
      sources: webSearchMeta.sources || null,
      artifact,
    };
  } catch (e) {
    let lastErr = e;

    // Fallback (paid users only, and only if we didn't already stream partial output).
    // - Auto: we can freely switch models/providers.
    // - Manual: we normally do NOT switch, but if the chosen OpenAI model doesn't exist / no access (404 model_not_found),
    //   we fall back to a safe OpenAI model to avoid "no response" for the user.
    if (isPaidPlan(normalizedPlan) && !hadDelta && !budgetForcedToDeepseek) {
      const candidates = [];
      const openaiModelNotFound = picked.provider === "openai" && isOpenAIModelNotFound(lastErr);
      const grokModelNotFound = picked.provider === "grok" && isGrokModelNotFound(lastErr);
      const deepseekModelNotFound = picked.provider === "deepseek" && isDeepSeekModelNotFound(lastErr);
      const moonshotModelNotFound = picked.provider === "moonshot" && isMoonshotModelNotFound(lastErr);
      const perplexityModelNotFound = picked.provider === "perplexity" && isPerplexityModelNotFound(lastErr);
      const qwenModelNotFound = picked.provider === "qwen" && isQwenModelNotFound(lastErr);
      const geminiModelNotFound = picked.provider === "gemini" && isGeminiModelNotFound(lastErr);
      const anthropicModelNotFound = picked.provider === "anthropic" && isAnthropicModelNotFound(lastErr);
      const emptyProviderResponse = lastErr?.message === "EMPTY_PROVIDER_RESPONSE";

      // 1) If OpenAI says the model doesn't exist / no access, retry with a safe OpenAI model.
      // This covers both auto + manual selections.
      if (openaiModelNotFound) {
        for (const id of ["gpt-5.4", "gpt-5", "gpt-5-mini", "gpt-5.2"]) {
          const m = getModel(id);
          if (m && m.provider === "openai" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }

      // 1a) If Grok says the model doesn't exist / no access, retry with a safe Grok model.
      if (grokModelNotFound) {
        for (const id of ["grok-4", "grok-4.1"]) {
          const m = getModel(id);
          if (m && m.provider === "grok" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }

      // 1ab) If DeepSeek says the model doesn't exist / no access, retry with a safe DeepSeek model.
      if (deepseekModelNotFound) {
        for (const id of ["deepseek-v3.2", "deepseek-r1"]) {
          const m = getModel(id);
          if (m && m.provider === "deepseek" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }

      // 1ac) If Moonshot/Kimi says the model doesn't exist / no access, retry with a safe Kimi model.
      if (moonshotModelNotFound) {
        for (const id of ["kimi-k2-5"]) {
          const m = getModel(id);
          if (m && m.provider === "moonshot" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }

      // 1ad) If Perplexity says the model doesn't exist / no access, retry with a safe Sonar model.
      if (perplexityModelNotFound) {
        for (const id of ["perplexity-sonar-pro", "perplexity-sonar"]) {
          const m = getModel(id);
          if (m && m.provider === "perplexity" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }

      // 1ae) If Qwen says the model doesn't exist / no access, retry with a safe Qwen model.
      if (qwenModelNotFound) {
        for (const id of ["qwen3-max"]) {
          const m = getModel(id);
          if (m && m.provider === "qwen" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }

      // 1b) If Gemini says the model doesn't exist / no access, retry with a safe Gemini model.
      // This covers both auto + manual selections.
      if (geminiModelNotFound) {
        for (const id of ["gemini-2.5 pro", "gemini-2.5 flash"]) {
          const m = getModel(id);
          if (m && m.provider === "gemini" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }

      // 1c) If Anthropic says the model doesn't exist / no access, retry with a safe Anthropic model.
      if (anthropicModelNotFound) {
        for (const id of ["claude-sonnet-4.6", "claude-sonnet-4.5", "claude-haiku-4.5"]) {
          const m = getModel(id);
          if (m && m.provider === "anthropic" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }

      // 1c) If the provider "succeeds" but returns empty output, retry with a safe model on the same provider.
      // This covers both auto + manual selections; we still avoid cross-provider switching in manual mode below.
      if (emptyProviderResponse && picked.provider === "openai") {
        for (const id of ["gpt-5.4", "gpt-5", "gpt-5-mini", "gpt-5.2"]) {
          const m = getModel(id);
          if (m && m.provider === "openai" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }
      if (emptyProviderResponse && picked.provider === "grok") {
        for (const id of ["grok-4", "grok-4.1"]) {
          const m = getModel(id);
          if (m && m.provider === "grok" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }
      if (emptyProviderResponse && picked.provider === "deepseek") {
        for (const id of ["deepseek-v3.2", "deepseek-r1"]) {
          const m = getModel(id);
          if (m && m.provider === "deepseek" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }
      if (emptyProviderResponse && picked.provider === "moonshot") {
        for (const id of ["kimi-k2-5"]) {
          const m = getModel(id);
          if (m && m.provider === "moonshot" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }
      if (emptyProviderResponse && picked.provider === "perplexity") {
        for (const id of ["perplexity-sonar-pro", "perplexity-sonar"]) {
          const m = getModel(id);
          if (m && m.provider === "perplexity" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }
      if (emptyProviderResponse && picked.provider === "qwen") {
        for (const id of ["qwen3-max"]) {
          const m = getModel(id);
          if (m && m.provider === "qwen" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }
      if (emptyProviderResponse && picked.provider === "gemini") {
        for (const id of ["gemini-2.5 pro", "gemini-2.5 flash"]) {
          const m = getModel(id);
          if (m && m.provider === "gemini" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }
      if (emptyProviderResponse && picked.provider === "anthropic") {
        for (const id of ["claude-sonnet-4.6", "claude-sonnet-4.5", "claude-haiku-4.5"]) {
          const m = getModel(id);
          if (m && m.provider === "anthropic" && m.remoteModel !== picked.remoteModel) candidates.push(m);
        }
      }

      // 2) Cross-provider fallback (keeps previous behavior) - ONLY in auto mode.
      // In manual mode we avoid switching providers (unless you decide otherwise later).
      if (selectionMode !== "manual") {
        const cross =
          picked.provider === "openai" ? getModel("gemini-2.5 pro") : getModel("gpt-5.4");
        if (cross && cross.provider !== picked.provider) candidates.push(cross);
      }

      // Try candidates in order until one works.
      for (const fb of candidates) {
        try {
          if (process.env.DEBUG_AI === "1") {
            console.error("[ai] fallback", {
              fromProvider: picked.provider,
              fromModel: picked.id,
              toProvider: fb.provider,
              toModel: fb.id,
              reason: openaiModelNotFound
                ? "openai_model_not_found"
                : grokModelNotFound
                  ? "grok_model_not_found"
                  : deepseekModelNotFound
                    ? "deepseek_model_not_found"
                    : moonshotModelNotFound
                      ? "moonshot_model_not_found"
                      : perplexityModelNotFound
                        ? "perplexity_model_not_found"
                        : qwenModelNotFound
                          ? "qwen_model_not_found"
                : geminiModelNotFound
                  ? "gemini_model_not_found"
                  : emptyProviderResponse
                    ? "empty_provider_response"
                  : "auto_fallback",
            });
          }

          const out2 = await callModel(fb);
          const fbText = assertNonEmptyText({ out: out2, modelObj: fb });
          const estimatedCostUsd = estimateTextCostUsd({
            modelId: fb.id,
            provider: fb.provider,
            usage: out2?.usage,
          });
          const latencyMs = Date.now() - startedAt;
          launchAIRequestUpdate(reqRow.id, {
            status: "succeeded",
            provider: fb.provider,
            model: fb.remoteModel,
            selectionMode: selectionMode === "manual" ? "manual" : "auto",
            latencyMs,
            inputTokens: out2?.usage?.prompt_tokens ?? null,
            outputTokens: out2?.usage?.completion_tokens ?? null,
            estimatedCostUsd,
            errorCode: null,
            errorMessage: null,
          });
          await refreshMonthlyTextBudgetSummary({
            userId,
            normalizedPlan,
            periodStart: budgetWindowStart,
            budgetUsd: monthlyTextBudgetUsd,
          });
          return {
            requestId: reqRow.id,
            provider: fb.provider,
            model: fb.id,
            executedModel: fb.id,
            remoteModel: fb.remoteModel,
            selectionMode: selectionMode === "manual" ? "manual" : "auto",
            text: fbText,
            usage: out2.usage || null,
            estimatedCostUsd,
            budgetForcedToDeepseek: false,
            budgetState,
            fallbackFrom: picked.id,
            webSearch: Boolean(webSearchMeta.used),
            webSearchDenied: Boolean(webSearchMeta.denied),
            sources: webSearchMeta.sources || null,
            artifact: null,
          };
        } catch (e2) {
          lastErr = e2;
        }
      }
    }

    const latencyMs = Date.now() - startedAt;
    await updateAIRequest(reqRow.id, {
      status: "failed",
      latencyMs,
      errorCode: lastErr?.message || "ERROR",
      errorMessage: String(lastErr?.details?.body || lastErr?.details?.missing || lastErr?.message || "ERROR").slice(
        0,
        1000
      ),
    });

    throw lastErr;
  }
}

module.exports = {
  streamChat,
};
