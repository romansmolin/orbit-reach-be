-- 2025-02-13 - Enforce non-empty timezone values in tenant_settings
-- This migration trims existing timezone values and ensures future records cannot store blank strings.

UPDATE tenant_settings
SET timezone = BTRIM(timezone)
WHERE timezone IS NOT NULL;

ALTER TABLE tenant_settings
ADD CONSTRAINT tenant_settings_timezone_not_blank
CHECK (BTRIM(timezone) <> '');


