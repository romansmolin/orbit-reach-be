import { ITenantSettingsRepository } from '@/repositories/tenant-settings-repository/tenant-settings.repository.interface'
import {
    ITenantSettingsService,
    TenantSettingsResponse,
} from './tenant-settings.service.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'

export class TenantSettingsService implements ITenantSettingsService {
    private readonly repository: ITenantSettingsRepository

    constructor(repository: ITenantSettingsRepository) {
        this.repository = repository
    }

    async createTimezone(tenantId: string, timezone: string): Promise<{ timezone: string }> {
        const existingSettings = await this.repository.findByTenantId(tenantId)

        if (existingSettings) {
            throw new BaseAppError('Tenant settings already exist', ErrorCode.CONFLICT, 409)
        }

        const settings = await this.repository.create(tenantId, timezone)
        return { timezone: settings.timezone }
    }

    async updateTimezone(tenantId: string, timezone: string): Promise<{ timezone: string }> {
        const existingSettings = await this.repository.findByTenantId(tenantId)

        if (!existingSettings) {
            throw new BaseAppError('Tenant settings not found', ErrorCode.NOT_FOUND, 404)
        }

        const settings = await this.repository.updateTimezone(tenantId, timezone)
        return { timezone: settings.timezone }
    }

    async getTimezone(tenantId: string): Promise<string | null> {
        const existingSettings = await this.repository.findByTenantId(tenantId)
        return existingSettings?.timezone || null
    }

    async getSettings(tenantId: string): Promise<TenantSettingsResponse> {
        const existingSettings = await this.repository.findByTenantId(tenantId)
        return {
            timezone: existingSettings?.timezone || null,
        }
    }
}
