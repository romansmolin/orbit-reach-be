-- 2025-12-12
-- Add item_type/addon metadata to payment_tokens for plan vs add-on purchases

BEGIN;

ALTER TABLE payment_tokens
    ADD COLUMN item_type TEXT NOT NULL DEFAULT 'plan' CHECK (item_type IN ('plan', 'addon')),
    ADD COLUMN addon_code TEXT,
    ADD COLUMN usage_deltas JSONB;

CREATE INDEX IF NOT EXISTS idx_payment_tokens_item_type ON payment_tokens (item_type);
CREATE INDEX IF NOT EXISTS idx_payment_tokens_addon_code ON payment_tokens (addon_code);

COMMIT;
