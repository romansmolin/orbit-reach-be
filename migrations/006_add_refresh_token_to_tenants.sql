-- 2025-09-27 Add refresh_token column to tenants for storing session metadata

ALTER TABLE tenants
    ADD COLUMN refresh_token TEXT;
