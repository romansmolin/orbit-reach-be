-- 2025-11-08 - Add billing status tracking for user plans

ALTER TABLE user_plans
    ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'active';

UPDATE user_plans
SET billing_status = COALESCE(billing_status, 'active');
