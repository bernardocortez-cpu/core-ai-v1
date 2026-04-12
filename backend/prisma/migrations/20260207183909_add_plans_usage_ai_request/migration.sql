-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'PRO', 'PLUS', 'MAX');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'FREE',
ADD COLUMN     "planStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "MessageUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "messagesUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "messageId" TEXT,
    "mode" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "selectionMode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "estimatedCostUsd" DECIMAL(12,6),
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageUsage_periodStart_idx" ON "MessageUsage"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "MessageUsage_userId_periodStart_key" ON "MessageUsage"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "AIRequest_userId_createdAt_idx" ON "AIRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AIRequest_provider_createdAt_idx" ON "AIRequest"("provider", "createdAt");

-- CreateIndex
CREATE INDEX "AIRequest_status_createdAt_idx" ON "AIRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "User_plan_idx" ON "User"("plan");

-- AddForeignKey
ALTER TABLE "MessageUsage" ADD CONSTRAINT "MessageUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIRequest" ADD CONSTRAINT "AIRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
