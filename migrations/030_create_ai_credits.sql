-- 2026-10-19
-- AI credits: persistent per-tenant balance (does not reset monthly) plus a ledger of every change.
-- Credits are granted on successful payment and spent on AI post generation.
-- ai_credit_transactions.reference is unique so a payment can never grant credits twice.

CREATE TABLE IF NOT EXISTS tenant_ai_credits (
    tenant_id UUID PRIMARY KEY REFERENCES tenants (id) ON DELETE CASCADE,
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    delta INTEGER NOT NULL CHECK (delta <> 0),
    reason TEXT NOT NULL CHECK (reason IN ('purchase', 'generation', 'refund')),
    reference TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_credit_transactions_tenant_id ON ai_credit_transactions (tenant_id, created_at DESC);
