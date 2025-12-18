import { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { IPromoCodesService } from '@/services/promo-codes-service/promo-codes.service.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { ILogger } from '@/shared/infra/logger/logger.interface'

const validatePromoCodeSchema = z.object({
    code: z.string().min(1, 'Promo code is required'),
    amount: z.number().min(0.01, 'Amount must be greater than 0'),
})

export class PromoCodesController {
    constructor(
        private readonly promoCodesService: IPromoCodesService,
        private readonly logger: ILogger
    ) {}

    async validatePromoCode(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const parsed = validatePromoCodeSchema.safeParse({
                code: req.body.code,
                amount: req.body.amount,
            })

            if (!parsed.success) {
                throw new BaseAppError('Invalid request parameters', ErrorCode.BAD_REQUEST, 400)
            }

            const result = await this.promoCodesService.validateAndApply(parsed.data.code, Math.round(parsed.data.amount * 100))

            res.status(200).json({
                valid: true,
                code: result.promoCode.code,
                discountPercentage: result.promoCode.discountPercentage,
                discountAmount: result.discountAmount / 100,
                originalAmount: parsed.data.amount,
                finalAmount: result.finalAmount / 100,
            })
        } catch (error) {
            if (error instanceof BaseAppError) {
                res.status(error.status).json({
                    valid: false,
                    error: error.message,
                })
                return
            }
            next(error)
        }
    }
}

