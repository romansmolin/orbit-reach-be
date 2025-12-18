-- 2025-01-XX
-- Add default_account_limit to tenants table
-- Default limits: 50, 100, 200, or NULL (unlimited)
-- This replaces subscription-based account limits

BEGIN;

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS default_account_limit INTEGER CHECK (
        default_account_limit IS NULL OR default_account_limit > 0
    );

-- Set default to 50 for existing users (can be adjusted per user later)
UPDATE tenants
SET default_account_limit = 50
WHERE default_account_limit IS NULL;

COMMIT;

