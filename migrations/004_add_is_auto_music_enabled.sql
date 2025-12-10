-- Migration: Add auto music support to post_targets table, specially for TikTok
-- Date: 2025-09-15
-- Description: Add auto music field to post_targets table to support music for TikTok

-- Add tags column to post_targets table
ALTER TABLE post_targets
ADD COLUMN is_auto_music_enabled BOOLEAN DEFAULT FALSE;

-- Add comment to document the field
COMMENT ON COLUMN post_targets.is_auto_music_enabled IS 'Flag fro TikTok to enable auto music';