-- 2025-12-05
-- Add TikTok post privacy level to post_targets for per-post privacy selection.

ALTER TABLE post_targets
ADD COLUMN IF NOT EXISTS tik_tok_post_privacy_level TEXT
    CHECK (
        tik_tok_post_privacy_level IN (
            'SELF_ONLY',
            'PUBLIC_TO_EVERYONE',
            'MUTUAL_FOLLOW_FRIENDS',
            'FOLLOWER_OF_CREATOR'
        )
    );

COMMENT ON COLUMN post_targets.tik_tok_post_privacy_level IS 'Optional TikTok privacy level for a specific post target';
