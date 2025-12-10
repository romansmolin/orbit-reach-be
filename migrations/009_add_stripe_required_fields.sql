-- 2025-11-05 - Integrating stripe
ALTER TABLE tenants
  ADD COLUMN stripe_customer_id TEXT UNIQUE;

-- К плану добавим связь со Stripe
ALTER TABLE user_plans
  ADD COLUMN stripe_subscription_id TEXT UNIQUE,
  ADD COLUMN stripe_price_id TEXT,
  ADD COLUMN status TEXT, -- active, trialing, past_due, canceled, unpaid, incomplete
  ADD COLUMN current_period_end TIMESTAMPTZ;

-- На будущее удобно иметь lookup ключ (например, starter_monthly)
ALTER TABLE user_plans
  ADD COLUMN stripe_lookup_key TEXT;