-- 2025-01-XX
-- Set default limits for all users (sent posts, scheduled posts, AI requests)
-- This migrates from subscription-based limits to default limits + add-ons model
-- Account limits are already handled in migration 024 (default_account_limit)

BEGIN;

-- Add default limits columns to tenants table
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS default_sent_posts_limit INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN IF NOT EXISTS default_scheduled_posts_limit INTEGER NOT NULL DEFAULT 10,
    ADD COLUMN IF NOT EXISTS default_ai_requests_limit INTEGER NOT NULL DEFAULT 0;

-- Migrate existing users: use their current plan limits as defaults
-- Priority: Use limits from active user_plans, otherwise use FREE plan defaults
UPDATE tenants t
SET 
    default_sent_posts_limit = COALESCE(
        (SELECT up.sent_posts_limit
         FROM user_plans up
         WHERE up.tenant_id = t.id
             AND up.is_active = TRUE
             AND (up.end_date IS NULL OR up.end_date > NOW())
         ORDER BY up.start_date DESC
         LIMIT 1),
        30
    ),
    default_scheduled_posts_limit = COALESCE(
        (SELECT up.scheduled_posts_limit
         FROM user_plans up
         WHERE up.tenant_id = t.id
             AND up.is_active = TRUE
             AND (up.end_date IS NULL OR up.end_date > NOW())
         ORDER BY up.start_date DESC
         LIMIT 1),
        10
    ),
    default_ai_requests_limit = COALESCE(
        (SELECT up.ai_requests_limit
         FROM user_plans up
         WHERE up.tenant_id = t.id
             AND up.is_active = TRUE
             AND (up.end_date IS NULL OR up.end_date > NOW())
         ORDER BY up.start_date DESC
         LIMIT 1),
        0
    );

-- Update user_plan_usage to reflect new default limits
-- This ensures current usage periods use the correct base limits
UPDATE user_plan_usage upu
SET limit_count = CASE
    WHEN upu.usage_type = 'sent' THEN t.default_sent_posts_limit
    WHEN upu.usage_type = 'scheduled' THEN t.default_scheduled_posts_limit
    WHEN upu.usage_type = 'accounts' THEN COALESCE(t.default_account_limit, 999999)
    WHEN upu.usage_type = 'ai' THEN t.default_ai_requests_limit
END
FROM tenants t
WHERE upu.tenant_id = t.id
    AND upu.period_start <= NOW()
    AND upu.period_end >= NOW();

-- For accounts usage, handle unlimited (NULL) case
UPDATE user_plan_usage upu
SET limit_count = 999999
FROM tenants t
WHERE upu.tenant_id = t.id
    AND upu.usage_type = 'accounts'
    AND t.default_account_limit IS NULL
    AND upu.period_start <= NOW()
    AND upu.period_end >= NOW();

COMMIT;

