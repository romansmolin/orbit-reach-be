import express from 'express'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { StripeWebhookController } from './stripe-webhook.controller'
import { IStripeWebhookService } from '@/services/stripe-service/stripe.service.interface'

const createStripeWebhook = (logger: ILogger, stripeWebhookService: IStripeWebhookService) => {
    const router = express.Router()
    const controller = new StripeWebhookController(logger, stripeWebhookService)

    router.post(
        '/webhooks/stripe',
        express.raw({ type: 'application/json' }),
        controller.handleEvent.bind(controller)
    )

    return router
}

export default createStripeWebhook
