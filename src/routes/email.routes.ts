import { Router } from 'express'
import { EmailController } from '@/controllers/email.controller'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { IEmailService } from '@/services/email-service/email-service.interface'

const createEmailRoutes = (logger: ILogger, emailService: IEmailService) => {
    const router = Router()
    const controller = new EmailController(emailService, logger)

    router.post('/contact-us', controller.contactUsRequest.bind(controller))

    return router
}

export default createEmailRoutes
