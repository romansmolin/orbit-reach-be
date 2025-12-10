import { Router } from 'express'
import { UserController } from '../controllers/user.controller'
import { ILogger } from '../shared/infra/logger/logger.interface'
import { authMiddleware } from '@/middleware/auth.middleware'
import { TenantSettingsController } from '@/controllers/tenant-settings.controller'
import { Services } from '@/config/services.config'

const createUserRoutes = (logger: ILogger, services: Services) => {
    const router = Router()

    const controller = new UserController(services.userService, logger)
    const tenantSettingsController = new TenantSettingsController(services.tenantSettingsService, logger)

    router.post('/auth/signup', controller.signup.bind(controller))
    router.post('/auth/signin', controller.signin.bind(controller))
    router.post('/auth/password/forgot', controller.requestPasswordReset.bind(controller))
    router.post('/auth/password/reset', controller.resetPassword.bind(controller))

    router.get('/auth/callback/google', controller.googleAuth.bind(controller))
	
    router.get('/user/user-info', authMiddleware, controller.getUser.bind(controller))
    router.post('/user/update-subscription', authMiddleware, controller.updateSubscription.bind(controller))
    router.post('/user/cancel-subscription', authMiddleware, controller.cancelSubscription.bind(controller))

    router.get(
        '/user/settings',
        authMiddleware,
        tenantSettingsController.getSettings.bind(tenantSettingsController)
    )
    router.post('/user/settings/timezone', authMiddleware, tenantSettingsController.createTimezone.bind(tenantSettingsController))
    router.put('/user/settings/timezone', authMiddleware, tenantSettingsController.updateTimezone.bind(tenantSettingsController))

    return router
}

export default createUserRoutes
