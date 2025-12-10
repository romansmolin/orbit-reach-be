import { Plan } from '../../entities/plan'

export interface IPlansService {
    getAllPlans(): Promise<Plan[]>
}
