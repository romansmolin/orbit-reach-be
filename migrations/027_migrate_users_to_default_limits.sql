-- 2025-01-XX
-- Migrate existing users to default account limits
-- Set default_account_limit based on their current plan or default to 50

BEGIN;

-- Set default_account_limit for users who don't have one set
-- Priority: Use accounts_limit from active user_plans, otherwise default to 50
UPDATE tenants t
SET default_account_limit = COALESCE(
    (
        SELECT up.accounts_limit
        FROM user_plans up
        WHERE up.tenant_id = t.id
            AND up.is_active = TRUE
            AND (up.end_date IS NULL OR up.end_date > NOW())
        ORDER BY up.start_date DESC
        LIMIT 1
    ),
    50
)
WHERE default_account_limit IS NULL;

-- For users with unlimited (NULL accounts_limit), set default_account_limit to NULL (unlimited)
UPDATE tenants t
SET default_account_limit = NULL
WHERE EXISTS (
    SELECT 1
    FROM user_plans up
    WHERE up.tenant_id = t.id
        AND up.is_active = TRUE
        AND (up.end_date IS NULL OR up.end_date > NOW())
        AND up.accounts_limit IS NULL
    ORDER BY up.start_date DESC
    LIMIT 1
);

COMMIT;

