import { Pool } from 'pg'
import { pgClient } from '@/db-connection'
import { PromoCode } from '@/entities/promo-code'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { IPromoCodesRepository } from './promo-codes.repository.interface'

export class PromoCodesRepository implements IPromoCodesRepository {
    private readonly client: Pool

    constructor() {
        this.client = pgClient()
    }

    private mapRow(row: any): PromoCode {
        return new PromoCode(
            row.id,
            row.code,
            row.discount_percentage,
            row.is_active,
            row.max_uses,
            row.current_uses,
            row.valid_from,
            row.valid_until,
            row.created_at,
            row.updated_at
        )
    }

    async findByCode(code: string): Promise<PromoCode | null> {
        try {
            const result = await this.client.query(
                'SELECT * FROM promo_codes WHERE code = $1',
                [code.toUpperCase()]
            )

            if (!result.rows[0]) {
                return null
            }

            return this.mapRow(result.rows[0])
        } catch (error: any) {
            throw new BaseAppError(
                `Failed to find promo code: ${error.message ?? 'unknown error'}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        }
    }

    async incrementUsage(promoCodeId: string): Promise<void> {
        try {
            await this.client.query(
                'UPDATE promo_codes SET current_uses = current_uses + 1, updated_at = NOW() WHERE id = $1',
                [promoCodeId]
            )
        } catch (error: any) {
            throw new BaseAppError(
                `Failed to increment promo code usage: ${error.message ?? 'unknown error'}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        }
    }
}

