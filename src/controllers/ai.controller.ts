import { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { aiApiPayloadSchema } from '@/schemas/ai.schema'
import { IAiService } from '@/services/ai-service'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'

export class AiController {
    constructor(
        private readonly aiService: IAiService,
        private readonly logger: ILogger
    ) {}

    async generateIntroductoryCopy(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const payload = aiApiPayloadSchema.parse(req.body)
            const items = await this.aiService.generateIntroductoryCopy(req.user.id, payload)

            res.status(200).json({ items })
        } catch (error: unknown) {
            if (error instanceof ZodError) {
                this.logger.warn('AI request validation failed', {
                    operation: 'ai_generate_content',
                    error: {
                        name: error.name,
                        code: error.message,
                    },
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
