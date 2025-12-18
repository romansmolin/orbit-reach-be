-- 2025-01-XX
-- Create promo_codes table for add-on discounts
-- 10 promo codes with 20% discount, reusable

BEGIN;

CREATE TABLE promo_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL UNIQUE,
    discount_percentage INTEGER NOT NULL DEFAULT 20 CHECK (discount_percentage > 0 AND discount_percentage <= 100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    max_uses INTEGER, -- NULL means unlimited uses
    current_uses INTEGER NOT NULL DEFAULT 0,
    valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    valid_until TIMESTAMPTZ, -- NULL means no expiration
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create 10 promo codes
INSERT INTO promo_codes (code, discount_percentage, is_active, max_uses, valid_until) VALUES
    ('PROMO2025A', 20, TRUE, NULL, NULL),
    ('PROMO2025B', 20, TRUE, NULL, NULL),
    ('PROMO2025C', 20, TRUE, NULL, NULL),
    ('PROMO2025D', 20, TRUE, NULL, NULL),
    ('PROMO2025E', 20, TRUE, NULL, NULL),
    ('PROMO2025F', 20, TRUE, NULL, NULL),
    ('PROMO2025G', 20, TRUE, NULL, NULL),
    ('PROMO2025H', 20, TRUE, NULL, NULL),
    ('PROMO2025I', 20, TRUE, NULL, NULL),
    ('PROMO2025J', 20, TRUE, NULL, NULL);

CREATE INDEX idx_promo_codes_code ON promo_codes (code);
CREATE INDEX idx_promo_codes_active ON promo_codes (is_active, valid_from, valid_until);

CREATE TRIGGER update_promo_codes_updated_at
    BEFORE UPDATE ON promo_codes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;

