import { Request, Response, NextFunction } from 'express'
import { ZodError } from 'zod'
import { IEmailService } from '@/services/email-service/email-service.interface'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { contactRequestSchema } from '@/schemas/contact.schema'

export class EmailController {
    constructor(
        private readonly emailService: IEmailService,
        private readonly logger: ILogger
    ) {}

    async contactUsRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const payload = contactRequestSchema.parse(req.body)

            await this.emailService.sendEmail(payload.name, payload.email, payload.message)

            this.logger.info('Contact request email sent', {
                operation: 'contact_us_request',
                entity: 'Email',
                userId: req.user?.id,
            })

            res.status(200).json({ message: 'Thank you for contacting us' })
        } catch (error: unknown) {
            if (error instanceof ZodError) {
                this.logger.warn('Invalid contact request payload', {
                    operation: 'contact_us_request',
                    entity: 'Email',
                })

                res.status(400).json({
                    message: 'Validation error',
                    errors: error.issues.map((issue) => ({
                        path: issue.path.join('.'),
                        message: issue.message,
                    })),
                })
                return
            }

            next(error)
        }
    }
}
