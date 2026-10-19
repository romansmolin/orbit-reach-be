import { Router } from 'express'
import { authMiddleware } from '@/middleware/auth.middleware'
import { AiController } from '@/controllers/ai.controller'
import { IAiService } from '@/services/ai-service'
import { IAiCreditsService } from '@/services/ai-credits-service'
import { ILogger } from '@/shared/infra/logger'

const createAiRoutes = (logger: ILogger, aiService: IAiService, aiCreditsService: IAiCreditsService) => {
    const router = Router()
    const controller = new AiController(aiService, aiCreditsService, logger)

    router.use(authMiddleware)

    router.get('/ai/credits', controller.getCredits.bind(controller))
    router.post('/ai/content', controller.generateIntroductoryCopy.bind(controller))

    return router
}

export default createAiRoutes
