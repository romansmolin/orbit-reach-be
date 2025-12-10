import { TenantSettings } from '@/entities/tenant-settings'

export interface ITenantSettingsRepository {
    create(tenantId: string, timezone: string): Promise<TenantSettings>
    updateTimezone(tenantId: string, timezone: string): Promise<TenantSettings>
    findByTenantId(tenantId: string): Promise<TenantSettings | null>
}
