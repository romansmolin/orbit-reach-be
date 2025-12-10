import { AccountsController } from '@/controllers/accounts.controller'
import { authMiddleware } from '@/middleware/auth.middleware'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { Router } from 'express'
import { Services } from '@/config/services.config'

const createAccountsRoutes = (logger: ILogger, services: Services) => {
    const router = Router()

    const accountsController = new AccountsController(
        services.accountsService,
        services.socialMediaConnector,
        logger,
        services.oauthErrorHandler,
        services.oauthStateService
    )

    // Route to initiate the Facebook OAuth flow
    router.get('/facebook/authorize', authMiddleware, accountsController.initiateOAuth.bind(accountsController))

    // Route to handle Facebook/Instagram OAuth callback
    router.get('/facebook/callback', accountsController.connectFacebookAccount.bind(accountsController))

    // Route to handle Threads OAuth callback
    router.get('/threads/callback', accountsController.connectThreadsAccount.bind(accountsController))

    // Route to handle Tiktok OAuth callback
    router.get('/tiktok/callback', accountsController.connectTikTokAccount.bind(accountsController))

    // Route to handle YouTube OAuth callback
    router.get('/youtube/callback', accountsController.connectYouTubeAccount.bind(accountsController))

    // Route to handle X OAuth callback
    router.get('/x/callback', accountsController.connectXAccount.bind(accountsController))

    // Route to handle YouTube OAuth callback
    router.get('/pinterest/callback', accountsController.connectPinterestAccount.bind(accountsController))

    // Route to handle Instagram OAuth callback
    router.get('/instagram/callback', accountsController.connectInstagramAccount.bind(accountsController))

    // Route to handle Linkedin OAuth callback
    router.get('/linkedin/callback', accountsController.connectLinkedinAccount.bind(accountsController))

    router.use(authMiddleware)

    router.post('/oauth/state', accountsController.createOAuthState.bind(accountsController))

    router.post('/bluesky/connect', accountsController.connectBlueskyAccount.bind(accountsController))

    router.get('/accounts', accountsController.getAllAccounts.bind(accountsController))
    router.delete('/accounts/:accountId', accountsController.deleteAccount.bind(accountsController))
    router.get(
        '/accounts/:socialAccountId/pinterest-boards',
        accountsController.getPinterestBoards.bind(accountsController)
    )

    return router
}

export default createAccountsRoutes
