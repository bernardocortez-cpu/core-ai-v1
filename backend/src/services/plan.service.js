const prisma = require("../lib/prisma");
const {
  normalizePlan,
  getMessageLimit,
  getMessageLimitWindow,
  getMonthlyCreativeGenerationLimit,
  getMonthlyCreativeCreditLimit,
  getCreativeModelCreditCost,
  isPaidPlan,
} = require("../config/plans");

function monthStartUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function nextMonthStartUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function dayStartUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function nextDayStartUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
}

function getMessageUsageWindow(plan, at = new Date()) {
  const normalizedPlan = normalizePlan(plan);
  const window = getMessageLimitWindow(normalizedPlan);
  if (window === "day") {
    return {
      window,
      periodStart: dayStartUTC(at),
      periodEnd: nextDayStartUTC(at),
    };
  }

  return {
    window,
    periodStart: monthStartUTC(at),
    periodEnd: nextMonthStartUTC(at),
  };
}

async function getUsage({ userId, at = new Date() }) {
  const creativePeriodStart = monthStartUTC(at);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { plan: true, email: true },
  });

  const plan = normalizePlan(user?.plan);
  const messageWindow = getMessageUsageWindow(plan, at);

  const usage = await prisma.messageUsage.findUnique({
    where: { userId_periodStart: { userId, periodStart: messageWindow.periodStart } },
  });

  const creativeCreditsLimit = getMonthlyCreativeCreditLimit(plan);

  const creativeBudget = await prisma.creativeBudgetMonth.upsert({
    where: { userId_periodStart: { userId, periodStart: creativePeriodStart } },
    create: {
      userId,
      userEmail: user?.email || "",
      plan,
      periodStart: creativePeriodStart,
      creativeCostUsd: 0,
      generationsUsed: 0,
      creditsUsed: 0,
      creditsLimit: creativeCreditsLimit,
    },
    update: {
      userEmail: user?.email || undefined,
      plan,
      creditsLimit: creativeCreditsLimit,
    },
  });

  const limit = getMessageLimit(plan);
  const used = usage?.messagesUsed || 0;

  const creativeLimit = getMonthlyCreativeGenerationLimit(plan);
  const creativeUsed = creativeBudget?.generationsUsed || 0;
  const creativeCreditsUsed = creativeBudget?.creditsUsed || 0;

  return {
    plan,
    periodStart: messageWindow.periodStart.toISOString(),
    periodEnd: messageWindow.periodEnd.toISOString(),
    limitWindow: messageWindow.window,
    limit,
    used,
    remaining: Math.max(0, limit - used),

    creativePeriodStart: creativePeriodStart.toISOString(),
    creativePeriodEnd: nextMonthStartUTC(at).toISOString(),
    creativeLimit,
    creativeUsed,
    creativeRemaining: Math.max(0, creativeLimit - creativeUsed),
    creativeCreditsLimit,
    creativeCreditsUsed,
    creativeCreditsRemaining: Math.max(0, creativeCreditsLimit - creativeCreditsUsed),
  };
}

async function assertAndConsumeMessage({ userId, at = new Date() }) {
  // Do it atomically so concurrent requests can't exceed the limit.
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    });

    const plan = normalizePlan(user?.plan);
    const messageWindow = getMessageUsageWindow(plan, at);
    const periodStart = messageWindow.periodStart;
    const limit = getMessageLimit(plan);

    const usage = await tx.messageUsage.upsert({
      where: { userId_periodStart: { userId, periodStart } },
      create: { userId, periodStart, messagesUsed: 0 },
      update: {},
    });

    if (usage.messagesUsed >= limit) {
      const err = new Error("PLAN_MESSAGE_LIMIT_REACHED");
      err.status = 402; // payment required semantics
      err.details = {
        plan,
        limit,
        used: usage.messagesUsed,
        limitWindow: messageWindow.window,
        periodEnd: messageWindow.periodEnd.toISOString(),
      };
      throw err;
    }

    const updated = await tx.messageUsage.update({
      where: { id: usage.id },
      data: { messagesUsed: { increment: 1 } },
    });

    return {
      plan,
      periodStart,
      periodEnd: messageWindow.periodEnd,
      limitWindow: messageWindow.window,
      limit,
      used: updated.messagesUsed,
      remaining: Math.max(0, limit - updated.messagesUsed),
    };
  });
}

async function assertAndConsumeCreativeGeneration({ userId, at = new Date() }) {
  const periodStart = monthStartUTC(at);

  // Do it atomically so concurrent requests can't exceed the limit.
  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { plan: true, email: true },
    });

    const plan = normalizePlan(user?.plan);
    const limit = getMonthlyCreativeGenerationLimit(plan);

    const usage = await tx.creativeBudgetMonth.upsert({
      where: { userId_periodStart: { userId, periodStart } },
      create: {
        userId,
        userEmail: user?.email || "",
        plan,
        periodStart,
        creativeCostUsd: 0,
        generationsUsed: 0,
        creditsUsed: 0,
        creditsLimit: getMonthlyCreativeCreditLimit(plan),
      },
      update: {
        userEmail: user?.email || undefined,
        plan,
        creditsLimit: getMonthlyCreativeCreditLimit(plan),
      },
    });

    if (usage.generationsUsed >= limit) {
      const err = new Error("PLAN_CREATIVE_LIMIT_REACHED");
      err.status = 402;
      err.details = { plan, limit, used: usage.generationsUsed };
      throw err;
    }

    const updated = await tx.creativeBudgetMonth.update({
      where: { id: usage.id },
      data: { generationsUsed: { increment: 1 } },
    });

    return {
      plan,
      periodStart,
      limit,
      used: updated.generationsUsed,
      remaining: Math.max(0, limit - updated.generationsUsed),
    };
  });
}

async function refundCreativeGeneration({ userId, at = new Date() }) {
  const periodStart = monthStartUTC(at);

  return await prisma.$transaction(async (tx) => {
    const usage = await tx.creativeBudgetMonth.findUnique({
      where: { userId_periodStart: { userId, periodStart } },
    });

    if (!usage || usage.generationsUsed <= 0) {
      return { ok: true, used: usage?.generationsUsed || 0 };
    }

    const updated = await tx.creativeBudgetMonth.update({
      where: { id: usage.id },
      data: { generationsUsed: { decrement: 1 } },
    });

    return { ok: true, used: updated.generationsUsed };
  });
}

async function assertAndConsumeCreativeCredits({ userId, plan, modelId, credits, at = new Date() }) {
  const periodStart = monthStartUTC(at);

  return await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { plan: true, email: true },
    });

    const effectivePlan = normalizePlan(plan || user?.plan);
    const requestedCredits = Math.max(
      0,
      Number.isFinite(Number(credits)) ? Math.round(Number(credits)) : getCreativeModelCreditCost(modelId)
    );
    const creditLimit = getMonthlyCreativeCreditLimit(effectivePlan);

    const usage = await tx.creativeBudgetMonth.upsert({
      where: { userId_periodStart: { userId, periodStart } },
      create: {
        userId,
        userEmail: user?.email || "",
        plan: effectivePlan,
        periodStart,
        creativeCostUsd: 0,
        creditsUsed: 0,
        creditsLimit: creditLimit,
      },
      update: {
        userEmail: user?.email || undefined,
        plan: effectivePlan,
        creditsLimit: creditLimit,
      },
    });

    if (!isPaidPlan(effectivePlan)) {
      const err = new Error("PLAN_CREATIVE_CREDITS_NOT_ENABLED");
      err.status = 402;
      err.details = {
        plan: effectivePlan,
        limit: creditLimit,
        used: usage.creditsUsed || 0,
        requested: requestedCredits,
        unit: "credits",
      };
      throw err;
    }

    if (requestedCredits <= 0) {
      return {
        plan: effectivePlan,
        periodStart,
        limit: creditLimit,
        used: usage.creditsUsed || 0,
        requested: 0,
        remaining: Math.max(0, creditLimit - (usage.creditsUsed || 0)),
      };
    }

    if ((usage.creditsUsed || 0) + requestedCredits > creditLimit) {
      const err = new Error("PLAN_CREATIVE_LIMIT_REACHED");
      err.status = 402;
      err.details = {
        plan: effectivePlan,
        limit: creditLimit,
        used: usage.creditsUsed || 0,
        requested: requestedCredits,
        remaining: Math.max(0, creditLimit - (usage.creditsUsed || 0)),
        unit: "credits",
      };
      throw err;
    }

    const updated = await tx.creativeBudgetMonth.update({
      where: { id: usage.id },
      data: { creditsUsed: { increment: requestedCredits } },
    });

    return {
      plan: effectivePlan,
      periodStart,
      limit: creditLimit,
      used: updated.creditsUsed || 0,
      requested: requestedCredits,
      remaining: Math.max(0, creditLimit - (updated.creditsUsed || 0)),
    };
  });
}

async function refundCreativeCredits({ userId, credits, at = new Date() }) {
  const periodStart = monthStartUTC(at);
  const requestedCredits = Math.max(0, Number.isFinite(Number(credits)) ? Math.round(Number(credits)) : 0);

  if (requestedCredits <= 0) {
    return { ok: true, used: 0 };
  }

  return await prisma.$transaction(async (tx) => {
    const usage = await tx.creativeBudgetMonth.findUnique({
      where: { userId_periodStart: { userId, periodStart } },
    });

    if (!usage || (usage.creditsUsed || 0) <= 0) {
      return { ok: true, used: usage?.creditsUsed || 0 };
    }

    const updated = await tx.creativeBudgetMonth.update({
      where: { id: usage.id },
      data: { creditsUsed: { decrement: Math.min(requestedCredits, usage.creditsUsed || 0) } },
    });

    return { ok: true, used: updated.creditsUsed || 0 };
  });
}

module.exports = {
  monthStartUTC,
  getUsage,
  assertAndConsumeMessage,
  assertAndConsumeCreativeGeneration,
  refundCreativeGeneration,
  assertAndConsumeCreativeCredits,
  refundCreativeCredits,
};
