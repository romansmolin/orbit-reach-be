-- 2025-03-12
-- Add magic links table to support promotional signup flows (e.g., Starter one-month trial)

CREATE TABLE IF NOT EXISTS magic_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id TEXT NOT NULL UNIQUE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    promo_type TEXT NOT NULL DEFAULT 'STARTER_TRIAL',
    promo_duration_days INTEGER NOT NULL DEFAULT 30,
    max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
    redeemed_count INTEGER NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
    redeemed_at TIMESTAMPTZ,
    redeemed_by_user_id UUID REFERENCES tenants (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS magic_links_token_id_idx ON magic_links (token_id);
