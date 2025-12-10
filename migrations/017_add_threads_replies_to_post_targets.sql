-- 2024-06-18
-- Add threads_replies to post_targets to support threaded replies (up to 10) for Threads posts

ALTER TABLE post_targets
ADD COLUMN threads_replies jsonb NOT NULL DEFAULT '[]'::jsonb;
