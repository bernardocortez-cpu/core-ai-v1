ALTER TABLE "creative_budget_months"
ADD COLUMN "generationsUsed" INTEGER NOT NULL DEFAULT 0;

UPDATE "creative_budget_months" cbm
SET "generationsUsed" = cu."generationsUsed"
FROM "CreativeUsage" cu
WHERE cbm."userId" = cu."userId"
  AND cbm."periodStart" = cu."periodStart";
