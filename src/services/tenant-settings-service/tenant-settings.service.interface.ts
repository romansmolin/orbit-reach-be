export interface ITenantSettingsService {
    createTimezone(tenantId: string, timezone: string): Promise<{ timezone: string }>
    updateTimezone(tenantId: string, timezone: string): Promise<{ timezone: string }>
    getTimezone(tenantId: string): Promise<string | null>
    getSettings(tenantId: string): Promise<TenantSettingsResponse>
}

export interface TenantSettingsResponse {
    timezone: string | null
}
