import { PromoCode } from '@/entities/promo-code'
import { IPromoCodesRepository } from '@/repositories/promo-codes-repository'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { IPromoCodesService } from './promo-codes.service.interface'

export class PromoCodesService implements IPromoCodesService {
    constructor(private readonly repository: IPromoCodesRepository) {}

    async validateAndApply(code: string, amount: number): Promise<{ promoCode: PromoCode; discountAmount: number; finalAmount: number }> {
        if (!code || !code.trim()) {
            throw new BaseAppError('Promo code is required', ErrorCode.BAD_REQUEST, 400)
        }

        const promoCode = await this.repository.findByCode(code.trim())

        if (!promoCode) {
            throw new BaseAppError('Invalid promo code', ErrorCode.BAD_REQUEST, 400)
        }

        if (!promoCode.isValid()) {
            throw new BaseAppError('Promo code is expired or inactive', ErrorCode.BAD_REQUEST, 400)
        }

        const discountAmount = promoCode.calculateDiscount(amount)
        const finalAmount = amount - discountAmount

        return {
            promoCode,
            discountAmount,
            finalAmount,
        }
    }

    async recordUsage(promoCodeId: string): Promise<void> {
        await this.repository.incrementUsage(promoCodeId)
    }
}

