ALTER TABLE "creative_budget_months"
ADD COLUMN "creditsUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "creditsLimit" INTEGER NOT NULL DEFAULT 0;

UPDATE "creative_budget_months"
SET "creditsLimit" = CASE
  WHEN "plan" = 'PRO' THEN 5000
  WHEN "plan" = 'PLUS' THEN 10000
  WHEN "plan" = 'MAX' THEN 50000
  ELSE 0
END
WHERE "creditsLimit" = 0;
