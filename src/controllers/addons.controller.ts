import { NextFunction, Request, Response } from 'express'
import { IPaymentTokensRepository } from '@/repositories/payment-tokens-repository'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { PaymentTokenStatus } from '@/entities/payment-token'

export class AddonsController {
    constructor(
        private readonly paymentTokensRepository: IPaymentTokensRepository,
        private readonly logger: ILogger
    ) {}

    async getPurchasedAddons(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                throw new BaseAppError('Unauthorized', ErrorCode.UNAUTHORIZED, 401)
            }

            const tokens = await this.paymentTokensRepository.findByTenantId(req.user.id, {
                itemType: 'addon',
                status: 'successful',
            })

            const addons = tokens.map((token) => ({
                id: token.id,
                addonCode: token.addonCode,
                amount: token.amount / 100,
                currency: token.currency,
                description: token.description,
                usageDeltas: token.usageDeltas,
                promoCodeId: token.promoCodeId,
                discountAmount: token.discountAmount / 100,
                originalAmount: token.originalAmount ? token.originalAmount / 100 : null,
                createdAt: token.createdAt,
            }))

            res.status(200).json({ addons })
        } catch (error) {
            next(error)
        }
    }

    async getAvailableAddons(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const addons = [
                {
                    code: 'EXTRA_SMALL',
                    name: 'Extra Small Package',
                    description: 'Extra Small Usage Package',
                    amount: 1.0,
                    currency: 'EUR',
                    usageDeltas: {
                        sentPosts: 20,
                        scheduledPosts: 10,
                        aiRequests: 10,
                    },
                },
                {
                    code: 'EXTRA_MEDIUM',
                    name: 'Extra Medium Package',
                    description: 'Extra Medium Usage Package',
                    amount: 5.0,
                    currency: 'EUR',
                    usageDeltas: {
                        sentPosts: 100,
                        scheduledPosts: 80,
                        aiRequests: 30,
                    },
                },
                {
                    code: 'EXTRA_LARGE',
                    name: 'Extra Large Package',
                    description: 'Extra Large Usage Package',
                    amount: 10.0,
                    currency: 'EUR',
                    usageDeltas: {
                        sentPosts: 500,
                        scheduledPosts: 450,
                        aiRequests: 100,
                    },
                },
                {
                    code: 'FLEX_TOP_UP',
                    name: 'Flexible Top-Up',
                    description: 'Custom amount top-up',
                    minAmount: 1.0,
                    maxAmount: 100.0,
                    currency: 'EUR',
                    flexible: true,
                },
            ]

            res.status(200).json({ addons })
        } catch (error) {
            next(error)
        }
    }
}

