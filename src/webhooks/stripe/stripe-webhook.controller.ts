import { Request, Response, NextFunction } from 'express'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { IStripeWebhookService } from '@/services/stripe-service/stripe.service.interface'

export class StripeWebhookController {
    private readonly logger: ILogger
	private readonly stripeWebhookService: IStripeWebhookService

    constructor(logger: ILogger, stripeWebhookService: IStripeWebhookService) {
        this.logger = logger
		this.stripeWebhookService = stripeWebhookService
    }

    async handleEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {		
			if (!Buffer.isBuffer(req.body)) {
				throw new BaseAppError(
					'Stripe webhook payload must be provided as a raw buffer',
					ErrorCode.BAD_REQUEST,
					400
				)
			}

			const rawPayload = req.body as Buffer
			const signatureHeader = req.headers['stripe-signature']
			const stripeSignature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader
			
			if (!stripeSignature) {
				throw new BaseAppError(
					'Stripe signature header is missing',
					ErrorCode.BAD_REQUEST,
					400
				)
			}

			const stripeEvent = this.stripeWebhookService.constructEvent(rawPayload, stripeSignature)

			switch (stripeEvent.type) {
				case 'checkout.session.completed': {
					await this.stripeWebhookService.processCheckoutSessionCompleted(stripeEvent)
					break
				}
				case 'invoice.paid': {
					await this.stripeWebhookService.processInvoicePaid(stripeEvent)
					break
				}
				case 'invoice.upcoming': {
					await this.stripeWebhookService.processInvoiceUpcoming(stripeEvent)
					break
				}
				case 'customer.subscription.deleted': {
					await this.stripeWebhookService.processSubscriptionDeleted(stripeEvent)
					break
				}
				default:
					this.logger.info('Received unsupported Stripe event', {
						eventId: stripeEvent.id,
						eventType: stripeEvent.type
					})
			}

			res.status(200).json({ received: true })
        } catch (error) {
            this.logger.error('Failed to process Stripe webhook', {
                message: error instanceof Error ? { name: error.name, message: error.message } : error,
            })
            next(error)
        }
    }
}
