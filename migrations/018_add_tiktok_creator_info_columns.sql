-- 2025-12-05
-- Add TikTok creator posting metadata to social_accounts for compliance checks.

ALTER TABLE social_accounts
ADD COLUMN IF NOT EXISTS max_video_post_duration_sec INTEGER;

ALTER TABLE social_accounts
ADD COLUMN IF NOT EXISTS privacy_level_options TEXT[];
