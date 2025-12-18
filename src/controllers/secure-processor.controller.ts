import { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import {
    ISecureProcessorPaymentService,
    SecureProcessorAddonCode,
    SecureProcessorBillingPeriod,
    SecureProcessorItemType,
    SecureProcessorPlanCode,
} from '@/services/secure-processor-service'
import {
    FLEXIBLE_TOP_UP_MAX_CENTS,
    FLEXIBLE_TOP_UP_MIN_CENTS,
} from '@/services/secure-processor-service/flexible-topup-calculator'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { ILogger } from '@/shared/infra/logger/logger.interface'

const planTokenSchema = z.object({
    itemType: z.literal('plan').optional(),
    planCode: z.enum(['STARTER', 'PRO']),
    billingPeriod: z.enum(['monthly', 'yearly']),
})

const addonTokenSchema = z.object({
    itemType: z.literal('addon'),
    addonCode: z.enum(['EXTRA_SMALL', 'EXTRA_MEDIUM', 'EXTRA_LARGE']),
    promoCode: z.string().optional(),
})

const flexibleAddonTokenSchema = z.object({
    itemType: z.literal('addon'),
    addonCode: z.literal('FLEX_TOP_UP'),
    amount: z
        .number()
        .min(FLEXIBLE_TOP_UP_MIN_CENTS / 100)
        .max(FLEXIBLE_TOP_UP_MAX_CENTS / 100)
        .multipleOf(0.01),
    currency: z.literal('EUR').optional(),
    promoCode: z.string().optional(),
})

const createTokenSchema = z.union([planTokenSchema, addonTokenSchema, flexibleAddonTokenSchema])

const returnQuerySchema = z.object({
    token: z.string().min(1),
    status: z.string().optional(),
    uid: z.string().optional(),
})

export class SecureProcessorController {
    constructor(
        private readonly paymentService: ISecureProcessorPaymentService,
        private readonly logger: ILogger
    ) {}

    async createToken(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const parsed = createTokenSchema.safeParse(req.body)

            if (!parsed.success) {
                throw new BaseAppError('Invalid payment request payload', ErrorCode.BAD_REQUEST, 400)
            }

            if (!req.user?.id) {
                throw new BaseAppError('Unauthorized', ErrorCode.UNAUTHORIZED, 401)
            }

            const payload = parsed.data
            const itemType = (payload as { itemType?: SecureProcessorItemType }).itemType ?? 'plan'

            if (itemType === 'addon') {
                const addonPayload = payload as { addonCode: SecureProcessorAddonCode; amount?: number; currency?: 'EUR'; promoCode?: string }

                if (addonPayload.addonCode === 'FLEX_TOP_UP') {
                    const result = await this.paymentService.createCheckoutToken({
                        itemType: 'addon',
                        userId: req.user.id,
                        addonCode: 'FLEX_TOP_UP',
                        amount: addonPayload.amount as number,
                        currency: addonPayload.currency ?? 'EUR',
                        promoCode: addonPayload.promoCode,
                    })

                    res.status(200).json(result)
                    return
                }

                const result = await this.paymentService.createCheckoutToken({
                    itemType: 'addon',
                    userId: req.user.id,
                    addonCode: addonPayload.addonCode,
                    promoCode: addonPayload.promoCode,
                })

                res.status(200).json(result)
                return
            }

            const planPayload = payload as { planCode: SecureProcessorPlanCode; billingPeriod: SecureProcessorBillingPeriod }
            const result = await this.paymentService.createCheckoutToken({
                itemType: 'plan',
                userId: req.user.id,
                planCode: planPayload.planCode,
                billingPeriod: planPayload.billingPeriod,
            })

            res.status(200).json(result)
        } catch (error) {
            next(error)
        }
    }

    async handleReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const parsed = returnQuerySchema.safeParse({
                token: req.query.token,
                status: req.query.status,
                uid: req.query.uid,
            })

            if (!parsed.success) {
                throw new BaseAppError('Invalid return parameters', ErrorCode.BAD_REQUEST, 400)
            }

            const result = await this.paymentService.handleReturn({
                token: parsed.data.token,
                status: parsed.data.status,
                uid: parsed.data.uid,
            })

            res.redirect(result.redirectUrl)
        } catch (error) {
            if (error instanceof Error) {
                this.logger.error('Failed to handle Secure Processor return', {
                    error: { name: error.name, message: error.message },
                })
            }

            if (!res.headersSent) {
                const fallbackBase =
                    (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0]?.trim() ||
                    'http://localhost:3000'
                const normalizedBase = fallbackBase.replace(/\/$/, '')
                const params = new URLSearchParams({
                    status: 'error',
                })

                if (typeof req.query.token === 'string') {
                    params.append('token', req.query.token)
                }

                return res.redirect(`${normalizedBase}/payments/secure-processor/failed?${params.toString()}`)
            }

            next(error)
        }
    }

    async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!Buffer.isBuffer(req.body)) {
                throw new BaseAppError('Webhook payload must be a raw buffer', ErrorCode.BAD_REQUEST, 400)
            }

            const authorizationHeader = Array.isArray(req.headers.authorization)
                ? req.headers.authorization[0]
                : req.headers.authorization
            const signatureHeader = req.headers['content-signature']
            const contentSignature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader

            await this.paymentService.processWebhook(req.body, {
                authorization: authorizationHeader ?? undefined,
                contentSignature: contentSignature ?? undefined,
            })

            res.status(200).json({ received: true })
        } catch (error) {
            if (error instanceof Error) {
                this.logger.error('Secure Processor webhook handling failed', {
                    error: { name: error.name, message: error.message },
                })
            }
            next(error)
        }
    }
}
