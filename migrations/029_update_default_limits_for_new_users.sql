-- 2025-01-XX
-- Update default limits for new user signups
-- New defaults: Post Limits - 130, Schedule limits - 100, AI usage - 30, Accounts - 10
-- This migration updates the DEFAULT values in the database schema

BEGIN;

-- Update default values for new user signups
ALTER TABLE tenants
    ALTER COLUMN default_sent_posts_limit SET DEFAULT 130,
    ALTER COLUMN default_scheduled_posts_limit SET DEFAULT 100,
    ALTER COLUMN default_ai_requests_limit SET DEFAULT 30;

-- Update default_account_limit default (if it exists, otherwise this will be a no-op)
-- Note: default_account_limit allows NULL for unlimited accounts, so we set a default only if needed
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'tenants' 
        AND column_name = 'default_account_limit'
        AND column_default IS NULL
    ) THEN
        ALTER TABLE tenants ALTER COLUMN default_account_limit SET DEFAULT 10;
    END IF;
END $$;

COMMIT;

