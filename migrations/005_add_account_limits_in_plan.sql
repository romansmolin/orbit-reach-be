-- Migration: Add account limits in user_plans table
-- Date: 2025-09-21
-- Description: We need to restrict user without Pro plan to connect accounts

-- Add tags column to post_targets table
ALTER TABLE user_plans ADD COLUMN accounts_limit NUMERIC DEFAULT 1;