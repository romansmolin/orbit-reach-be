import { PlansController } from '@/controllers/plans.controller'
import { PlansRepository } from '@/repositories/plans-repository'
import { PlansService } from '@/services/plans-service'
import { Router } from 'express'

const router = Router()

const repository = new PlansRepository()
const interactor = new PlansService(repository)
const controller = new PlansController(interactor)

router.get('/plans', controller.getAllPlans.bind(controller))

export default router
