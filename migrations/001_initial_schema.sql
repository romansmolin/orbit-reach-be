-- Easy Post Backend - Initial Database Schema Migration
-- This migration creates all the necessary tables for the Easy Post application

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- CORE TABLES
-- =============================================

-- Tenants/Users table
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT,
    google_auth BOOLEAN NOT NULL DEFAULT FALSE,
    avatar TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Plans table
CREATE TABLE plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name TEXT NOT NULL,
    monthly_price NUMERIC(10, 2) NOT NULL,
    yearly_price NUMERIC(10, 2) NOT NULL,
    popular BOOLEAN DEFAULT FALSE,
    description TEXT,
    button_text TEXT,
    benefit_list TEXT [],
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Tariffs table (for backward compatibility)
CREATE TABLE tariffs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    name TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    post_limit INTEGER NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- User Plans (subscriptions)
CREATE TABLE user_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    plan_name TEXT NOT NULL,
    plan_type TEXT NOT NULL,
    sent_posts_limit INTEGER NOT NULL,
    scheduled_posts_limit INTEGER NOT NULL,
    ai_requests_limit INTEGER NOT NULL DEFAULT 0,
    platforms_allowed TEXT [] NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User Plan Usage tracking
CREATE TABLE user_plan_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES user_plans (id) ON DELETE CASCADE,
    usage_type TEXT NOT NULL CHECK (
        usage_type IN ('sent', 'scheduled', 'accounts', 'ai')
    ),
    period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    used_count INTEGER DEFAULT 0 CHECK (used_count >= 0),
    limit_count INTEGER NOT NULL CHECK (limit_count > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (
        tenant_id,
        plan_id,
        usage_type,
        period_start,
        period_end
    )
);

-- =============================================
-- SOCIAL MEDIA TABLES
-- =============================================

-- Social Accounts
CREATE TABLE social_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    username TEXT NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    picture TEXT,
    connected_date TIMESTAMP WITHOUT TIME ZONE,
    page_id TEXT NOT NULL,
    expires_in TIMESTAMP WITHOUT TIME ZONE,
    refresh_expires_in TIMESTAMP WITHOUT TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (tenant_id, page_id)
);

-- Pinterest Boards
CREATE TABLE pinterest_boards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES social_accounts (id) ON DELETE CASCADE,
    pinterest_board_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    owner_username TEXT,
    thumbnail_url TEXT,
    privacy TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (
        privacy IN (
            'PUBLIC',
            'PROTECTED',
            'SECRET'
        )
    ),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, pinterest_board_id)
);

-- =============================================
-- CONTENT TABLES
-- =============================================

-- Media Assets
CREATE TABLE media_assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    file_size BIGINT,
    width INTEGER,
    height INTEGER,
    duration INTEGER,
    uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Posts
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
        status IN (
            'scheduled',
            'published',
            'failed',
            'cancelled'
        )
    ),
    scheduled_time TIMESTAMP WITH TIME ZONE,
    main_caption TEXT,
    cover_timestamp NUMERIC,
    cover_image_url TEXT,
    post_now BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Post Media Assets (carousel support)
CREATE TABLE post_media_assets (
    post_id UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    media_asset_id UUID NOT NULL REFERENCES media_assets (id) ON DELETE CASCADE,
    "order" INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (post_id, media_asset_id)
);

-- Post Targets (many-to-many scheduled social accounts)
CREATE TABLE post_targets (
    post_id UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
    social_account_id UUID NOT NULL REFERENCES social_accounts (id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (
        status IN (
            'PENDING',
            'PROCESSING',
            'PUBLISHED',
            'FAILED',
            'CANCELLED'
        )
    ),
    error_message TEXT,
    text TEXT,
    title TEXT,
    pinterest_board_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (post_id, social_account_id)
);

-- =============================================
-- USAGE TRACKING TABLES
-- =============================================

-- Platform Daily Usage
CREATE TABLE platform_daily_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    user_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    platform VARCHAR(50) NOT NULL,
    usage_date DATE NOT NULL,
    scheduled_count INTEGER NOT NULL DEFAULT 0 CHECK (scheduled_count >= 0),
    published_count INTEGER NOT NULL DEFAULT 0 CHECK (published_count >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, platform, usage_date)
);

-- =============================================
-- INDEXES REMOVED
-- =============================================
-- Indexes will be added later based on actual query patterns and performance needs

-- =============================================
-- TRIGGERS FOR UPDATED_AT
-- =============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to relevant tables
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_plans_updated_at BEFORE UPDATE ON user_plans FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_plan_usage_updated_at BEFORE UPDATE ON user_plan_usage FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_social_accounts_updated_at BEFORE UPDATE ON social_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pinterest_boards_updated_at BEFORE UPDATE ON pinterest_boards FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_posts_updated_at BEFORE UPDATE ON posts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_post_targets_updated_at BEFORE UPDATE ON post_targets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_platform_daily_usage_updated_at BEFORE UPDATE ON platform_daily_usage FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- CONSTRAINTS AND VALIDATIONS
-- =============================================

-- Add constraint to ensure used_count doesn't exceed limit_count
ALTER TABLE user_plan_usage
ADD CONSTRAINT chk_used_count_within_limit CHECK (used_count <= limit_count);

-- Add constraint to ensure platform values are valid
ALTER TABLE social_accounts
ADD CONSTRAINT chk_platform_valid CHECK (
    platform IN (
        'instagram',
        'tiktok',
        'youtube',
        'pinterest',
        'facebook',
        'threads',
        'x',
        'linkedin',
        'bluesky'
    )
);

-- Add constraint to ensure scheduled_time is in the future for scheduled posts
ALTER TABLE posts
ADD CONSTRAINT chk_scheduled_time_future CHECK (
    scheduled_time IS NULL
    OR scheduled_time > NOW()
    OR status != 'scheduled'
);
