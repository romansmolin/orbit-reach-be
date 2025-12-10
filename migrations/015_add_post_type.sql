-- 2025-11-20
-- Add explicit post "type" to distinguish text vs media posts and set a sensible default for existing rows.

ALTER TABLE posts
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'text'
        CHECK (type IN ('text', 'media'));
