import express, { Router } from 'express'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { Services } from '@/config/services.config'
import { SecureProcessorController } from '@/controllers/secure-processor.controller'
import { PromoCodesController } from '@/controllers/promo-codes.controller'
import { AddonsController } from '@/controllers/addons.controller'
import { authMiddleware } from '@/middleware/auth.middleware'
import { PromoCodesService } from '@/services/promo-codes-service/promo-codes.service'
import { PromoCodesRepository } from '@/repositories/promo-codes-repository'
import { PaymentTokensRepository } from '@/repositories/payment-tokens-repository'

const createPaymentsRoutes = (logger: ILogger, services: Services) => {
    const router = Router()
    const secureProcessorController = new SecureProcessorController(services.secureProcessorPaymentService, logger)
    
    const promoCodesRepository = new PromoCodesRepository()
    const promoCodesService = new PromoCodesService(promoCodesRepository)
    const promoCodesController = new PromoCodesController(promoCodesService, logger)
    
    const paymentTokensRepository = new PaymentTokensRepository()
    const addonsController = new AddonsController(paymentTokensRepository, logger)

    router.post(
        '/payments/secure-processor/token',
        authMiddleware,
        secureProcessorController.createToken.bind(secureProcessorController)
    )

    router.get('/payments/secure-processor/return', secureProcessorController.handleReturn.bind(secureProcessorController))

    router.post(
        '/payments/secure-processor/webhook',
        express.raw({ type: '*/*' }),
        secureProcessorController.handleWebhook.bind(secureProcessorController)
    )

    router.post(
        '/payments/promo-code/validate',
        authMiddleware,
        promoCodesController.validatePromoCode.bind(promoCodesController)
    )

    router.get(
        '/addons/purchased',
        authMiddleware,
        addonsController.getPurchasedAddons.bind(addonsController)
    )

    router.get(
        '/addons/available',
        authMiddleware,
        addonsController.getAvailableAddons.bind(addonsController)
    )

    return router
}

export default createPaymentsRoutes
