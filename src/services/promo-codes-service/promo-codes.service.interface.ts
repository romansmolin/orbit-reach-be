import { PromoCode } from '@/entities/promo-code'

export interface IPromoCodesService {
    validateAndApply(code: string, amount: number): Promise<{ promoCode: PromoCode; discountAmount: number; finalAmount: number }>
    recordUsage(promoCodeId: string): Promise<void>
}

