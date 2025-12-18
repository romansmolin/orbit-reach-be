import bcrypt from 'bcrypt'
import { randomBytes } from 'crypto'
import Stripe from 'stripe'
import { ErrorCode } from '../../shared/consts/error-codes.const'
import { v4 as uuidv4 } from 'uuid'
import { User } from '@/entities/tenant'
import { IUserRepository } from '@/repositories/user-repository'
import { UserSchema, transformUser } from '@/schemas/user.schemas'
import { BaseAppError } from '@/shared/errors/base-error'
import { IUserService, UserPlanResponse, UserPlanUsageSummary } from './user.service.interface'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { UserPlans } from '@/shared/consts/plans'
import { UserPlan } from '@/entities/user-plan'
import { IStripeService } from '@/services/stripe-service/stripe.service.interface'
import { IEmailService } from '@/services/email-service/email-service.interface'
import { resolvePlanFromProduct } from '@/services/stripe-service/stripe-plan-map'
import { getStripeConfigVar } from '@/shared/utils/get-stripe-config'

const PLAN_LIMITS: Record<
    UserPlans,
    { sentPostsLimit: number; scheduledPostsLimit: number; accountsLimit: number; aiRequestsLimit: number }
> = {
    [UserPlans.FREE]: { sentPostsLimit: 130, scheduledPostsLimit: 100, accountsLimit: 10, aiRequestsLimit: 30 },
    [UserPlans.STARTER]: { sentPostsLimit: 300, scheduledPostsLimit: 200, accountsLimit: 10, aiRequestsLimit: 0 },
    [UserPlans.PRO]: { sentPostsLimit: 500, scheduledPostsLimit: 400, accountsLimit: 30, aiRequestsLimit: 50 },
}

const PLAN_PRICE_ENV_KEYS: Partial<Record<UserPlans, { monthly: string; yearly: string }>> = {
    [UserPlans.STARTER]: {
        monthly: 'STRIPE_PRICE_STARTER_MONTHLY',
        yearly: 'STRIPE_PRICE_STARTER_YEARLY',
    },
    [UserPlans.PRO]: {
        monthly: 'STRIPE_PRICE_PRO_MONTHLY',
        yearly: 'STRIPE_PRICE_PRO_YEARLY',
    },
}

export class UserService implements IUserService {
    private repository: IUserRepository
    private stripeService: IStripeService
    private logger: ILogger
    private readonly SALT_ROUNDS = 10
    private emailService?: IEmailService

    constructor(
        repository: IUserRepository,
        stripeService: IStripeService,
        logger: ILogger,
        emailService?: IEmailService
    ) {
        this.repository = repository
        this.stripeService = stripeService
        this.logger = logger
        this.emailService = emailService
    }

	// ### TODO: Creae separate auth servie ###
	async signup(
        email: string,
        googleId: string,
        name: string,
        passwordHash?: string,
        magicToken?: string
    ): Promise<UserSchema | null> {
        try {
            const magicLink = await this.validateMagicToken(magicToken)
            let hashedPassword: string
            let isGoogleAuth = false

            if (passwordHash) {
                hashedPassword = await bcrypt.hash(passwordHash, this.SALT_ROUNDS)
            } else {
                hashedPassword = await bcrypt.hash(Math.random().toString(36), this.SALT_ROUNDS)
                isGoogleAuth = true
            }

            const user = new User(uuidv4(), name, email, isGoogleAuth, hashedPassword, '', null, new Date(), 10, 130, 100, 30)

            const savedUser = await this.repository.save(user)

            if (magicLink) {
                try {
                    await this.repository.redeemMagicLink({ magicLinkId: magicLink.magicLinkId, userId: savedUser.id })
                    await this.applyStarterPromo(savedUser.id, magicLink.promoDurationDays)
                } catch (error) {
                    this.logger.error('Failed to apply starter promo during signup', {
                        operation: 'signup',
                        userId: savedUser.id,
                    })
                    await this.applyFreePlan(savedUser.id)
                    throw error
                }
            } else {
                await this.applyFreePlan(savedUser.id)
            }

            return transformUser(savedUser)
        } catch (error) {
            if (error instanceof BaseAppError || error instanceof Error) throw error
            throw new BaseAppError('Failed to create user', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async signin(email: string, password: string): Promise<UserSchema | null> {
        try {
            const user = await this.repository.findByEmail(email)

            if (!user) throw new BaseAppError('User not found', ErrorCode.NOT_FOUND, 404)

            const isPasswordValid = await bcrypt.compare(password, user.password)

            if (!isPasswordValid)
                throw new BaseAppError('Invalid email or password', ErrorCode.INVALID_CREDENTIALS, 401)

            return transformUser(user)
        } catch (error) {
            if (error instanceof BaseAppError || error instanceof Error) {
                throw error
            }
            throw new BaseAppError('Failed to sign in', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async requestPasswordReset(email: string): Promise<{ success: true; resetToken?: string }> {
        const normalizedEmail = email.trim().toLowerCase()

        const genericResponse = { success: true as const }

        if (!normalizedEmail) {
            throw new BaseAppError('Email is required', ErrorCode.BAD_REQUEST, 400)
        }

        const user = await this.repository.findByEmail(normalizedEmail)

        if (!user) {
            this.logger.warn('Password reset requested for non-existent email', {
                operation: 'requestPasswordReset',
                email: normalizedEmail,
            })
            return genericResponse
        }

        const tokenId = uuidv4()
        const tokenSecret = randomBytes(32).toString('hex')
        const tokenHash = await bcrypt.hash(tokenSecret, this.SALT_ROUNDS)
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

        await this.repository.createPasswordResetToken({
            userId: user.id,
            tokenId,
            tokenHash,
            expiresAt,
        })

        const fullToken = `${tokenId}.${tokenSecret}`
        const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '') || 'http://localhost:3000'
        const resetLink = `${frontendUrl}/reset-password?token=${encodeURIComponent(fullToken)}`
        const tokenReference = tokenId

        if (this.emailService) {
            this.logger.info('Sending password reset email', {
                operation: 'requestPasswordReset',
                userId: user.id,
                email: user.email,
                tokenReference,
            })

            await this.emailService.sendPasswordResetEmail({
                to: user.email,
                name: user.name,
                resetLink,
                token: fullToken,
            })

            this.logger.info('Password reset email dispatched', {
                operation: 'requestPasswordReset',
                userId: user.id,
                email: user.email,
                tokenReference,
            })
        } else {
            this.logger.warn('Email service not configured, skipping reset email', {
                operation: 'requestPasswordReset',
                userId: user.id,
            })
        }

        this.logger.info('Password reset token generated', {
            operation: 'requestPasswordReset',
            userId: user.id,
            expiresAt,
        })

        return {
            success: true,
            ...(process.env.NODE_ENV !== 'production' ? { resetToken: fullToken, resetLink } : {}),
        }
    }

    async resetPassword(resetToken: string, newPassword: string): Promise<void> {
        if (!resetToken) {
            throw new BaseAppError('Reset token is required', ErrorCode.BAD_REQUEST, 400)
        }

        if (!newPassword || newPassword.length < 8) {
            throw new BaseAppError('Password must be at least 8 characters long', ErrorCode.BAD_REQUEST, 400)
        }

        const [tokenId, tokenSecret] = resetToken.split('.')

        if (!tokenId || !tokenSecret) {
            throw new BaseAppError('Invalid password reset token', ErrorCode.UNAUTHORIZED, 401)
        }

        const tokenRecord = await this.repository.findPasswordResetToken(tokenId)

        if (!tokenRecord) {
            throw new BaseAppError('Invalid or expired password reset token', ErrorCode.UNAUTHORIZED, 401)
        }

        if (tokenRecord.usedAt) {
            throw new BaseAppError('Password reset token has already been used', ErrorCode.UNAUTHORIZED, 401)
        }

        if (tokenRecord.expiresAt.getTime() < Date.now()) {
            throw new BaseAppError('Password reset token has expired', ErrorCode.UNAUTHORIZED, 401)
        }

        const isValid = await bcrypt.compare(tokenSecret, tokenRecord.tokenHash)

        if (!isValid) {
            throw new BaseAppError('Invalid password reset token', ErrorCode.UNAUTHORIZED, 401)
        }

        const hashedPassword = await bcrypt.hash(newPassword, this.SALT_ROUNDS)

        await this.repository.updateUserPassword(tokenRecord.tenantId, hashedPassword)
        await this.repository.markPasswordResetTokenUsed(tokenId)

        this.logger.info('Password reset successfully', {
            operation: 'resetPassword',
            userId: tokenRecord.tenantId,
        })
    }
	// ### TODOEND ###



    private calculatePlanPeriod(billingCycle: 'monthly' | 'yearly' = 'monthly'): { startDate: Date; endDate: Date } {
        const startDate = new Date()
        startDate.setHours(0, 0, 0, 0)

        const endDate = this.calculatePeriodEnd(startDate, billingCycle)

        return { startDate, endDate }
    }

    private calculatePeriodEnd(startDate: Date, billingCycle: 'monthly' | 'yearly'): Date {
        const endDate = new Date(startDate)
        if (billingCycle === 'yearly') {
            endDate.setFullYear(endDate.getFullYear() + 1)
        } else {
            endDate.setMonth(endDate.getMonth() + 1)
        }
        endDate.setMilliseconds(endDate.getMilliseconds() - 1)
        return endDate
    }

    private calculateCustomPeriodFromDays(days: number): { startDate: Date; endDate: Date } {
        const safeDays = Math.max(1, days)
        const startDate = new Date()
        startDate.setHours(0, 0, 0, 0)

        const endDate = new Date(startDate)
        endDate.setDate(endDate.getDate() + safeDays)
        endDate.setMilliseconds(endDate.getMilliseconds() - 1)

        return { startDate, endDate }
    }

    private resolvePlanPeriod(plan: UserPlan): { startDate: Date; endDate: Date } {
        const startDate = new Date(plan.startDate)
        const rawEndDate = plan.endDate ?? plan.currentPeriodEnd ?? this.calculatePeriodEnd(startDate, plan.planType)
        const endDate = new Date(rawEndDate)

        return { startDate, endDate }
    }

    private async getActivePlanPeriod(userId: string): Promise<{ startDate: Date; endDate: Date }> {
        const plan = await this.repository.findUserPlanByUserId(userId)
        return this.resolvePlanPeriod(plan)
    }

    private getCurrentBillingPeriod(): { startDate: Date; endDate: Date } {
        const startDate = new Date()
        startDate.setDate(1)
        startDate.setHours(0, 0, 0, 0)

        const endDate = new Date(startDate)
        endDate.setMonth(endDate.getMonth() + 1)
        endDate.setDate(0)
        endDate.setHours(23, 59, 59, 999)

        return { startDate, endDate }
    }

	private getPlanLimits(
        planName: UserPlans
    ): { sentPostsLimit: number; scheduledPostsLimit: number; accountsLimit: number; aiRequestsLimit: number } {
        const limits = PLAN_LIMITS[planName]

        if (!limits) {
            throw new BaseAppError(`Unsupported plan configuration: ${planName}`, ErrorCode.BAD_REQUEST, 400)
        }

        return limits
    }

    private getUsageCountersForPlan(planName: UserPlans): Array<'sent' | 'scheduled' | 'accounts' | 'ai'> {
        const counters: Array<'sent' | 'scheduled' | 'accounts' | 'ai'> = ['sent', 'scheduled', 'accounts']

        if (planName === UserPlans.PRO) {
            counters.push('ai')
        }

        return counters
    }

    private async validateMagicToken(
        magicToken?: string
    ): Promise<{ magicLinkId: string; promoDurationDays: number } | null> {
        if (!magicToken) {
            return null
        }

        const normalizedToken = magicToken.trim()

        if (!normalizedToken) {
            return null
        }

        const [tokenId, tokenSecret] = normalizedToken.split('.')

        if (!tokenId || !tokenSecret) {
            throw new BaseAppError('Invalid magic link token', ErrorCode.BAD_REQUEST, 400)
        }

        const magicLink = await this.repository.findMagicLink(tokenId)

        if (!magicLink) {
            throw new BaseAppError('Magic link is invalid or expired', ErrorCode.BAD_REQUEST, 400)
        }

        if (magicLink.expiresAt.getTime() <= Date.now()) {
            throw new BaseAppError('Magic link has expired', ErrorCode.BAD_REQUEST, 400)
        }

        if (magicLink.redeemedCount >= magicLink.maxUses || magicLink.redeemedAt) {
            throw new BaseAppError('Magic link has already been used', ErrorCode.BAD_REQUEST, 400)
        }

        const isSecretValid = await bcrypt.compare(tokenSecret, magicLink.tokenHash)

        if (!isSecretValid) {
            throw new BaseAppError('Magic link is invalid', ErrorCode.BAD_REQUEST, 400)
        }

        if (magicLink.promoType !== 'STARTER_TRIAL') {
            throw new BaseAppError('Unsupported magic link promotion', ErrorCode.BAD_REQUEST, 400)
        }

        const promoDurationDays = magicLink.promoDurationDays > 0 ? magicLink.promoDurationDays : 30

        return {
            magicLinkId: magicLink.id,
            promoDurationDays,
        }
    }

    private async applyStarterPromo(userId: string, promoDurationDays: number): Promise<void> {
        const { startDate, endDate } = this.calculateCustomPeriodFromDays(promoDurationDays)
        const planLimits = this.getPlanLimits(UserPlans.STARTER)

        const plan = await this.repository.ensurePlan(userId, {
            name: UserPlans.STARTER,
            planType: 'monthly',
            sentPostsLimit: planLimits.sentPostsLimit,
            scheduledPostsLimit: planLimits.scheduledPostsLimit,
            accountsLimit: planLimits.accountsLimit,
            aiRequestsLimit: planLimits.aiRequestsLimit,
            platformsAllowed: Object.values(SocilaMediaPlatform),
            startDate,
            endDate,
            status: 'trialing',
            billingStatus: 'active',
            currentPeriodEnd: endDate,
        })

        await this.repository.resetUsageCountersForPlan({
            userId,
            planId: plan.id,
            usageTypes: ['sent', 'scheduled', 'accounts', 'ai'],
            periodStart: startDate,
            periodEnd: endDate,
            limits: planLimits,
            preserveUsageTypes: ['accounts'],
        })

        this.logger.info('Applied starter promo via magic link', {
            operation: 'applyStarterPromo',
            userId,
            planId: plan.id,
            promoDurationDays,
            endDate,
        })
    }

    private async applyFreePlan(userId: string): Promise<void> {
        const { startDate, endDate } = this.calculatePlanPeriod('monthly')
        const planLimits = this.getPlanLimits(UserPlans.FREE)

        const plan = await this.repository.ensurePlan(userId, {
            name: UserPlans.FREE,
            planType: 'monthly',
            sentPostsLimit: planLimits.sentPostsLimit,
            scheduledPostsLimit: planLimits.scheduledPostsLimit,
            accountsLimit: planLimits.accountsLimit,
            aiRequestsLimit: planLimits.aiRequestsLimit,
            platformsAllowed: Object.values(SocilaMediaPlatform),
            startDate,
            endDate,
            currentPeriodEnd: endDate,
        })

        await this.repository.resetUsageCountersForPlan({
            userId,
            planId: plan.id,
            usageTypes: ['sent', 'scheduled', 'accounts', 'ai'],
            periodStart: startDate,
            periodEnd: endDate,
            limits: planLimits,
            preserveUsageTypes: ['accounts'],
        })
    }

	// ### TODO: WE CAN ISOLATE IT IN ENTITY ###
    private mapPlanToResponse(plan: UserPlan): UserPlanResponse {
        const billingStatus = plan.billingStatus ?? 'active'
        const isPendingCancellation = billingStatus === 'active_until_period_end'
        const isCanceled = billingStatus === 'canceled'

        return {
            id: plan.id,
            planName: plan.planName,
            planType: plan.planType,
            sendPostsLimit: plan.sendPostsLimit,
            scheduledPostsLimit: plan.scheduledPostsLimit,
            platformAllowed: plan.platformAllowed,
            startDate: plan.startDate,
            endDate: plan.endDate,
            isActive: plan.isActive,
            status: plan.status,
            currentPeriodEnd: plan.currentPeriodEnd,
            accountsLimit: plan.accountsLimit,
            aiRequestsLimit: plan.aiRequestsLimit,
            subscriptionEndsAt: plan.currentPeriodEnd,
            isPendingCancellation,
            canReactivate: isCanceled,
            canUpdateSubscription: !isCanceled || plan.planName === UserPlans.FREE,
        }
    }
	// ### TODOEND ###


    private resolvePlanPriceId(planName: UserPlans, planType: 'monthly' | 'yearly'): string {
        const priceConfig = PLAN_PRICE_ENV_KEYS[planName]

        if (!priceConfig) {
            throw new BaseAppError(`Stripe price is not configured for plan ${planName}`, ErrorCode.BAD_REQUEST, 400)
        }

        const envKey = planType === 'monthly' ? priceConfig.monthly : priceConfig.yearly
        const priceId = envKey ? getStripeConfigVar(envKey) : undefined

        if (!priceId) {
            throw new BaseAppError(
                `Environment variable ${envKey} is not configured for plan ${planName}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        }

        return priceId
    }

    private applyPlanLimitFallbacks(quota: UserPlanUsageSummary, plan: UserPlanResponse): UserPlanUsageSummary {
        const limits = this.getPlanLimits(plan.planName)
        const clone: UserPlanUsageSummary = {
            sentPosts: { ...quota.sentPosts },
            scheduledPosts: { ...quota.scheduledPosts },
            connectedAccounts: { ...quota.connectedAccounts },
            aiRequests: { ...quota.aiRequests },
        }

        if (!clone.sentPosts.limit || clone.sentPosts.limit <= 0) {
            clone.sentPosts.limit = limits.sentPostsLimit
        }

        if (!clone.scheduledPosts.limit || clone.scheduledPosts.limit <= 0) {
            clone.scheduledPosts.limit = limits.scheduledPostsLimit
        }

        if (!clone.connectedAccounts.limit || clone.connectedAccounts.limit <= 0) {
            clone.connectedAccounts.limit = limits.accountsLimit
        }

        if (!clone.aiRequests.limit || clone.aiRequests.limit <= 0) {
            clone.aiRequests.limit = limits.aiRequestsLimit
        }

        return clone
    }

    async findUserByEmail(email: string): Promise<UserSchema | null> {
        try {
            const user = await this.repository.findByEmail(email)

            if (!user) throw new BaseAppError('User not found', ErrorCode.NOT_FOUND, 404)

            return transformUser(user)
        } catch (error) {
            if (error instanceof BaseAppError || error instanceof Error) {
                throw error
            }
            throw new BaseAppError('Failed to find user', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async findUserByStripeCustomerId(customerId: string): Promise<UserSchema | null> {
        try {
            const user = await this.repository.findByStripeCustomerId(customerId)

            if (!user) throw new BaseAppError('User not found', ErrorCode.NOT_FOUND, 404)

            return transformUser(user)
        } catch (error) {
            if (error instanceof BaseAppError || error instanceof Error) {
                throw error
            }
            throw new BaseAppError('Failed to find user', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async findOrCreateUser(user: any, magicToken?: string): Promise<UserSchema | null> {
        try {
            const { email, given_name, picture } = user

            if (!email || !given_name) throw new BaseAppError('Invalid user data provided', ErrorCode.BAD_REQUEST, 400)

            const userRes = await this.repository.findByEmail(email)

            if (!userRes) {
                const magicLink = await this.validateMagicToken(magicToken)
                const hashedPassword = await bcrypt.hash(Math.random().toString(36), this.SALT_ROUNDS)

                const newUser = new User(
                    uuidv4(),
                    given_name,
                    email,
                    true, // Google auth
                    hashedPassword,
                    picture || '',
                    null,
                    new Date(),
                    10, // defaultAccountLimit
                    130, // defaultSentPostsLimit
                    100, // defaultScheduledPostsLimit
                    30 // defaultAiRequestsLimit
                )

                const savedUser = await this.repository.save(newUser)

                if (magicLink) {
                    await this.repository.redeemMagicLink({ magicLinkId: magicLink.magicLinkId, userId: savedUser.id })
                    await this.applyStarterPromo(savedUser.id, magicLink.promoDurationDays)
                } else {
                    await this.applyFreePlan(savedUser.id)
                }

                return savedUser ? transformUser(savedUser) : null
            }

            return transformUser(userRes)
        } catch (error) {
            if (error instanceof BaseAppError || error instanceof Error) throw error
            throw new BaseAppError('Failed to find or create user', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async processExpiredPlans(): Promise<void> {
        const expiredPlans = await this.repository.findExpiredPlans()
		this.logger.info("expired plans: ", {expiredPlans})
		
        if (expiredPlans.length === 0) return

        for (const plan of expiredPlans) {
            try {
                await this.applyFreePlan(plan.tenantId)
                this.logger.info('Downgraded expired plan to free', {
                    operation: 'processExpiredPlans',
                    tenantId: plan.tenantId,
                    planId: plan.planId,
                    previousPlan: plan.planName,
                    billingStatus: plan.billingStatus,
                    endDate: plan.endDate,
                })
            } catch (error) {
                this.logger.error('Failed to downgrade expired plan', {
                    operation: 'processExpiredPlans',
                    tenantId: plan.tenantId,
                    planId: plan.planId,
                    previousPlan: plan.planName,
                    error: error instanceof Error ? { name: error.name } : undefined,
                })
            }
        }
    }

    async findUserById(id: string): Promise<{
        user: UserSchema
        plan: UserPlanResponse | null
        quotaUsage: UserPlanUsageSummary
        defaultLimits: {
            accountsLimit: number | null
            sentPostsLimit: number
            scheduledPostsLimit: number
            aiRequestsLimit: number
        }
    } | null> {
        try {
            this.logger.debug('USER ID: ', { id })

            const [userResult, planResult] = await Promise.allSettled([
                this.repository.findById(id),
                this.repository.findUserPlanByUserId(id),
            ] as const)

            if (userResult.status === 'rejected') {
                this.logger.debug('HEY THERE: ', { userResult })
                throw new BaseAppError(`Failed to fetch user data: ${userResult.reason}`, ErrorCode.UNKNOWN_ERROR, 500)
            }

            const user = userResult.value

            if (!user) return null

            let plan: UserPlan | null = null

            if (planResult.status === 'rejected') {
                this.logger.warn(`Failed to fetch user plan for user ${id}:`, planResult.reason)
            } else {
                plan = planResult.value
            }

            let quotaUsage: UserPlanUsageSummary = {
                sentPosts: { used: 0, limit: 0 },
                scheduledPosts: { used: 0, limit: 0 },
                connectedAccounts: { used: 0, limit: 0 },
                aiRequests: { used: 0, limit: 0 },
            }

            try {
                const { startDate, endDate } = plan
                    ? {
                          startDate: plan.startDate,
                          endDate: plan.endDate ?? this.getCurrentBillingPeriod().endDate,
                      }
                    : this.getCurrentBillingPeriod()

                quotaUsage = await this.repository.getCurrentUsageQuota(id, startDate, endDate)
            } catch (error) {
                const formattedError =
                    error instanceof Error ? { name: error.name, message: error.message } : { name: 'UnknownError' }
                this.logger.warn(`Failed to fetch quota usage for user ${id}:`, {
                    error: formattedError,
                })
            }

            const planResponse = plan ? this.mapPlanToResponse(plan) : null

            return {
                user: transformUser(user),
                plan: planResponse,
                quotaUsage: planResponse ? this.applyPlanLimitFallbacks(quotaUsage, planResponse) : quotaUsage,
                defaultLimits: {
                    accountsLimit: user.defaultAccountLimit,
                    sentPostsLimit: user.defaultSentPostsLimit,
                    scheduledPostsLimit: user.defaultScheduledPostsLimit,
                    aiRequestsLimit: user.defaultAiRequestsLimit,
                },
            }
        } catch (error) {
            if (error instanceof BaseAppError) throw error

            throw new BaseAppError('Failed to find user', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async updateCustomerPlan(
        userId: string,
        plan: {
            name: UserPlans
            planType: 'monthly' | 'yearly'
            startDate?: Date
            endDate?: Date
            stripeSubscriptionId?: string | null
            stripePriceId?: string | null
            subscriptionStatus?: string | null
            currentPeriodEnd?: Date | null
            stripeLookupKey?: string | null
            billingStatus?: string | null
            stripeCustomerId?: string | null
        }
    ): Promise<void> {
        try {
            const defaultPeriod = this.calculatePlanPeriod(plan.planType)
            const startDate = plan.startDate ?? defaultPeriod.startDate
            const endDate = plan.endDate ?? plan.currentPeriodEnd ?? defaultPeriod.endDate
            const planLimits = this.getPlanLimits(plan.name)
            const billingStatus = plan.billingStatus ?? 'active'

            const updatedPlan = await this.repository.ensurePlan(userId, {
                name: plan.name,
                planType: plan.planType,
                sentPostsLimit: planLimits.sentPostsLimit,
                scheduledPostsLimit: planLimits.scheduledPostsLimit,
                accountsLimit: planLimits.accountsLimit,
                aiRequestsLimit: planLimits.aiRequestsLimit,
                startDate,
                endDate,
                stripeSubscriptionId: plan.stripeSubscriptionId ?? null,
                stripePriceId: plan.stripePriceId ?? null,
                status: plan.subscriptionStatus ?? 'active',
                currentPeriodEnd: plan.currentPeriodEnd ?? endDate,
                stripeLookupKey: plan.stripeLookupKey ?? null,
                billingStatus,
            })

			// ### TODO: WE NEED TO MAKE JSON FIELD IN USER PLAN USAGE
            const countersToReset = this.getUsageCountersForPlan(plan.name)
            await this.repository.resetUsageCountersForPlan({
                userId,
                planId: updatedPlan.id,
                usageTypes: countersToReset,
                periodStart: startDate,
                periodEnd: endDate,
                limits: planLimits,
            })
			// ### ENDTODO

            await this.syncStripeCustomerId(userId, plan.stripeCustomerId ?? null)

            this.logger.info('Customer plan updated from Stripe', {
                userId,
                planName: plan.name,
                planType: plan.planType,
                stripeSubscriptionId: plan.stripeSubscriptionId ?? null,
            })
        } catch (error) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to update customer plan', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async getUsageQuota(userId: string, periodStart?: Date, periodEnd?: Date): Promise<UserPlanUsageSummary> {
        try {
            const { startDate, endDate } =
                periodStart && periodEnd
                    ? { startDate: periodStart, endDate: periodEnd }
                    : await this.getActivePlanPeriod(userId)
            return await this.repository.getCurrentUsageQuota(userId, startDate, endDate)
        } catch (error) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to fetch usage quota', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async incrementConnectedAccountsUsage(userId: string): Promise<void> {
        await this.adjustUsage(userId, 'accounts', 1)
    }

    async decrementConnectedAccountsUsage(userId: string): Promise<void> {
        await this.adjustUsage(userId, 'accounts', -1)
    }

    async incrementAiUsage(userId: string): Promise<void> {
        await this.adjustUsage(userId, 'ai', 1)
    }

    async applyAddonPurchase(
        userId: string,
        addon: {
            addonCode: string
            usageDeltas: {
                sentPosts?: number
                scheduledPosts?: number
                aiRequests?: number
            }
        }
    ): Promise<void> {
        const sentDelta = Math.max(0, addon.usageDeltas.sentPosts ?? 0)
        const scheduledDelta = Math.max(0, addon.usageDeltas.scheduledPosts ?? 0)
        const aiDelta = Math.max(0, addon.usageDeltas.aiRequests ?? 0)

        if (sentDelta === 0 && scheduledDelta === 0 && aiDelta === 0) {
            throw new BaseAppError('No add-on increments provided', ErrorCode.BAD_REQUEST, 400)
        }

        try {
            const plan = await this.repository.findUserPlanByUserId(userId)
            const { startDate, endDate } = this.resolvePlanPeriod(plan)

            await this.repository.incrementUsageLimits({
                userId,
                planId: plan.id,
                periodStart: startDate,
                periodEnd: endDate,
                deltas: {
                    sent: sentDelta,
                    scheduled: scheduledDelta,
                    ai: aiDelta,
                },
                baseLimits: {
                    sent: plan.sendPostsLimit,
                    scheduled: plan.scheduledPostsLimit,
                    ai: plan.aiRequestsLimit ?? 0,
                },
            })

            this.logger.info('Applied add-on purchase', {
                operation: 'applyAddonPurchase',
                userId,
                addonCode: addon.addonCode,
                deltas: { sentDelta, scheduledDelta, aiDelta },
            })
        } catch (error) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to apply add-on purchase', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    private async adjustUsage(userId: string, usageType: 'accounts' | 'ai', delta: number): Promise<void> {
        try {
            const { startDate, endDate } = await this.getActivePlanPeriod(userId)
            const quota = await this.repository.getCurrentUsageQuota(userId, startDate, endDate)

            const counters = usageType === 'accounts' ? quota.connectedAccounts : quota.aiRequests
            const currentUsage = counters.used
            const limit = counters.limit

            if (delta > 0 && currentUsage + delta > limit) {
                const message =
                    usageType === 'accounts'
                        ? 'Account limit reached for the current plan'
                        : 'AI request limit reached for the current plan'
                throw new BaseAppError(message, ErrorCode.PLAN_LIMIT_REACHED, 403)
            }

            await this.repository.updateUserPlanUsage(userId, usageType, delta, startDate, endDate)
        } catch (error) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to update usage counters', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    private async getStripeCustomerIdOrThrow(userId: string): Promise<string> {
        const customerId = await this.repository.getStripeCustomerId(userId)

        if (!customerId) {
            throw new BaseAppError('Stripe customer is not linked to this account', ErrorCode.BAD_REQUEST, 400)
        }

        return customerId
    }

    private async syncStripeCustomerId(userId: string, stripeCustomerId?: string | null): Promise<void> {
        if (!stripeCustomerId) {
            return
        }

        const existing = await this.repository.getStripeCustomerId(userId)

        if (existing === stripeCustomerId) {
            return
        }

        await this.repository.updateStripeCustomerId(userId, stripeCustomerId)
    }

    async getUserPlan(userId: string): Promise<UserPlan> {
        try {
            return await this.repository.findUserPlanByUserId(userId)
        } catch (error) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to fetch user plan', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async updateSubscription(userId: string, planName: UserPlans, planType?: 'monthly' | 'yearly'): Promise<void> {
        if (planName === UserPlans.FREE) {
            throw new BaseAppError('Free plan does not require a subscription update', ErrorCode.BAD_REQUEST, 400)
        }

        const currentPlan = await this.repository.findUserPlanByUserId(userId)

        const isPendingOrCanceled =
            currentPlan.billingStatus === 'active_until_period_end' || currentPlan.billingStatus === 'canceled'

        const targetPlanType = planType ?? currentPlan.planType ?? 'monthly'
        const isSamePlanAndCadence =
            currentPlan.planName === planName && (currentPlan.planType ?? 'monthly') === targetPlanType

        if (isSamePlanAndCadence && !isPendingOrCanceled) {
            throw new BaseAppError('Subscription is already on the requested plan', ErrorCode.BAD_REQUEST, 400)
        }
        const priceId = this.resolvePlanPriceId(planName, targetPlanType)

        const needsNewSubscription =
            !currentPlan.stripeSubscriptionId ||
            currentPlan.planName === UserPlans.FREE ||
            currentPlan.billingStatus === 'canceled' ||
            currentPlan.status === 'canceled'

        let updatedSubscription: Stripe.Subscription

        if (needsNewSubscription) {
            const stripeCustomerId = await this.getStripeCustomerIdOrThrow(userId)
            updatedSubscription = await this.stripeService.createSubscription(stripeCustomerId, priceId, {
                tenantId: userId,
            })
        } else {
            const existingSubscription = await this.stripeService.retrieveSubscription(currentPlan.stripeSubscriptionId!)

            if (existingSubscription.status === 'canceled') {
                const stripeCustomerId = await this.getStripeCustomerIdOrThrow(userId)
                updatedSubscription = await this.stripeService.createSubscription(stripeCustomerId, priceId, {
                    tenantId: userId,
                })
            } else {
                const subscriptionItem = existingSubscription.items?.data?.[0]

                if (!subscriptionItem?.id) {
                    throw new BaseAppError('Failed to resolve Stripe subscription item', ErrorCode.UNKNOWN_ERROR, 500)
                }

                updatedSubscription = await this.stripeService.updateSubscription({
                    subscriptionId: existingSubscription.id,
                    subscriptionItemId: subscriptionItem.id,
                    priceId,
                    cancelAtPeriodEnd: false,
                })
            }
        }

        await this.stripeService.setSubscriptionMetadata(updatedSubscription.id, {
            ...(updatedSubscription.metadata ?? {}),
            tenantId: userId,
        })

        const stripePrice = updatedSubscription.items.data[0]?.price
        const derivedPlanName =
            typeof stripePrice?.product === 'string' ? resolvePlanFromProduct(stripePrice.product) : undefined

        if (!derivedPlanName) {
            throw new BaseAppError('Unable to resolve plan from Stripe price', ErrorCode.UNKNOWN_ERROR, 500)
        }

        const planLimits = this.getPlanLimits(derivedPlanName)
        const { startDate, endDate } = this.extractSubscriptionWindow(updatedSubscription)
        const periodDates = this.getSubscriptionPeriodDates(updatedSubscription)

        const updatedPlan = await this.repository.ensurePlan(userId, {
            name: derivedPlanName,
            planType: targetPlanType,
            sentPostsLimit: planLimits.sentPostsLimit,
            scheduledPostsLimit: planLimits.scheduledPostsLimit,
            accountsLimit: planLimits.accountsLimit,
            aiRequestsLimit: planLimits.aiRequestsLimit,
            platformsAllowed: Object.values(SocilaMediaPlatform),
            startDate,
            endDate,
            stripeSubscriptionId: updatedSubscription.id,
            stripePriceId: stripePrice?.id ?? null,
            status: updatedSubscription.status ?? null,
            currentPeriodEnd: periodDates.endDate ?? endDate,
            stripeLookupKey: stripePrice?.lookup_key ?? null,
            billingStatus: 'active',
        })

        const countersToReset = this.getUsageCountersForPlan(derivedPlanName)
        await this.repository.resetUsageCountersForPlan({
            userId,
            planId: updatedPlan.id,
            usageTypes: countersToReset,
            periodStart: startDate,
            periodEnd: endDate,
            limits: planLimits,
            preserveUsageTypes: ['accounts'],
        })

        await this.syncStripeCustomerId(userId, this.getSubscriptionCustomerId(updatedSubscription))
    }

    async cancelSubscription(userId: string): Promise<void> {
        const currentPlan = await this.repository.findUserPlanByUserId(userId)

        if (currentPlan.planName === UserPlans.FREE) {
            throw new BaseAppError('No paid subscription found to cancel', ErrorCode.BAD_REQUEST, 400)
        }

        if (!currentPlan.stripeSubscriptionId) {
            throw new BaseAppError('No active Stripe subscription found', ErrorCode.BAD_REQUEST, 400)
        }

        if (currentPlan.billingStatus === 'active_until_period_end') {
            throw new BaseAppError('Subscription is already scheduled for cancellation', ErrorCode.BAD_REQUEST, 400)
        }

        const cancelledSubscription = await this.stripeService.scheduleSubscriptionCancellation(
            currentPlan.stripeSubscriptionId
        )

        await this.stripeService.setSubscriptionMetadata(cancelledSubscription.id, {
            ...(cancelledSubscription.metadata ?? {}),
            tenantId: userId,
        })

        const stripePrice = cancelledSubscription.items.data[0]?.price

        const periodDates = this.getSubscriptionPeriodDates(cancelledSubscription)
        const startDate = periodDates.startDate ?? new Date()
        const endDate = periodDates.endDate ?? startDate

        await this.repository.ensurePlan(userId, {
            name: currentPlan.planName,
            planType: currentPlan.planType,
            sentPostsLimit: currentPlan.sendPostsLimit,
            scheduledPostsLimit: currentPlan.scheduledPostsLimit,
            accountsLimit: currentPlan.accountsLimit ?? 0,
            aiRequestsLimit: currentPlan.aiRequestsLimit ?? 0,
            platformsAllowed: currentPlan.platformAllowed,
            startDate,
            endDate,
            stripeSubscriptionId: cancelledSubscription.id,
            stripePriceId: stripePrice?.id ?? currentPlan.stripePriceId ?? null,
            status: cancelledSubscription.status ?? null,
            currentPeriodEnd: periodDates.endDate ?? currentPlan.currentPeriodEnd ?? null,
            stripeLookupKey: stripePrice?.lookup_key ?? currentPlan.stripeLookupKey ?? null,
            billingStatus: 'active_until_period_end',
        })

        await this.syncStripeCustomerId(userId, this.getSubscriptionCustomerId(cancelledSubscription))
    }

    async handleSubscriptionRenewal(params: {
        tenantId: string
        planName: UserPlans
        planType: 'monthly' | 'yearly'
        stripeSubscriptionId?: string | null
        stripePriceId?: string | null
        stripeLookupKey?: string | null
        stripeCustomerId?: string | null
        periodStart: Date
        periodEnd: Date
    }): Promise<void> {
        try {
            const planLimits = this.getPlanLimits(params.planName)

            const renewedPlan = await this.repository.ensurePlan(params.tenantId, {
                name: params.planName,
                planType: params.planType,
                sentPostsLimit: planLimits.sentPostsLimit,
                scheduledPostsLimit: planLimits.scheduledPostsLimit,
                accountsLimit: planLimits.accountsLimit,
                aiRequestsLimit: planLimits.aiRequestsLimit,
                platformsAllowed: Object.values(SocilaMediaPlatform),
                startDate: params.periodStart,
                endDate: params.periodEnd,
                stripeSubscriptionId: params.stripeSubscriptionId ?? null,
                stripePriceId: params.stripePriceId ?? null,
                status: 'active',
                currentPeriodEnd: params.periodEnd,
                stripeLookupKey: params.stripeLookupKey ?? null,
                billingStatus: 'active',
            })

            const countersToReset = this.getUsageCountersForPlan(params.planName)

            await this.repository.resetUsageCountersForPlan({
                userId: params.tenantId,
                planId: renewedPlan.id,
                usageTypes: countersToReset,
                periodStart: params.periodStart,
                periodEnd: params.periodEnd,
                limits: planLimits,
                preserveUsageTypes: ['accounts'],
            })

            await this.syncStripeCustomerId(params.tenantId, params.stripeCustomerId ?? null)
        } catch (error) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to process subscription renewal', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async handleSubscriptionCancelled(stripeSubscriptionId: string, tenantId?: string): Promise<void> {
        let plan: UserPlan | null = null

        try {
            plan = await this.repository.findUserPlanBySubscriptionId(stripeSubscriptionId)
        } catch (error) {
            const formattedError =
                error instanceof Error ? { name: error.name, message: error.message } : { name: 'UnknownError' }

            this.logger.error('Failed to lookup plan by Stripe subscription', {
                stripeSubscriptionId,
                error: formattedError,
            })
        }

        if (!plan && tenantId) {
            try {
                const fallback = await this.repository.findUserPlanByUserId(tenantId)
                plan = fallback
            } catch (error) {
                const formattedError =
                    error instanceof Error ? { name: error.name, message: error.message } : { name: 'UnknownError' }

                this.logger.warn('Fallback lookup for tenant failed after subscription cancellation', {
                    stripeSubscriptionId,
                    tenantId,
                    error: formattedError,
                })
            }
        }

        if (!plan) {
            this.logger.warn('Received cancellation webhook for unknown subscription', {
                stripeSubscriptionId,
                tenantId,
            })
            return
        }

        const planLimits = this.getPlanLimits(UserPlans.FREE)
        const { startDate, endDate } = this.calculatePlanPeriod('monthly')

        await this.syncStripeCustomerId(plan.tenantId, tenantId ?? null)

        const downgradedPlan = await this.repository.ensurePlan(plan.tenantId, {
            name: UserPlans.FREE,
            planType: 'monthly',
            sentPostsLimit: planLimits.sentPostsLimit,
            scheduledPostsLimit: planLimits.scheduledPostsLimit,
            accountsLimit: planLimits.accountsLimit,
            aiRequestsLimit: planLimits.aiRequestsLimit,
            platformsAllowed: Object.values(SocilaMediaPlatform),
            startDate,
            endDate,
            stripeSubscriptionId: plan.stripeSubscriptionId ?? null,
            stripePriceId: plan.stripePriceId ?? null,
            status: 'canceled',
            currentPeriodEnd: endDate,
            stripeLookupKey: plan.stripeLookupKey ?? null,
            billingStatus: 'canceled',
        })

        const countersToReset = this.getUsageCountersForPlan(UserPlans.FREE)
        await this.repository.resetUsageCountersForPlan({
            userId: plan.tenantId,
            planId: downgradedPlan.id,
            usageTypes: countersToReset,
            periodStart: startDate,
            periodEnd: endDate,
            limits: planLimits,
            preserveUsageTypes: ['accounts'],
        })
    }

    private extractSubscriptionWindow(subscription: Stripe.Subscription): { startDate: Date; endDate: Date } {
        const periodDates = this.getSubscriptionPeriodDates(subscription)
        const startDate = periodDates.startDate ?? this.getCurrentBillingPeriod().startDate
        const endDate = periodDates.endDate ?? this.getCurrentBillingPeriod().endDate

        return { startDate, endDate }
    }

    private getSubscriptionPeriodDates(subscription: Stripe.Subscription): {
        startDate?: Date
        endDate?: Date
    } {
        const legacyFields = subscription as Stripe.Subscription & {
            current_period_start?: number | null
            current_period_end?: number | null
        }

        const startDate =
            typeof legacyFields.current_period_start === 'number'
                ? new Date(legacyFields.current_period_start * 1000)
                : undefined
        const endDate =
            typeof legacyFields.current_period_end === 'number'
                ? new Date(legacyFields.current_period_end * 1000)
                : undefined

        return { startDate, endDate }
    }

    private getSubscriptionCustomerId(subscription: Stripe.Subscription): string | null {
        const customer = subscription.customer

        if (!customer) {
            return null
        }

        if (typeof customer === 'string') {
            return customer
        }

        if ('id' in customer) {
            return customer.id
        }

        return null
    }
}
