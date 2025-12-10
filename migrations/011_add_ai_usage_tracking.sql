-- 2025-11-07 - Add AI quota tracking

ALTER TABLE user_plans
    ADD COLUMN IF NOT EXISTS ai_requests_limit INTEGER DEFAULT 0;

ALTER TABLE user_plan_usage
    DROP CONSTRAINT IF EXISTS user_plan_usage_usage_type_check;

ALTER TABLE user_plan_usage
    ADD CONSTRAINT user_plan_usage_usage_type_check
    CHECK (usage_type IN ('sent', 'scheduled', 'accounts', 'ai'));

-- INSERT INTO user_plan_usage (
--     id,
--     tenant_id,
--     plan_id,
--     usage_type,
--     period_start,
--     period_end,
--     used_count,
--     limit_count
-- )
-- SELECT
--     uuid_generate_v4(),
--     up.tenant_id,
--     up.id,
--     'ai',
--     up.start_date,
--     COALESCE(up.end_date, up.start_date + INTERVAL '1 month' - INTERVAL '1 millisecond'),
--     0,
--     COALESCE(up.ai_requests_limit, 0)
-- FROM user_plans up
-- WHERE up.ai_requests_limit IS NOT NULL
--   AND NOT EXISTS (
--       SELECT 1
--       FROM user_plan_usage upu
--       WHERE upu.plan_id = up.id
--         AND upu.usage_type = 'ai'
--         AND upu.period_start = up.start_date
--         AND upu.period_end = COALESCE(up.end_date, up.start_date + INTERVAL '1 month' - INTERVAL '1 millisecond')
--   );
