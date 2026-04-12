-- CreateEnum
CREATE TYPE "UserMemoryCategory" AS ENUM ('PERSONAL_INFO', 'PREFERENCES', 'WORK', 'STYLE', 'TECH_STACK', 'OTHER');

-- CreateEnum
CREATE TYPE "UserMemorySource" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "memoryEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" "UserMemoryCategory" NOT NULL DEFAULT 'OTHER',
    "source" "UserMemorySource" NOT NULL DEFAULT 'AUTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMemory_userId_updatedAt_idx" ON "UserMemory"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "UserMemory_userId_category_updatedAt_idx" ON "UserMemory"("userId", "category", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserMemory_userId_content_key" ON "UserMemory"("userId", "content");

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
