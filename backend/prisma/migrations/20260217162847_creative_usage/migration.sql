-- CreateTable
CREATE TABLE "CreativeUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "generationsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreativeUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreativeUsage_periodStart_idx" ON "CreativeUsage"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "CreativeUsage_userId_periodStart_key" ON "CreativeUsage"("userId", "periodStart");

-- AddForeignKey
ALTER TABLE "CreativeUsage" ADD CONSTRAINT "CreativeUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
