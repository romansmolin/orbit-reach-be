-- 2025-12-10
-- Align posts.status with application enums (uppercase) and set a sensible default

BEGIN;

-- Normalize any legacy lowercase values to the current enum set
UPDATE posts SET status = 'PENDING' WHERE status IN ('scheduled', 'SCHEDULED');
UPDATE posts SET status = 'DONE' WHERE status IN ('published', 'PUBLISHED');
UPDATE posts SET status = 'FAILED' WHERE status IN ('failed', 'FAILED');
UPDATE posts SET status = 'DRAFT' WHERE status IN ('draft', 'DRAFT');
UPDATE posts SET status = 'POSTING' WHERE status IN ('posting', 'POSTING');
UPDATE posts SET status = 'PARTIALLY_DONE' WHERE status IN ('partially_done', 'PARTIALLY_DONE', 'partial', 'PARTIAL');
UPDATE posts SET status = 'FAILED' WHERE status IN ('cancelled', 'CANCELLED');

ALTER TABLE posts ALTER COLUMN status DROP DEFAULT;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts
    ALTER COLUMN status SET DEFAULT 'PENDING',
    ADD CONSTRAINT posts_status_check CHECK (
        status IN ('PENDING', 'DRAFT', 'POSTING', 'DONE', 'PARTIALLY_DONE', 'FAILED')
    );

COMMIT;
