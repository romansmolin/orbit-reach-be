-- Migration: Add link support to post_targets table
-- Date: 2025-09-13
-- Description: Add links field to post_targets table to support links for social media platforms

-- Add tags column to post_targets table
ALTER TABLE post_targets ADD COLUMN links TEXT [] DEFAULT '{}';

-- Add comment to document the field
COMMENT ON COLUMN post_targets.links IS 'Array of links for the post target';

-- Create index for links for better search performance
CREATE INDEX idx_post_targets_links ON post_targets USING GIN (links);