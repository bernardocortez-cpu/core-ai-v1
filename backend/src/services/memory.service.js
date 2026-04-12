const prisma = require("../lib/prisma");
const { normalizePlan } = require("../config/plans");

const MEMORY_LIMITS = {
  FREE: 0,
  PRO: 1000,
  PLUS: 5000,
  MAX: 15000,
};

function getMemoryLimit(plan) {
  const p = normalizePlan(plan);
  return Number.isFinite(MEMORY_LIMITS[p]) ? MEMORY_LIMITS[p] : 0;
}

function normalizeCategory(raw) {
  const s = String(raw || "").trim().toUpperCase();
  const allowed = new Set([
    "PERSONAL_INFO",
    "PREFERENCES",
    "WORK",
    "STYLE",
    "TECH_STACK",
    "OTHER",
  ]);
  return allowed.has(s) ? s : null;
}

function normalizeContent(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function getUserMemoryState({ userId }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, memoryEnabled: true },
  });

  const plan = normalizePlan(user?.plan);
  const limit = getMemoryLimit(plan);

  const used = await prisma.userMemory.count({ where: { userId } });

  return {
    plan,
    available: limit > 0,
    limit,
    used,
    enabled: Boolean(user?.memoryEnabled),
  };
}

async function listMemories({ userId }) {
  const state = await getUserMemoryState({ userId });

  const items = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });

  return { ...state, items };
}

async function setMemoryEnabled({ userId, enabled }) {
  const state = await getUserMemoryState({ userId });

  const want = Boolean(enabled);
  if (want && !state.available) {
    const err = new Error("MEMORY_NOT_AVAILABLE_ON_PLAN");
    err.status = 402;
    err.details = { plan: state.plan };
    throw err;
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { memoryEnabled: want },
    select: { memoryEnabled: true },
  });

  return { ...state, enabled: Boolean(updated.memoryEnabled) };
}

async function toggleMemoryEnabled({ userId }) {
  const state = await getUserMemoryState({ userId });

  if (!state.available) {
    // Free plan: always force off.
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { memoryEnabled: false },
      select: { memoryEnabled: true },
    });
    return { ...state, enabled: Boolean(updated.memoryEnabled) };
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { memoryEnabled: !state.enabled },
    select: { memoryEnabled: true },
  });

  return { ...state, enabled: Boolean(updated.memoryEnabled) };
}

async function patchMemory({ userId, id, content, category }) {
  const nextContent = normalizeContent(content);
  if (!nextContent) {
    const err = new Error("INVALID_MEMORY_CONTENT");
    err.status = 400;
    throw err;
  }
  if (nextContent.length > 500) {
    const err = new Error("MEMORY_TOO_LONG");
    err.status = 400;
    err.details = { maxChars: 500 };
    throw err;
  }

  const nextCategory = category != null ? normalizeCategory(category) : null;
  if (category != null && !nextCategory) {
    const err = new Error("INVALID_MEMORY_CATEGORY");
    err.status = 400;
    throw err;
  }

  return await prisma.$transaction(async (tx) => {
    const existing = await tx.userMemory.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!existing || existing.userId !== userId) {
      const err = new Error("NOT_FOUND");
      err.status = 404;
      throw err;
    }

    return await tx.userMemory.update({
      where: { id },
      data: {
        content: nextContent,
        ...(nextCategory ? { category: nextCategory } : null),
        source: "MANUAL",
      },
    });
  });
}

async function deleteMemory({ userId, id }) {
  return await prisma.$transaction(async (tx) => {
    const existing = await tx.userMemory.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!existing || existing.userId !== userId) {
      const err = new Error("NOT_FOUND");
      err.status = 404;
      throw err;
    }
    await tx.userMemory.delete({ where: { id } });
    return { ok: true };
  });
}

async function deleteAllMemory({ userId }) {
  const out = await prisma.userMemory.deleteMany({ where: { userId } });
  return { ok: true, deleted: out.count || 0 };
}

async function enforceMemoryLimit({ userId, plan }) {
  const limit = getMemoryLimit(plan);
  if (!limit || limit <= 0) return;

  const count = await prisma.userMemory.count({ where: { userId } });
  if (count <= limit) return;

  const overflow = count - limit;

  const toDelete = await prisma.userMemory.findMany({
    where: { userId, source: "AUTO" },
    orderBy: { updatedAt: "asc" },
    take: overflow,
    select: { id: true },
  });

  if (toDelete.length === 0) return;
  await prisma.userMemory.deleteMany({ where: { userId, id: { in: toDelete.map((x) => x.id) } } });
}

module.exports = {
  getMemoryLimit,
  getUserMemoryState,
  listMemories,
  setMemoryEnabled,
  toggleMemoryEnabled,
  patchMemory,
  deleteMemory,
  deleteAllMemory,
  enforceMemoryLimit,
  normalizeCategory,
  normalizeContent,
};
