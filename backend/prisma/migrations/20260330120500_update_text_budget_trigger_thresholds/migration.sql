CREATE OR REPLACE FUNCTION "sync_current_text_budget_month_for_user"()
RETURNS TRIGGER
AS $$
DECLARE
  v_period_start TIMESTAMP(3);
  v_budget_usd DECIMAL(12, 6);
  v_text_cost_usd DECIMAL(12, 6);
  v_budget_exceeded BOOLEAN;
BEGIN
  v_period_start := date_trunc('month', timezone('UTC', now()));

  v_budget_usd := CASE NEW."plan"
    WHEN 'PRO' THEN 8
    WHEN 'PLUS' THEN 15
    WHEN 'MAX' THEN 50
    ELSE 0
  END;

  SELECT COALESCE(SUM("estimatedCostUsd"), 0)::DECIMAL(12, 6)
    INTO v_text_cost_usd
  FROM "AIRequest"
  WHERE "userId" = NEW."id"
    AND "mode" = 'chat'
    AND "status" = 'succeeded'
    AND "createdAt" >= v_period_start;

  v_budget_exceeded := v_budget_usd > 0 AND v_text_cost_usd >= v_budget_usd;

  INSERT INTO "text_budget_months" (
    "id",
    "userId",
    "userEmail",
    "plan",
    "periodStart",
    "textCostUsd",
    "budgetUsd",
    "budgetExceeded",
    "forcedToDeepseekAt",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    md5(random()::text || clock_timestamp()::text || NEW."id" || NEW."email"),
    NEW."id",
    NEW."email",
    NEW."plan",
    v_period_start,
    v_text_cost_usd,
    v_budget_usd,
    v_budget_exceeded,
    CASE WHEN v_budget_exceeded THEN NOW() ELSE NULL END,
    NOW(),
    NOW()
  )
  ON CONFLICT ("userId", "periodStart")
  DO UPDATE SET
    "userEmail" = EXCLUDED."userEmail",
    "plan" = EXCLUDED."plan",
    "textCostUsd" = EXCLUDED."textCostUsd",
    "budgetUsd" = EXCLUDED."budgetUsd",
    "budgetExceeded" = EXCLUDED."budgetExceeded",
    "forcedToDeepseekAt" = CASE
      WHEN EXCLUDED."budgetExceeded" THEN COALESCE("text_budget_months"."forcedToDeepseekAt", NOW())
      ELSE NULL
    END,
    "updatedAt" = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

UPDATE "text_budget_months"
SET
  "budgetUsd" = CASE "plan"
    WHEN 'PRO' THEN 8
    WHEN 'PLUS' THEN 15
    WHEN 'MAX' THEN 50
    ELSE 0
  END,
  "budgetExceeded" = CASE
    WHEN CASE "plan"
      WHEN 'PRO' THEN 8
      WHEN 'PLUS' THEN 15
      WHEN 'MAX' THEN 50
      ELSE 0
    END > 0
    THEN "textCostUsd" >= CASE "plan"
      WHEN 'PRO' THEN 8
      WHEN 'PLUS' THEN 15
      WHEN 'MAX' THEN 50
      ELSE 0
    END
    ELSE FALSE
  END,
  "forcedToDeepseekAt" = CASE
    WHEN CASE "plan"
      WHEN 'PRO' THEN 8
      WHEN 'PLUS' THEN 15
      WHEN 'MAX' THEN 50
      ELSE 0
    END > 0
      AND "textCostUsd" >= CASE "plan"
        WHEN 'PRO' THEN 8
        WHEN 'PLUS' THEN 15
        WHEN 'MAX' THEN 50
        ELSE 0
      END
    THEN COALESCE("forcedToDeepseekAt", NOW())
    ELSE NULL
  END,
  "updatedAt" = NOW()
WHERE "periodStart" = date_trunc('month', timezone('UTC', now()));
