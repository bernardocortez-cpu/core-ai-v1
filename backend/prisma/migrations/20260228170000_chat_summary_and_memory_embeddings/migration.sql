-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summaryUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "summaryMessageCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "UserMemory" ADD COLUMN     "embedding" JSONB;
