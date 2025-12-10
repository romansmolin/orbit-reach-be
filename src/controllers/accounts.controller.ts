import { AccountsService, IAccountsService } from '@/services/accounts-service'
import { ISocilaMediaConnectorService } from '@/services/social-media-connector-service'
import { BaseAppError } from '@/shared/errors/base-error'
import { handleAxiosErrors } from '@/shared/errors/handle-axios-error'
import { RequestValidationError } from '@/shared/errors/request-validation-error'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { IOAuthErrorHandler } from '@/shared/infra/oauth-errors/oauth-error-handler.interface'
import { IOAuthStateService, OAuthStatePayload } from '@/shared/infra/oauth-state'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { Request, Response, NextFunction } from 'express'
import { isAxiosError } from 'axios'
import { z } from 'zod'

const oauthStateRequestSchema = z.object({
    platform: z.nativeEnum(SocilaMediaPlatform),
    reconnect: z.boolean().optional().default(false),
    codeVerifier: z.string().min(8).max(512).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
})
export class AccountsController {
    private accountsInteractor: IAccountsService
    private readonly FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'
    private logger: ILogger
    private socialMediaConnector: ISocilaMediaConnectorService
    private oauthErrorHandler: IOAuthErrorHandler
    private oauthStateService: IOAuthStateService

    constructor(
        accountsInteractor: IAccountsService,
        socialMediaConnector: ISocilaMediaConnectorService,
        logger: ILogger,
        oauthErrorHandler: IOAuthErrorHandler,
        oauthStateService: IOAuthStateService
    ) {
        this.accountsInteractor = accountsInteractor
        this.logger = logger
        this.socialMediaConnector = socialMediaConnector
        this.oauthErrorHandler = oauthErrorHandler
        this.oauthStateService = oauthStateService
    }

    private redirectWithParams(res: Response, params: Record<string, string>): void {
        const queryString = Object.entries(params)
            .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
            .join('&')

        res.redirect(`${this.FRONTEND_URL}/accounts?${queryString}`)
    }

    private resolveOAuthState(stateValue: unknown, platform: SocilaMediaPlatform): OAuthStatePayload {
        if (typeof stateValue !== 'string' || stateValue.trim().length === 0) {
            throw new BaseAppError('Missing OAuth state parameter', ErrorCode.BAD_REQUEST, 400)
        }

        const trimmedState = stateValue.trim()

        try {
            const signedState = this.oauthStateService.verifyState(trimmedState)
            return this.ensureValidState(signedState, platform)
        } catch (error) {
            const legacyState = this.tryParseLegacyState(trimmedState)

            if (legacyState) {
                return this.ensureValidState(legacyState, platform)
            }

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError('Invalid OAuth state parameter', ErrorCode.BAD_REQUEST, 400)
        }
    }

    private ensureValidState(state: OAuthStatePayload, platform: SocilaMediaPlatform): OAuthStatePayload {
        if (!state.userId || state.userId.trim().length === 0) {
            throw new BaseAppError('OAuth state is missing user identifier', ErrorCode.BAD_REQUEST, 400)
        }

        if (state.platform !== platform) {
            throw new BaseAppError('OAuth state platform mismatch', ErrorCode.BAD_REQUEST, 400)
        }

        return {
            userId: state.userId,
            platform: state.platform,
            reconnect: Boolean(state.reconnect),
            codeVerifier: state.codeVerifier,
            metadata: state.metadata,
        }
    }

    private tryParseLegacyState(rawState: string): OAuthStatePayload | null {
        if (!rawState.startsWith('{')) {
            return null
        }

        try {
            const parsed = JSON.parse(rawState)

            if (typeof parsed !== 'object' || parsed === null) {
                return null
            }

            const userId = typeof parsed.userId === 'string' ? parsed.userId : ''
            const platform = typeof parsed.platform === 'string' ? parsed.platform.toLowerCase() : ''

            if (!userId || !platform) {
                return null
            }

            const allowedPlatforms = new Set(Object.values(SocilaMediaPlatform))
            if (!allowedPlatforms.has(platform as SocilaMediaPlatform)) {
                return null
            }

            const reconnect = typeof parsed.reconnect === 'boolean' ? parsed.reconnect : false
            const codeVerifier = typeof parsed.codeVerifier === 'string' ? parsed.codeVerifier : undefined

            return {
                userId,
                platform: platform as SocilaMediaPlatform,
                reconnect,
                codeVerifier,
            }
        } catch (error) {
            void error
            return null
        }
    }

    async initiateOAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                throw new RequestValidationError('User not authenticated', ErrorCode.UNAUTHORIZED)
            }

            const fbAppId = process.env.FB_APP_ID
            const redirectUri = `${process.env.BACKEND_URL}${process.env.FB_REDIRECT_URI}`

            if (!fbAppId || !redirectUri) {
                this.logger.error('Missing Facebook app configuration', {
                    operation: 'initiate_oauth',
                    entity: 'Account',
                })
                throw new BaseAppError('Facebook app configuration is missing', ErrorCode.UNKNOWN_ERROR, 404)
            }

            const stateToken = this.oauthStateService.issueState({
                userId: req.user.id,
                reconnect: false,
                platform: SocilaMediaPlatform.FACEBOOK,
            })

            const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${fbAppId}&redirect_uri=${redirectUri}&state=${encodeURIComponent(stateToken)}&scope=pages_show_list,pages_read_engagement,pages_manage_posts`

            res.json({ authUrl })
        } catch (error) {
            this.logger.error('Failed to initiate OAuth', {
                operation: 'initiate_oauth',
                entity: 'Account',
                userId: req.user?.id,
            })
            next(error)
        }
    }

    async connectLinkedinAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { code, state, error } = req.query

            this.logger.info('Starting LinkedIn account connection', {
                operation: 'connect_linkedin_account',
                entity: 'Account',
                hasCode: !!code,
                hasError: !!error,
            })

            // Handle OAuth error from LinkedIn
            if (error) {
                this.logger.warn('LinkedIn OAuth error received', {
                    operation: 'connect_linkedin_account',
                    entity: 'Account',
                    error: {
                        code: error as string,
                        name: error as string,
                    },
                })
                const errorParams = this.oauthErrorHandler.handleOAuthError(
                    new Error(error as string),
                    SocilaMediaPlatform.LINKEDIN
                )
                return res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
            }

            // Validate required parameters
            if (!code || !state) {
                this.logger.warn('Missing required parameters for LinkedIn OAuth', {
                    operation: 'connect_linkedin_account',
                    entity: 'Account',
                })
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_request',
                        description: 'Missing authorization code or state parameter',
                        userFriendlyMessage: 'Invalid authorization request. Please try connecting your account again.',
                        urlParams: 'error=invalid_request&reason=Missing%20required%20parameters',
                    },
                    SocilaMediaPlatform.LINKEDIN
                )
                return res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
            }

            let stateData: OAuthStatePayload
            try {
                stateData = this.resolveOAuthState(state, SocilaMediaPlatform.LINKEDIN)
            } catch {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_state',
                        description: 'Invalid state parameter',
                        userFriendlyMessage: 'Invalid session. Please try connecting your account again.',
                        urlParams: 'error=invalid_state&reason=Invalid%20state%20parameter',
                    },
                    SocilaMediaPlatform.LINKEDIN
                )
                return res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
            }

            const result = await this.socialMediaConnector.connectLinkedinAccount(stateData.userId, code as string)

            if (result.success) {
                this.logger.info('LinkedIn account connected successfully', {
                    operation: 'connect_linkedin_account',
                    entity: 'Account',
                    userId: stateData.userId,
                })
                this.redirectWithParams(res, {
                    status: 'success',
                    message: 'Account connected successfully',
                })
            } else {
                this.logger.warn('Failed to connect LinkedIn account', {
                    operation: 'connect_linkedin_account',
                    entity: 'Account',
                    userId: stateData.userId,
                })
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'connection_failed',
                        description: 'Failed to connect LinkedIn account',
                        userFriendlyMessage: 'Unable to connect your LinkedIn account. Please try again.',
                        urlParams: 'error=connection_failed&reason=Account%20connection%20failed',
                    },
                    SocilaMediaPlatform.LINKEDIN
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
            }
        } catch (error: unknown) {
            this.logger.error('Error in connectLinkedinAccount controller', {
                operation: 'connect_linkedin_account',
                entity: 'Account',
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    code: error instanceof BaseAppError ? error.code : undefined,
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            const errorParams = this.oauthErrorHandler.handleOAuthError(error, SocilaMediaPlatform.LINKEDIN)
            res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
        }
    }

    async connectFacebookAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { code, state, error } = req.query
            this.logger.info('Processing Facebook OAuth callback', {
                operation: 'connect_facebook_account',
                entity: 'Account',
                hasError: !!error,
                errorCode: error ? String(error) : undefined,
            })

            // Handle OAuth authorization errors first
            if (error) {
                const errorParams = this.oauthErrorHandler.handleOAuthError(
                    null,
                    SocilaMediaPlatform.FACEBOOK,
                    req.query as Record<string, any>,
                    state as string
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            let stateData: OAuthStatePayload
            try {
                stateData = this.resolveOAuthState(state, SocilaMediaPlatform.FACEBOOK)
            } catch {
                this.logger.warn('Invalid state parameter in callback', {
                    operation: 'connect_facebook_account',
                    entity: 'Account',
                    state,
                })
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_state',
                        description: 'Invalid state parameter',
                        userFriendlyMessage: 'Invalid state parameter in OAuth callback',
                        urlParams: 'error=invalid_state&reason=Invalid%20state%20parameter',
                    },
                    SocilaMediaPlatform.FACEBOOK
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            const { userId, reconnect: isReconnect, platform } = stateData

            if (!code || typeof code !== 'string') {
                this.logger.warn('Missing required parameters', {
                    operation: 'connect_facebook_account',
                    entity: 'Account',
                    hasCode: !!code,
                })
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_request',
                        description: 'Missing required parameters',
                        userFriendlyMessage: 'Missing required parameters for Facebook connection',
                        urlParams: 'error=invalid_request&reason=Missing%20required%20parameters',
                    },
                    SocilaMediaPlatform.FACEBOOK
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            try {
				const result = await this.socialMediaConnector.connectFacebookAccount(userId, code)


                if (result.success) {
                    this.logger.info('Successfully connected account', {
                        operation: 'connect_facebook_account',
                        entity: 'Account',
                        userId,
                        platform,
                    })
                    this.redirectWithParams(res, {
                        status: 'success',
                        message: 'Account connected successfully',
                    })
                } else {
                    this.logger.warn('Failed to connect account', {
                        operation: 'connect_facebook_account',
                        entity: 'Account',
                        userId,
                        platform,
                    })
                    this.redirectWithParams(res, {
                        status: 'error',
                        message: 'Failed to connect account',
                        platform: platform,
                    })
                }
            } catch (error) {
                const errorParams = this.oauthErrorHandler.handleOAuthError(error, SocilaMediaPlatform.FACEBOOK)
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
            }
        } catch (error) {
            this.logger.error('Error in connectFacebookAccount controller', {
                operation: 'connect_facebook_account',
                entity: 'Account',
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            const errorParams = this.oauthErrorHandler.handleOAuthError(error, SocilaMediaPlatform.FACEBOOK)
            res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
        }
    }

    async connectThreadsAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { code, state, error } = req.query

            this.logger.info('Processing Threads OAuth callback', {
                operation: 'connect_threads_account',
                entity: 'Account',
                hasError: !!error,
                errorCode: error ? String(error) : undefined,
            })

            // Handle OAuth authorization errors first
            if (error) {
                const errorParams = this.oauthErrorHandler.handleOAuthError(
                    null,
                    SocilaMediaPlatform.FACEBOOK, // Threads uses Facebook OAuth
                    req.query as Record<string, any>,
                    state as string
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            if (!code || !state) {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_request',
                        description: 'Missing required parameters',
                        userFriendlyMessage: 'Missing required parameters for Threads connection',
                        urlParams: 'error=invalid_request&reason=Missing%20required%20parameters',
                    },
                    SocilaMediaPlatform.FACEBOOK
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            let stateData: OAuthStatePayload
            try {
                stateData = this.resolveOAuthState(state, SocilaMediaPlatform.THREADS)
            } catch {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_state',
                        description: 'Invalid state parameter',
                        userFriendlyMessage: 'Invalid state parameter for Threads connection',
                        urlParams: 'error=invalid_state&reason=Invalid%20state%20parameter',
                    },
                    SocilaMediaPlatform.FACEBOOK // Threads uses Facebook OAuth
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            const result = await this.socialMediaConnector.connectThreadsAccount(stateData.userId, code as string)

            if (result.success) {
                this.logger.info('Successfully connected Threads account', {
                    operation: 'connect_threads_account',
                    entity: 'Account',
                    userId: stateData.userId,
                })
                this.redirectWithParams(res, {
                    status: 'success',
                    message: 'Account connected successfully',
                })
            }
        } catch (error) {
            const errorParams = this.oauthErrorHandler.handleOAuthError(
                error,
                SocilaMediaPlatform.FACEBOOK // Threads uses Facebook OAuth
            )
            res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
        }
    }

    async connectTikTokAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { code, state, error } = req.query

            // Handle OAuth authorization errors first
            if (error) {
                const errorParams = this.oauthErrorHandler.handleOAuthError(
                    null,
                    SocilaMediaPlatform.TIKTOK,
                    req.query as Record<string, any>,
                    state as string
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            if (!code || !state) {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_request',
                        description: 'Missing required parameters',
                        userFriendlyMessage: 'Missing required parameters for TikTok connection',
                        urlParams: 'error=invalid_request&reason=Missing%20required%20parameters',
                    },
                    SocilaMediaPlatform.TIKTOK
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            let stateData: OAuthStatePayload
            try {
                stateData = this.resolveOAuthState(state, SocilaMediaPlatform.TIKTOK)
            } catch {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_state',
                        description: 'Invalid state parameter',
                        userFriendlyMessage: 'Invalid state parameter for TikTok connection',
                        urlParams: 'error=invalid_state&reason=Invalid%20state%20parameter',
                    },
                    SocilaMediaPlatform.TIKTOK
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            const result = await this.socialMediaConnector.connectTikTokAccount(stateData.userId, code as string)

            if (result.success) {
                this.logger.info(`TikTok Accoutn for ${stateData.userId} added successfully!`)
                this.redirectWithParams(res, {
                    status: 'success',
                    message: 'Account connected successfully',
                })
            }
        } catch (error) {
            const errorParams = this.oauthErrorHandler.handleOAuthError(error, SocilaMediaPlatform.TIKTOK)
            res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
        }
    }

    async connectYouTubeAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { code, state, error } = req.query

            // Handle OAuth authorization errors first
            if (error) {
                const errorParams = this.oauthErrorHandler.handleOAuthError(
                    null,
                    SocilaMediaPlatform.GOOGLE, // YouTube uses Google OAuth
                    req.query as Record<string, any>,
                    state as string
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            if (!code || !state) {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_request',
                        description: 'Missing required parameters',
                        userFriendlyMessage: 'Missing required parameters for YouTube connection',
                        urlParams: 'error=invalid_request&reason=Missing%20required%20parameters',
                    },
                    SocilaMediaPlatform.GOOGLE
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            let stateData: OAuthStatePayload
            try {
                stateData = this.resolveOAuthState(state, SocilaMediaPlatform.YOUTUBE)
            } catch {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_state',
                        description: 'Invalid state parameter',
                        userFriendlyMessage: 'Invalid state parameter for YouTube connection',
                        urlParams: 'error=invalid_state&reason=Invalid%20state%20parameter',
                    },
                    SocilaMediaPlatform.GOOGLE
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            const result = await this.socialMediaConnector.connectYouTubeAccount(stateData.userId, code as string)

            if (result.success) {
                this.logger.info(`YouTube Account for ${stateData.userId} added successfully!`)
                this.redirectWithParams(res, {
                    status: 'success',
                    message: 'Account connected successfully',
                })
            }
        } catch (error: unknown) {
            const errorParams = this.oauthErrorHandler.handleOAuthError(
                error,
                SocilaMediaPlatform.GOOGLE // YouTube uses Google OAuth
            )
            res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
        }
    }

    async connectBlueskyAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id

            if (!userId) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const { identifier, appPassword } = req.body as {
                identifier?: string
                appPassword?: string
            }

            if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
                throw new RequestValidationError('Bluesky identifier is required')
            }

            if (!appPassword || typeof appPassword !== 'string' || !appPassword.trim()) {
                throw new RequestValidationError('Bluesky app password is required')
            }

            this.logger.info('Attempting to connect Bluesky account', {
                operation: 'connect_bluesky_account',
                entity: 'Account',
                userId,
            })

            const result = await this.socialMediaConnector.connectBlueskyAccount(
                userId,
                identifier.trim(),
                appPassword.trim()
            )

            res.json({
                success: result.success,
                message: result.success ? 'Account connected successfully' : 'Failed to connect account',
            })
        } catch (error) {
            next(error)
        }
    }

    async connectXAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { code, state, error } = req.query

            // Handle OAuth authorization errors first
            if (error) {
                const errorParams = this.oauthErrorHandler.handleOAuthError(
                    null,
                    SocilaMediaPlatform.X,
                    req.query as Record<string, any>,
                    state as string
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            if (!code || !state) {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_request',
                        description: 'Missing required parameters',
                        userFriendlyMessage: 'Missing required parameters for X (Twitter) connection',
                        urlParams: 'error=invalid_request&reason=Missing%20required%20parameters',
                    },
                    SocilaMediaPlatform.X
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            let stateData: OAuthStatePayload
            try {
                stateData = this.resolveOAuthState(state, SocilaMediaPlatform.X)
            } catch {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_state',
                        description: 'Invalid state parameter',
                        userFriendlyMessage: 'Invalid state parameter for X (Twitter) connection',
                        urlParams: 'error=invalid_state&reason=Invalid%20state%20parameter',
                    },
                    SocilaMediaPlatform.X
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            if (!stateData.codeVerifier) {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_state',
                        description: 'Missing verifier in OAuth state parameter',
                        userFriendlyMessage: 'Invalid session data. Please try connecting your account again.',
                        urlParams: 'error=invalid_state&reason=Missing%20code%20verifier',
                    },
                    SocilaMediaPlatform.X
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            const result = await this.socialMediaConnector.connectXAccount(
                stateData.userId,
                code as string,
                stateData.codeVerifier as string
            )

            if (result.success) {
                this.logger.info(`X Account for ${stateData.userId} added successfully!`)
                this.redirectWithParams(res, {
                    status: 'success',
                    message: 'Account connected successfully',
                })
            }
        } catch (error: unknown) {
            const errorParams = this.oauthErrorHandler.handleOAuthError(error, SocilaMediaPlatform.X)
            res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
        }
    }

    async connectPinterestAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { code, state, error } = req.query

            if (error) {
                const errorParams = this.oauthErrorHandler.handleOAuthError(
                    null,
                    SocilaMediaPlatform.PINTEREST,
                    req.query as Record<string, any>,
                    state as string
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            if (!code || !state) {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_request',
                        description: 'Missing required parameters',
                        userFriendlyMessage: 'Missing required parameters for Pinterest connection',
                        urlParams: 'error=invalid_request&reason=Missing%20required%20parameters',
                    },
                    SocilaMediaPlatform.PINTEREST
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            let stateData: OAuthStatePayload
			
            try {
                stateData = this.resolveOAuthState(state, SocilaMediaPlatform.PINTEREST)
            } catch {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_state',
                        description: 'Invalid state parameter',
                        userFriendlyMessage: 'Invalid state parameter for Pinterest connection',
                        urlParams: 'error=invalid_state&reason=Invalid%20state%20parameter',
                    },
                    SocilaMediaPlatform.PINTEREST
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            const result = await this.socialMediaConnector.connectPinterestAccount(stateData.userId, code as string)

            if (result.success) {
                this.logger.info(`Pinterest Account for ${stateData.userId} added successfully!`)
                this.redirectWithParams(res, {
                    status: 'success',
                    message: 'Account connected successfully',
                })
            }
        } catch (error: unknown) {
            const errorParams = this.oauthErrorHandler.handleOAuthError(error, SocilaMediaPlatform.PINTEREST)
            res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
        }
    }

    async connectInstagramAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { code, state, error } = req.query

            // Handle OAuth authorization errors first
            if (error) {
                const errorParams = this.oauthErrorHandler.handleOAuthError(
                    null,
                    SocilaMediaPlatform.INSTAGRAM,
                    req.query as Record<string, any>,
                    state as string
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            if (!code || !state) {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_request',
                        description: 'Missing required parameters',
                        userFriendlyMessage: 'Missing required parameters for Instagram connection',
                        urlParams: 'error=invalid_request&reason=Missing%20required%20parameters',
                    },
                    SocilaMediaPlatform.INSTAGRAM
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            let stateData: OAuthStatePayload
            try {
                stateData = this.resolveOAuthState(state, SocilaMediaPlatform.INSTAGRAM)
            } catch {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_state',
                        description: 'Invalid state parameter',
                        userFriendlyMessage: 'Invalid state parameter for Instagram connection',
                        urlParams: 'error=invalid_state&reason=Invalid%20state%20parameter',
                    },
                    SocilaMediaPlatform.INSTAGRAM
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            // Validate userId before proceeding
            if (!stateData.userId || stateData.userId.trim() === '') {
                const errorParams = this.oauthErrorHandler.formatErrorForRedirect(
                    {
                        errorCode: 'invalid_state',
                        description: 'Invalid state parameter',
                        userFriendlyMessage: 'Invalid state parameter for Instagram connection',
                        urlParams: 'error=invalid_state&reason=Invalid%20state%20parameter',
                    },
                    SocilaMediaPlatform.INSTAGRAM
                )
                res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
                return
            }

            const result = await this.socialMediaConnector.connectInstagramAccount(stateData.userId, code as string)

            if (result.success) {
                this.logger.info('Successfully connected Instagram account', {
                    operation: 'connect_instagram_account',
                    entity: 'Account',
                    userId: stateData.userId,
                })
                this.redirectWithParams(res, {
                    status: 'success',
                    message: 'Account connected successfully',
                })
            } else {
                this.logger.warn('Failed to connect Instagram account', {
                    operation: 'connect_instagram_account',
                    entity: 'Account',
                    userId: stateData.userId,
                })
                this.redirectWithParams(res, {
                    status: 'error',
                    message: 'Failed to connect account',
                })
            }
        } catch (error) {
            const errorParams = this.oauthErrorHandler.handleOAuthError(error, SocilaMediaPlatform.INSTAGRAM)
            res.redirect(`${this.FRONTEND_URL}/accounts?${errorParams}`)
        }
    }

    async createOAuthState(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                throw new RequestValidationError('User not authenticated', ErrorCode.UNAUTHORIZED)
            }

            const payload = oauthStateRequestSchema.parse(req.body)
            const stateToken = this.oauthStateService.issueState({
                userId: req.user.id,
                platform: payload.platform,
                reconnect: payload.reconnect,
                codeVerifier: payload.codeVerifier,
                metadata: payload.metadata,
            })

            res.status(201).json({ state: stateToken })
        } catch (error) {
            next(error)
        }
    }

    async getAllAccounts(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                this.logger.warn('Unauthorized attempt to get accounts', {
                    operation: 'get_all_accounts',
                    entity: 'Account',
                })
                throw new RequestValidationError('User not authenticated', ErrorCode.UNAUTHORIZED)
            }

            const accounts = await this.accountsInteractor.getAllAccounts(req.user.id)
            res.status(200).json({ accounts })
        } catch (error) {
            next(error)
        }
    }

    async deleteAccount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                this.logger.warn('Unauthorized attempt to delete account', {
                    operation: 'delete_account',
                    entity: 'Account',
                })
                throw new RequestValidationError('User not authenticated', ErrorCode.UNAUTHORIZED)
            }

            const { accountId } = req.params

            if (!accountId) {
                throw new RequestValidationError('Account ID is required', ErrorCode.BAD_REQUEST)
            }

            const result = await this.accountsInteractor.deleteAccount(req.user.id, accountId)
            res.status(200).json({ success: result.success, message: 'Account deleted successfully' })
        } catch (error) {
            if (isAxiosError(error)) {
                handleAxiosErrors(error, this.logger)
            }
            next(error)
        }
    }

    async getPinterestBoards(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                this.logger.warn('Unauthorized attempt to get Pinterest boards', {
                    operation: 'get_pinterest_boards',
                    entity: 'PinterestBoard',
                })
                throw new RequestValidationError('User not authenticated', ErrorCode.UNAUTHORIZED)
            }

            const { socialAccountId } = req.params

            if (!socialAccountId) {
                throw new RequestValidationError('Social account ID is required', ErrorCode.BAD_REQUEST)
            }

            this.logger.info('Getting Pinterest boards', {
                operation: 'get_pinterest_boards',
                entity: 'PinterestBoard',
                userId: req.user.id,
                socialAccountId,
            })

            const boards = await this.accountsInteractor.getPinterestBoards(req.user.id, socialAccountId)

            res.status(200).json({
                success: true,
                boards,
                count: boards.length,
            })
        } catch (error) {
            this.logger.error('Failed to get Pinterest boards', {
                operation: 'get_pinterest_boards',
                entity: 'PinterestBoard',
                userId: req.user?.id,
                socialAccountId: req.params.socialAccountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            next(error)
        }
    }
}
