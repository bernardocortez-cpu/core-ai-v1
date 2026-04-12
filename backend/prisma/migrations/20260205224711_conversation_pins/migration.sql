-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "pinned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pinnedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Conversation_userId_pinned_pinnedAt_updatedAt_idx" ON "Conversation"("userId", "pinned", "pinnedAt", "updatedAt");
