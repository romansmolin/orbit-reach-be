-- Migration: Add password reset tokens table
-- Date: 2025-11-16
-- Description: Store password reset tokens for tenants with expiration and usage tracking

CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4 (),
    tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    token_id UUID NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (token_id)
);

CREATE INDEX idx_password_reset_tokens_tenant_id ON password_reset_tokens (tenant_id);

CREATE TRIGGER update_password_reset_tokens_updated_at
BEFORE UPDATE ON password_reset_tokens
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
