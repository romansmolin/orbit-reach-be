import { Router } from 'express'
import { authMiddleware } from '@/middleware/auth.middleware'
import { AiController } from '@/controllers/ai.controller'
import { IAiService } from '@/services/ai-service'
import { ILogger } from '@/shared/infra/logger'

const createAiRoutes = (logger: ILogger, aiService: IAiService) => {
    const router = Router()
    const controller = new AiController(aiService, logger)

    router.use(authMiddleware)

    router.post('/ai/content', controller.generateIntroductoryCopy.bind(controller))

    return router
}

export default createAiRoutes
