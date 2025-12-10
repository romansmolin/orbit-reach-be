import { Pool } from 'pg'
import { pgClient } from '../../db-connection'
import { Plan } from '../../entities/plan'
import { BaseAppError } from '../../shared/errors/base-error'
import { IPlansRepository } from './plans.repository.interface'
import { ErrorCode } from '../../shared/consts/error-codes.const'

export class PlansRepository implements IPlansRepository {
    private client: Pool

    constructor() {
        this.client = pgClient()
    }

    async findAllPlans(): Promise<Plan[]> {
        try {
            const result = await this.client.query('SELECT * FROM plans')

            return result.rows.map(
                (row) =>
                    new Plan(
                        row.plan_name,
                        row.monthly_price,
                        row.yearly_price,
                        row.popular,
                        row.description,
                        row.button_text,
                        row.benefit_list,
                        row.created_at,
                        row.updated_at
                    )
            )
        } catch (error: any) {
            throw new BaseAppError(`Failed to fetch plans: ${error.message}`, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
