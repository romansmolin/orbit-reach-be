import { NextFunction, Request, Response } from 'express'
import { ErrorCode } from '../shared/consts/error-codes.const'
import { BaseAppError } from '../shared/errors/base-error'
import { IPlansService } from '@/services/plans-service'

export class PlansController {
    private interactor: IPlansService

    constructor(interactor: IPlansService) {
        this.interactor = interactor
    }

    async getAllPlans(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const plans = await this.interactor.getAllPlans()

            if (!plans || plans.length === 0) {
                throw new BaseAppError('No plans found', ErrorCode.NOT_FOUND, 404)
            }

            res.status(200).json(plans)
        } catch (error) {
            next(error)
        }
    }
}
