import { Pool } from 'pg'
import { TenantSettings } from '@/entities/tenant-settings'
import { pgClient } from '@/db-connection'
import { ITenantSettingsRepository } from './tenant-settings.repository.interface'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'

interface TenantSettingsRow {
    id: string
    tenant_id: string
    timezone: string
    created_at: Date
    updated_at: Date
}

export class TenantSettingsRepository implements ITenantSettingsRepository {
    private readonly client: Pool
    private readonly logger: ILogger

    constructor(logger: ILogger) {
        this.client = pgClient()
        this.logger = logger
    }

    async create(tenantId: string, timezone: string): Promise<TenantSettings> {
        const client = await this.client.connect()

        try {
            const result = await client.query<TenantSettingsRow>(
                `
                INSERT INTO tenant_settings (tenant_id, timezone)
                VALUES ($1, $2)
                RETURNING id, tenant_id, timezone, created_at, updated_at
                `,
                [tenantId, timezone]
            )

            return this.toEntity(result.rows[0])
        } catch (error: unknown) {
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                (error as { code?: string }).code === '23505'
            ) {
                throw new BaseAppError('Tenant settings already exist', ErrorCode.CONFLICT, 409)
            }

            this.logger.error('Failed to create tenant settings', {
                operation: 'createTenantSettings',
                tenantId,
                error: error instanceof Error ? { name: error.name, stack: error.stack } : { name: 'UnknownError' },
            })

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError('Failed to create tenant settings', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async updateTimezone(tenantId: string, timezone: string): Promise<TenantSettings> {
        const client = await this.client.connect()

        try {
            const result = await client.query<TenantSettingsRow>(
                `
                UPDATE tenant_settings
                SET timezone = $2,
                    updated_at = NOW()
                WHERE tenant_id = $1
                RETURNING id, tenant_id, timezone, created_at, updated_at
                `,
                [tenantId, timezone]
            )

            if (result.rows.length === 0) {
                throw new BaseAppError('Tenant settings not found', ErrorCode.NOT_FOUND, 404)
            }

            return this.toEntity(result.rows[0])
        } catch (error: unknown) {
            this.logger.error('Failed to update tenant settings', {
                operation: 'updateTenantSettings',
                tenantId,
                error: error instanceof Error ? { name: error.name, stack: error.stack } : { name: 'UnknownError' },
            })

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError('Failed to update tenant settings', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async findByTenantId(tenantId: string): Promise<TenantSettings | null> {
        const client = await this.client.connect()

        try {
            const result = await client.query<TenantSettingsRow>(
                `
                SELECT id, tenant_id, timezone, created_at, updated_at
                FROM tenant_settings
                WHERE tenant_id = $1
                LIMIT 1
                `,
                [tenantId]
            )

            if (result.rows.length === 0) {
                return null
            }

            return this.toEntity(result.rows[0])
        } catch (error: unknown) {
            this.logger.error('Failed to fetch tenant settings', {
                operation: 'findTenantSettingsByTenantId',
                tenantId,
                error: error instanceof Error ? { name: error.name, stack: error.stack } : { name: 'UnknownError' },
            })

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError('Failed to fetch tenant settings', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    private toEntity(row: TenantSettingsRow): TenantSettings {
        return new TenantSettings(row.id, row.tenant_id, row.timezone, row.created_at, row.updated_at)
    }
}
