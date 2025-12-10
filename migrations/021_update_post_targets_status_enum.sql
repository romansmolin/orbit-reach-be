-- 2025-12-10
-- Align post_targets.status values with application enums (allow DONE/POSTING/etc.)

BEGIN;

-- Normalize legacy statuses to the current enum set
UPDATE post_targets SET status = 'PENDING' WHERE status IN ('pending', 'PENDING');
UPDATE post_targets SET status = 'POSTING' WHERE status IN ('processing', 'PROCESSING', 'posting', 'POSTING');
UPDATE post_targets SET status = 'DONE' WHERE status IN ('published', 'PUBLISHED', 'done', 'DONE');
UPDATE post_targets SET status = 'FAILED' WHERE status IN ('failed', 'FAILED', 'cancelled', 'CANCELLED');
UPDATE post_targets SET status = 'PARTIALLY_DONE' WHERE status IN ('partially_done', 'PARTIALLY_DONE', 'partial', 'PARTIAL');
UPDATE post_targets SET status = 'DRAFT' WHERE status IN ('draft', 'DRAFT');

ALTER TABLE post_targets ALTER COLUMN status DROP DEFAULT;
ALTER TABLE post_targets DROP CONSTRAINT IF EXISTS post_targets_status_check;

ALTER TABLE post_targets
    ALTER COLUMN status SET DEFAULT 'PENDING',
    ADD CONSTRAINT post_targets_status_check CHECK (
        status IN ('PENDING', 'POSTING', 'DONE', 'PARTIALLY_DONE', 'FAILED', 'DRAFT')
    );

COMMIT;
