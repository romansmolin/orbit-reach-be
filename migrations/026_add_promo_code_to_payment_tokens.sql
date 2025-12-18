-- 2025-01-XX
-- Add promo code tracking to payment_tokens
-- Track which promo code was used and the discounted amount

BEGIN;

ALTER TABLE payment_tokens
    ADD COLUMN IF NOT EXISTS promo_code_id UUID REFERENCES promo_codes (id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS original_amount INTEGER, -- Amount before discount
    ADD COLUMN IF NOT EXISTS discount_amount INTEGER DEFAULT 0; -- Discount amount in cents

CREATE INDEX idx_payment_tokens_promo_code ON payment_tokens (promo_code_id);

COMMIT;

