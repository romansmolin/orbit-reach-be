import { Plan } from '../../entities/plan'
import { IPlansRepository } from '../../repositories/plans-repository/plans.repository.interface'
import { ErrorCode } from '../../shared/consts/error-codes.const'
import { BaseAppError } from '../../shared/errors/base-error'
import { IPlansService } from './plans.service.interface'

export class PlansService implements IPlansService {
    constructor(private repository: IPlansRepository) {}

    async getAllPlans(): Promise<Plan[]> {
        try {
            return await this.repository.findAllPlans()
        } catch (error: unknown) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to fetch plans', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
