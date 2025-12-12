import express, { Router } from 'express'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { Services } from '@/config/services.config'
import { SecureProcessorController } from '@/controllers/secure-processor.controller'
import { authMiddleware } from '@/middleware/auth.middleware'

const createPaymentsRoutes = (logger: ILogger, services: Services) => {
    const router = Router()
    const controller = new SecureProcessorController(services.secureProcessorPaymentService, logger)

    router.post(
        '/payments/secure-processor/token',
        authMiddleware,
        controller.createToken.bind(controller)
    )

    router.get('/payments/secure-processor/return', controller.handleReturn.bind(controller))

    router.post(
        '/payments/secure-processor/webhook',
        express.raw({ type: '*/*' }),
        controller.handleWebhook.bind(controller)
    )

    return router
}

export default createPaymentsRoutes
