-- Migration: Add Instagram location/audio metadata to post_targets
-- Date: 2025-11-16
-- Description: Allow saving Instagram location tag and reel audio name for publishing

ALTER TABLE post_targets
    ADD COLUMN instagram_location_id TEXT,
    ADD COLUMN instagram_facebook_page_id TEXT;

COMMENT ON COLUMN post_targets.instagram_location_id IS 'Instagram Page ID used for the location tag (not supported for carousel items)';
COMMENT ON COLUMN post_targets.instagram_facebook_page_id IS 'Connected Facebook Page ID selected for Instagram location tagging';
