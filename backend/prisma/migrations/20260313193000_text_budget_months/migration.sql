-- CreateTable
CREATE TABLE "text_budget_months" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "textCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "budgetUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "budgetExceeded" BOOLEAN NOT NULL DEFAULT false,
    "forcedToDeepseekAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "text_budget_months_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "text_budget_months_userId_periodStart_key" ON "text_budget_months"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "text_budget_months_periodStart_idx" ON "text_budget_months"("periodStart");

-- CreateIndex
CREATE INDEX "text_budget_months_budgetExceeded_periodStart_idx" ON "text_budget_months"("budgetExceeded", "periodStart");

-- AddForeignKey
ALTER TABLE "text_budget_months" ADD CONSTRAINT "text_budget_months_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
