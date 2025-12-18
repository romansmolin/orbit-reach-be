import { PromoCode } from '@/entities/promo-code'

export interface IPromoCodesRepository {
    findByCode(code: string): Promise<PromoCode | null>
    incrementUsage(promoCodeId: string): Promise<void>
}

