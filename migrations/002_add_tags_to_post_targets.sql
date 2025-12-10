-- Migration: Add tags support to post_targets table
-- Date: 2025-09-12
-- Description: Add tags field to post_targets table to support hashtags for social media platforms

-- Add tags column to post_targets table
ALTER TABLE post_targets ADD COLUMN tags TEXT [] DEFAULT '{}';

-- Add comment to document the field
COMMENT ON COLUMN post_targets.tags IS 'Array of hashtags/tags for the post target (without # symbol)';

-- Create index for tags for better search performance
CREATE INDEX idx_post_targets_tags ON post_targets USING GIN (tags);