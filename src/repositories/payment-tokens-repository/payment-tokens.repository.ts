import { Pool } from 'pg'
import { pgClient } from '@/db-connection'
import { PaymentToken, PaymentTokenStatus, PaymentTokenItemType } from '@/entities/payment-token'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import {
    IPaymentTokensRepository,
    PaymentTokenCreateInput,
    PaymentTokenUpdateInput,
} from './payment-tokens.repository.interface'

export class PaymentTokensRepository implements IPaymentTokensRepository {
    private readonly client: Pool

    constructor() {
        this.client = pgClient()
    }

    private mapRow(row: any): PaymentToken {
        return new PaymentToken(
            row.id,
            row.token,
            row.tenant_id,
            row.plan_code,
            row.billing_period,
            Number(row.amount),
            row.currency,
            row.description ?? null,
            Boolean(row.test_mode),
            row.status as PaymentTokenStatus,
            row.gateway_uid ?? null,
            row.tracking_id ?? null,
            row.raw_payload ?? null,
            row.error_message ?? null,
            row.created_at,
            row.updated_at,
            row.item_type ?? 'plan',
            row.addon_code ?? null,
            row.usage_deltas ?? null,
            row.promo_code_id ?? null,
            row.original_amount !== null ? Number(row.original_amount) : null,
            row.discount_amount !== null ? Number(row.discount_amount) : 0
        )
    }

    async create(data: PaymentTokenCreateInput): Promise<PaymentToken> {
        try {
            const result = await this.client.query(
                `
                INSERT INTO payment_tokens (
                    token,
                    tenant_id,
                    plan_code,
                    billing_period,
                    amount,
                    currency,
                    description,
                    test_mode,
                    status,
                    gateway_uid,
                    tracking_id,
                    raw_payload,
                    item_type,
                    addon_code,
                    usage_deltas,
                    promo_code_id,
                    original_amount,
                    discount_amount
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                RETURNING *
                `,
                [
                    data.token,
                    data.tenantId,
                    data.planCode,
                    data.billingPeriod,
                    data.amount,
                    data.currency,
                    data.description ?? null,
                    data.testMode,
                    data.status ?? 'created',
                    data.gatewayUid ?? null,
                    data.trackingId ?? null,
                    data.rawPayload ?? null,
                    data.itemType ?? 'plan',
                    data.addonCode ?? null,
                    data.usageDeltas ?? null,
                    data.promoCodeId ?? null,
                    data.originalAmount ?? null,
                    data.discountAmount ?? 0,
                ]
            )

            return this.mapRow(result.rows[0])
        } catch (error: any) {
            throw new BaseAppError(
                `Failed to store payment token: ${error.message ?? 'unknown error'}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        }
    }

    async findByToken(token: string): Promise<PaymentToken | null> {
        try {
            const result = await this.client.query(`SELECT * FROM payment_tokens WHERE token = $1`, [token])
            if (!result.rows[0]) {
                return null
            }

            return this.mapRow(result.rows[0])
        } catch (error: any) {
            throw new BaseAppError(
                `Failed to fetch payment token: ${error.message ?? 'unknown error'}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        }
    }

    async updateByToken(token: string, updates: PaymentTokenUpdateInput): Promise<PaymentToken | null> {
        const fields: string[] = []
        const values: any[] = []

        if (updates.status) {
            fields.push(`status = $${fields.length + 1}`)
            values.push(updates.status)
        }

        if (updates.gatewayUid !== undefined) {
            fields.push(`gateway_uid = $${fields.length + 1}`)
            values.push(updates.gatewayUid)
        }

        if (updates.rawPayload !== undefined) {
            fields.push(`raw_payload = $${fields.length + 1}`)
            values.push(updates.rawPayload)
        }

        if (updates.errorMessage !== undefined) {
            fields.push(`error_message = $${fields.length + 1}`)
            values.push(updates.errorMessage)
        }

        if (updates.testMode !== undefined) {
            fields.push(`test_mode = $${fields.length + 1}`)
            values.push(updates.testMode)
        }

        if (updates.usageDeltas !== undefined) {
            fields.push(`usage_deltas = $${fields.length + 1}`)
            values.push(updates.usageDeltas)
        }

        if (fields.length === 0) {
            return this.findByToken(token)
        }

        const updateQuery = `
            UPDATE payment_tokens
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE token = $${fields.length + 1}
            RETURNING *
        `

        try {
            const result = await this.client.query(updateQuery, [...values, token])
            if (!result.rows[0]) {
                return null
            }

            return this.mapRow(result.rows[0])
        } catch (error: any) {
            throw new BaseAppError(
                `Failed to update payment token: ${error.message ?? 'unknown error'}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        }
    }

    async findByTenantId(tenantId: string, filters?: { status?: PaymentTokenStatus; itemType?: PaymentTokenItemType }): Promise<PaymentToken[]> {
        try {
            let query = 'SELECT * FROM payment_tokens WHERE tenant_id = $1'
            const params: any[] = [tenantId]
            let paramCount = 1

            if (filters?.status) {
                paramCount++
                query += ` AND status = $${paramCount}`
                params.push(filters.status)
            }

            if (filters?.itemType) {
                paramCount++
                query += ` AND item_type = $${paramCount}`
                params.push(filters.itemType)
            }

            query += ' ORDER BY created_at DESC'

            const result = await this.client.query(query, params)

            return result.rows.map((row) => this.mapRow(row))
        } catch (error: any) {
            throw new BaseAppError(
                `Failed to fetch payment tokens: ${error.message ?? 'unknown error'}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        }
    }
}
