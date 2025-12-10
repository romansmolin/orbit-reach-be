import { Plan } from '../../entities/plan'

export interface IPlansRepository {
    findAllPlans(): Promise<Plan[]>
}
