-- CreateTable
CREATE TABLE "creative_budget_months" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "creativeCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creative_budget_months_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creative_budget_months_userId_periodStart_key" ON "creative_budget_months"("userId", "periodStart");

-- CreateIndex
CREATE INDEX "creative_budget_months_periodStart_idx" ON "creative_budget_months"("periodStart");

-- AddForeignKey
ALTER TABLE "creative_budget_months" ADD CONSTRAINT "creative_budget_months_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "sync_current_creative_budget_month_for_user"()
RETURNS TRIGGER
AS $$
DECLARE
  v_period_start TIMESTAMP(3);
  v_creative_cost_usd DECIMAL(12, 6);
BEGIN
  v_period_start := date_trunc('month', timezone('UTC', now()));

  SELECT COALESCE(SUM("estimatedCostUsd"), 0)::DECIMAL(12, 6)
    INTO v_creative_cost_usd
  FROM "AIRequest"
  WHERE "userId" = NEW."id"
    AND "mode" IN ('creative_studio', 'creative_studio_img2img')
    AND "status" = 'succeeded'
    AND "createdAt" >= v_period_start;

  INSERT INTO "creative_budget_months" (
    "id",
    "userId",
    "userEmail",
    "plan",
    "periodStart",
    "creativeCostUsd",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    md5(random()::text || clock_timestamp()::text || NEW."id" || NEW."email"),
    NEW."id",
    NEW."email",
    NEW."plan",
    v_period_start,
    v_creative_cost_usd,
    NOW(),
    NOW()
  )
  ON CONFLICT ("userId", "periodStart")
  DO UPDATE SET
    "userEmail" = EXCLUDED."userEmail",
    "plan" = EXCLUDED."plan",
    "creativeCostUsd" = EXCLUDED."creativeCostUsd",
    "updatedAt" = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "user_sync_creative_budget_month_after_insert" ON "User";
CREATE TRIGGER "user_sync_creative_budget_month_after_insert"
AFTER INSERT ON "User"
FOR EACH ROW
EXECUTE FUNCTION "sync_current_creative_budget_month_for_user"();

DROP TRIGGER IF EXISTS "user_sync_creative_budget_month_after_plan_or_email_update" ON "User";
CREATE TRIGGER "user_sync_creative_budget_month_after_plan_or_email_update"
AFTER UPDATE OF "plan", "email" ON "User"
FOR EACH ROW
WHEN (OLD."plan" IS DISTINCT FROM NEW."plan" OR OLD."email" IS DISTINCT FROM NEW."email")
EXECUTE FUNCTION "sync_current_creative_budget_month_for_user"();
