import { CookieOptions, NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import axios from 'axios'
import { OAuth2Client } from 'google-auth-library'
import { ErrorCode } from '../shared/consts/error-codes.const'
import { BaseAppError } from '../shared/errors/base-error'
import { UserService } from '@/services/users-service'
import { ILogger } from '@/shared/infra/logger'
import { UserPlans } from '@/shared/consts/plans'
import { getJwtSecret } from '@/shared/utils/get-jwt-secret'
import { getEnvVar } from '@/shared/utils/get-env-var'

export class UserController {
    private interactor: UserService
    private logger: ILogger
    private readonly defaultCookieMaxAge = 7 * 24 * 60 * 60 * 1000 // 7 days
    private readonly jwtSecret: string
    private googleOAuthClient: OAuth2Client | null = null

    constructor(interactor: UserService, logger: ILogger) {
        this.interactor = interactor
        this.logger = logger
        this.jwtSecret = getJwtSecret()
    }

	// ### TODO: Create auth service
    private resolveRequestHost(req: Request): string {
        const forwardedHost = req.headers['x-forwarded-host']
        const rawHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost
        const host = (rawHost || req.hostname || '').split(',')[0]?.trim().toLowerCase() || ''
        return host.split(':')[0]
    }

    private resolveCookieDomain(host: string): string | undefined {
        const normalizedHost = host.toLowerCase()

        if (!normalizedHost || ['localhost', '127.0.0.1'].includes(normalizedHost)) {
            return undefined
        }

        const configuredDomains = (process.env.COOKIE_DOMAIN || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)

        for (const domain of configuredDomains) {
            const normalizedDomain = domain.startsWith('.') ? domain.slice(1).toLowerCase() : domain.toLowerCase()
            if (
                normalizedHost === normalizedDomain ||
                normalizedHost.endsWith(`.${normalizedDomain}`) ||
                normalizedDomain.endsWith(`.${normalizedHost}`)
            ) {
                return domain.startsWith('.') ? domain : `.${normalizedDomain}`
            }
        }

        const parts = normalizedHost.split('.')
        if (parts.length >= 2) {
            return `.${parts.slice(-2).join('.')}`
        }

        return undefined
    }

    private buildCookieOptions(req: Request, maxAge = this.defaultCookieMaxAge): CookieOptions {
        const isProduction = process.env.NODE_ENV === 'production'
        const forwardedProto = req.headers['x-forwarded-proto']?.toString().split(',')[0]?.trim()
        const host = this.resolveRequestHost(req)
        const isSecureRequest = req.secure || forwardedProto === 'https'
        const isLocalDevHost = ['localhost', '127.0.0.1'].includes(host)
        const isNgrokHost = host.endsWith('.ngrok-free.app')
        const frontendUrl = process.env.FRONTEND_URL?.split(',')[0]?.trim()
        let frontendHost = ''

        if (frontendUrl) {
            try {
                frontendHost = new URL(frontendUrl).hostname.toLowerCase()
            } catch {
                // ignore parsing errors, fallback to defaults
            }
        }

        const isCrossSite =
            Boolean(frontendHost) &&
            frontendHost !== host &&
            !host.endsWith(`.${frontendHost}`) &&
            !frontendHost.endsWith(`.${host}`)
        const forceSecure =
            process.env.COOKIE_FORCE_SECURE === 'true' ||
            process.env.FORCE_SECURE_COOKIES === 'true'
        const secure =
            forceSecure ||
            isSecureRequest ||
            isNgrokHost ||
            isCrossSite ||
            (isProduction && !isLocalDevHost)
        const sameSiteOverride = process.env.COOKIE_SAMESITE?.toLowerCase() as CookieOptions['sameSite'] | undefined
        let sameSite: CookieOptions['sameSite'] =
            sameSiteOverride ?? (isCrossSite ? 'none' : secure ? 'none' : 'lax')

        if (sameSite === 'none' && !secure) {
            sameSite = 'lax'
        }

        const options: CookieOptions = {
            httpOnly: true,
            secure,
            sameSite,
            path: '/',
            maxAge,
            expires: new Date(Date.now() + maxAge),
        }

        if (isCrossSite) {
            options.sameSite = 'none'
            options.secure = true
            options.partitioned = true
        }

        const cookieDomain = this.resolveCookieDomain(host)

        if (secure && cookieDomain) {
            options.domain = cookieDomain
        }

        return options
    }

    private getGoogleClient(): OAuth2Client {
        if (!this.googleOAuthClient) {
            const clientId = getEnvVar('GOOGLE_CLIENT_ID')
            this.googleOAuthClient = new OAuth2Client(clientId)
        }

        return this.googleOAuthClient
    }

    private getGoogleRedirectUri(): string {
        return `${getEnvVar('BACKEND_URL').replace(/\/$/, '')}/auth/callback/google`
    }

    private getFrontendBaseUrl(): string {
        return (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')
    }

    private extractMagicTokenFromState(state?: string | string[]): string | undefined {
        if (!state) return undefined
        const rawState = Array.isArray(state) ? state[0] : state

		this.logger.debug("HERE WE GET RAW STATE: ", {rawState})

        if (!rawState) return undefined

        let decoded = rawState
        try {
            decoded = decodeURIComponent(rawState)
        } catch (error) {
            this.logger.warn('Failed to decode Google OAuth state', {
                operation: 'extractMagicTokenFromState',
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              stack: error.stack,
                              code: (error as any).code,
                          }
                        : undefined,
            })
        }

        const trimmed = decoded.trim()

        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            const content = trimmed.slice(1, -1).trim()

            // Handle JSON like {"magicToken":"..."}
            if (content.startsWith('"') || content.includes(':')) {
                try {
                    const parsed = JSON.parse(trimmed)
                    if (typeof parsed.magicToken === 'string') {
                        return parsed.magicToken
                    }
                } catch (error) {
                    this.logger.warn('Failed to parse Google OAuth state JSON', {
                        operation: 'extractMagicTokenFromState',
                        state: trimmed,
                        error:
                            error instanceof Error
                                ? {
                                      name: error.name,
                                      stack: error.stack,
                                      code: (error as any).code,
                                  }
                                : undefined,
                    })
                }
            }

            // Handle `{magicToken=...}` style
            const [key, value] = content.split('=')
            if (key?.trim() === 'magicToken' && value) {
                return value.trim()
            }
        }

        if (trimmed.startsWith('magicToken=')) {
            return trimmed.split('=')[1]
        }

        return undefined
    }

    async signup(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { name, email, googleId, password, magicToken } = req.body

            if (!email) throw new BaseAppError('Email is required', ErrorCode.BAD_REQUEST, 400)

            if (!name) throw new BaseAppError('Name is required', ErrorCode.BAD_REQUEST, 400)

            if (!googleId && !password) {
                throw new BaseAppError('Either password or Google ID is required', ErrorCode.BAD_REQUEST, 400)
            }

            const user = await this.interactor.signup(email, googleId || '', name, password, magicToken)

            if (!user) throw new BaseAppError('Failed to create user', ErrorCode.UNKNOWN_ERROR, 500)

            res.status(201).json({
                message: 'User created successfully',
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                },
            })
        } catch (error) {
            if (error instanceof Error && error.message.includes('duplicate key value violates unique constraint')) {
                throw new BaseAppError('User already exists', ErrorCode.USER_ALREADY_EXISTS, 409)
            }
            next(error)
        }
    }

    async signin(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, password } = req.body

            if (!email) throw new BaseAppError('Email is required', ErrorCode.BAD_REQUEST, 400)

            if (!password) throw new BaseAppError('Password is required', ErrorCode.BAD_REQUEST, 400)

            const user = await this.interactor.signin(email, password)

            if (!user) throw new BaseAppError('Authentication failed', ErrorCode.INVALID_CREDENTIALS, 401)

            const token = jwt.sign(
                {
                    userId: user.id,
                    email: user.email,
                },
                this.jwtSecret,
                { expiresIn: '24h' }
            )

			this.logger.debug("TOKEN: ", {token})

            res.cookie('token', token, this.buildCookieOptions(req, this.defaultCookieMaxAge))

            res.status(200).json({
                message: 'Authentication successful',
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                },
                redirectUrl: `${process.env.FRONTEND_URL}/all-posts?userId=${user.id}`,
            })
        } catch (error) {
            next(error)
        }
    }

    async requestPasswordReset(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email } = req.body

            if (!email) {
                throw new BaseAppError('Email is required', ErrorCode.BAD_REQUEST, 400)
            }

            const result = await this.interactor.requestPasswordReset(email)

            res.status(200).json({
                message: 'If an account exists for this email, a reset link has been sent',
                ...(result.resetToken && { resetToken: result.resetToken }),
            })
        } catch (error) {
            next(error)
        }
    }

    async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { token, newPassword } = req.body

            if (!token) {
                throw new BaseAppError('Reset token is required', ErrorCode.BAD_REQUEST, 400)
            }

            if (!newPassword) {
                throw new BaseAppError('New password is required', ErrorCode.BAD_REQUEST, 400)
            }

            await this.interactor.resetPassword(token, newPassword)

            res.status(200).json({
                message: 'Password has been reset successfully',
            })
        } catch (error) {
            next(error)
        }
    }

	async googleAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const rawCode = req.query.code
            const code = Array.isArray(rawCode) ? rawCode[0] : rawCode

            if (!code || typeof code !== 'string') {
                throw new BaseAppError('Authorization code is required', ErrorCode.BAD_REQUEST, 400)
            }

            const googleClientId = getEnvVar('GOOGLE_CLIENT_ID')
            const googleClientSecret = getEnvVar('GOOGLE_CLIENT_SECRET')
            const redirectUri = this.getGoogleRedirectUri()

            const tokenPayload = new URLSearchParams({
                code,
                client_id: googleClientId,
                client_secret: googleClientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            })

            const { data } = await axios.post('https://oauth2.googleapis.com/token', tokenPayload.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            })

            this.logger.debug('Google token response received', {
                operation: 'googleAuth',
                hasIdToken: Boolean(data?.id_token),
                hasAccessToken: Boolean(data?.access_token),
                redirectUri,
            })

            if (!data || typeof data.id_token !== 'string') {
                throw new BaseAppError('Invalid credentials', ErrorCode.INVALID_CREDENTIALS, 401)
            }

            const ticket = await this.getGoogleClient().verifyIdToken({
                idToken: data.id_token,
                audience: googleClientId,
            })

            const payload = ticket.getPayload()

            if (!payload?.email || !payload.sub) {
                throw new BaseAppError('Unable to verify Google identity', ErrorCode.INVALID_CREDENTIALS, 401)
            }

            if (payload.email_verified === false) {
                throw new BaseAppError('Google email is not verified', ErrorCode.INVALID_CREDENTIALS, 401)
            }

            const userInfo = {
                email: payload.email,
                given_name: payload.given_name || payload.name || '',
                picture: payload.picture || '',
            }

            const rawState = req.query.state

			this.logger.debug("HERE WE GOT SMT: ", {rawState})
			
            const normalizedState =
                typeof rawState === 'string'
                    ? rawState
                    : Array.isArray(rawState)
                      ? rawState.filter((value): value is string => typeof value === 'string')
                      : undefined

            const magicToken = this.extractMagicTokenFromState(normalizedState)

			this.logger.debug("MAGIC TOKEN: ", {magicToken})
            const user = await this.interactor.findOrCreateUser(userInfo, magicToken)

            if (!user) {
                throw new BaseAppError('Failed to authenticate with Google', ErrorCode.UNKNOWN_ERROR, 500)
            }

            const sessionToken = jwt.sign({ userId: user.id }, this.jwtSecret, { expiresIn: '24h' })
			this.logger.info("TOKEN: ", {sessionToken})

			
            res.cookie('token', sessionToken, this.buildCookieOptions(req))

            const frontendBaseUrl = this.getFrontendBaseUrl()

            return res.redirect(`${frontendBaseUrl}/all-posts?userId=${user.id}`)
        } catch (err) {
            const frontendBaseUrl = this.getFrontendBaseUrl()

            this.logger.error('Google auth failed', {
                operation: 'googleAuth',
                error:
                    err instanceof Error
                        ? {
                              name: err.name,
                              message: err.message,
                              stack: err.stack,
                              ...(err instanceof BaseAppError ? { code: err.code } : {}),
                          }
                        : undefined,
                redirectTarget: frontendBaseUrl,
            })

            return res.redirect(
                `${frontendBaseUrl}/?googleAuth=failed${
                    err instanceof BaseAppError ? `&reason=${encodeURIComponent(err.code)}` : ''
                }`
            )
        }
    }
	// ### ENDTODO

    async getUser(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            let token = req.cookies?.token

            if (!token && req.headers.authorization?.startsWith('Bearer ')) {
                token = req.headers.authorization.split(' ')[1]
            }

            if (!token) throw new BaseAppError('No token provided', ErrorCode.UNAUTHORIZED, 401)

            let decoded: { userId?: string; id?: string }

            try {
                decoded = jwt.verify(token, this.jwtSecret) as { userId?: string; id?: string }
            } catch (err) {
                if (err instanceof jwt.TokenExpiredError) {
                    throw new BaseAppError('Token has expired', ErrorCode.TOKEN_EXPIRED, 401)
                }
                throw new BaseAppError('Invalid token', ErrorCode.UNAUTHORIZED, 401)
            }

            const userId = decoded.userId || decoded.id

            if (!userId) {
                throw new BaseAppError('Invalid token payload', ErrorCode.UNAUTHORIZED, 401)
            }

            const user = await this.interactor.findUserById(userId)

            if (!user) throw new BaseAppError('User not found', ErrorCode.NOT_FOUND, 404)

            res.status(200).json({
                user: user.user,
                quotaUsage: user.quotaUsage,
                plan: user.plan,
            })
        } catch (err) {
            next(err)
        }
    }

    async updateSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const { planName, planType } = req.body as { planName?: string; planType?: string }

            if (!planName) {
                throw new BaseAppError('planName is required', ErrorCode.BAD_REQUEST, 400)
            }

            const normalizedPlan = planName.toUpperCase() as UserPlans
            const normalizedPlanType = planType?.toLowerCase()

            if (planType && normalizedPlanType !== 'monthly' && normalizedPlanType !== 'yearly') {
                throw new BaseAppError('Unsupported plan type requested', ErrorCode.BAD_REQUEST, 400)
            }

            if (!(normalizedPlan in UserPlans)) {
                throw new BaseAppError('Unsupported plan requested', ErrorCode.BAD_REQUEST, 400)
            }

            await this.interactor.updateSubscription(
                req.user.id,
                normalizedPlan,
                normalizedPlanType as 'monthly' | 'yearly' | undefined
            )

            res.status(200).json({ success: true })
        } catch (error) {
            next(error)
        }
    }

    async cancelSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            await this.interactor.cancelSubscription(req.user.id)

            res.status(200).json({ success: true })
        } catch (error) {
            next(error)
        }
    }
}
