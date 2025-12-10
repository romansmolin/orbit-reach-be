import express from 'express'
import createAccountsRoutes from '@/routes/accounts.routes'
import createPostRoutes from '@/routes/post.routes'
import createUserRoutes from '@/routes/user.routes'
import createAiRoutes from '@/routes/ai.routes'
import createEmailRoutes from '@/routes/email.routes'
import createStripeWebhook from '@/webhooks/stripe/stripe.webhook'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { Services } from './services.config'

export function configureRoutes(app: express.Application, services: Services): void {
    app.use(createStripeWebhook(services.logger, services.stripeWebhookService))
    app.use(createUserRoutes(services.logger, services))
    app.use(createAccountsRoutes(services.logger, services))
    app.use(createPostRoutes(services.logger, services.postsService))
    app.use(createAiRoutes(services.logger, services.aiService))
    app.use(createEmailRoutes(services.logger, services.emailService))
}
