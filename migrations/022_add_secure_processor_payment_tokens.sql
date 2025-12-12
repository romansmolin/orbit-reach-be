-- 2025-12-12
-- Add payment_tokens table to track Secure Processor checkouts and webhook returns

BEGIN;

CREATE TABLE payment_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token TEXT NOT NULL UNIQUE,
    tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    plan_code TEXT NOT NULL,
    billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL,
    description TEXT,
    test_mode BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'created' CHECK (
        status IN ('created', 'pending', 'successful', 'failed', 'declined', 'expired', 'error')
    ),
    gateway_uid TEXT,
    tracking_id TEXT,
    raw_payload JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_tokens_tenant_id ON payment_tokens (tenant_id);
CREATE INDEX idx_payment_tokens_status ON payment_tokens (status);

CREATE TRIGGER update_payment_tokens_updated_at
    BEFORE UPDATE ON payment_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
