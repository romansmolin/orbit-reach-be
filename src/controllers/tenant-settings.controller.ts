import { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { tenantTimezoneSchema } from '@/schemas/settings.schemas'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { ITenantSettingsService } from '@/services/tenant-settings-service/tenant-settings.service.interface'
import { ILogger } from '@/shared/infra/logger/logger.interface'

export class TenantSettingsController {
    private readonly service: ITenantSettingsService
    private readonly logger: ILogger

    constructor(service: ITenantSettingsService, logger: ILogger) {
        this.service = service
        this.logger = logger
    }

    async createTimezone(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id

            if (!userId) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const parsedBody = tenantTimezoneSchema.parse(req.body)
            const result = await this.service.createTimezone(userId, parsedBody.timezone)

            res.status(201).json({
                message: 'Timezone saved successfully',
                timezone: result.timezone,
            })
        } catch (error) {
            if (error instanceof ZodError) {
                this.logger.warn('Invalid timezone payload', {
                    operation: 'createTimezone',
                    issues: error.issues,
                })

                res.status(400).json({
                    message: 'Validation error',
                    errors: error.issues.map((issue) => issue.message),
                })
                return
            }

            next(error)
        }
    }

    async updateTimezone(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id

            if (!userId) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const parsedBody = tenantTimezoneSchema.parse(req.body)
            const result = await this.service.updateTimezone(userId, parsedBody.timezone)

            res.status(200).json({
                message: 'Timezone updated successfully',
                timezone: result.timezone,
            })
        } catch (error) {
            if (error instanceof ZodError) {
                this.logger.warn('Invalid timezone payload', {
                    operation: 'updateTimezone',
                    issues: error.issues,
                })

                res.status(400).json({
                    message: 'Validation error',
                    errors: error.issues.map((issue) => issue.message),
                })
                return
            }

            next(error)
        }
    }

    async getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id

            if (!userId) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const settings = await this.service.getSettings(userId)

            res.status(200).json({
                settings,
            })
        } catch (error) {
            next(error)
        }
    }
}
