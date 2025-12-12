import type { UserPlan } from '@/entities/user-plan'
import type { User } from '../../entities/tenant'
import { SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { UserPlans } from '@/shared/consts/plans'

export type MagicLinkPromoType = 'STARTER_TRIAL'

export interface MagicLinkRecord {
    id: string
    tokenId: string
    tokenHash: string
    expiresAt: Date
    promoType: MagicLinkPromoType
    promoDurationDays: number
    maxUses: number
    redeemedCount: number
    redeemedAt: Date | null
    redeemedByUserId: string | null
}

export interface IUserRepository {
    findByEmail(email: string): Promise<User | null>
    findByStripeCustomerId(customerId: string): Promise<User | null>
    findById(id: string): Promise<User | null>
    findUserPlanByUserId(userId: string): Promise<UserPlan>
    findUserPlanBySubscriptionId(subscriptionId: string): Promise<UserPlan | null>
    updateStripeCustomerId(userId: string, customerId: string): Promise<void>
    getStripeCustomerId(userId: string): Promise<string | null>

    ensurePlan(
        userId: string,
        plan: {
            name: UserPlans
            planType: 'monthly' | 'yearly'
            sentPostsLimit?: number
            scheduledPostsLimit?: number
            platformsAllowed?: SocilaMediaPlatform[]
            startDate: Date
            endDate: Date
            stripeSubscriptionId?: string | null
            stripePriceId?: string | null
            status?: string | null
            currentPeriodEnd?: Date | null
            stripeLookupKey?: string | null
            accountsLimit?: number | null
            aiRequestsLimit?: number | null
            billingStatus?: string | null
        }
    ): Promise<UserPlan>

    updateUserPlanUsage(
        userId: string,
        usageType: 'sent' | 'scheduled' | 'accounts' | 'ai',
        additionalCount: number,
        periodStart: Date,
        periodEnd: Date
    ): Promise<{ success: boolean; newUsageCount: number; limitCount: number }>
    resetUsageCountersForPlan(params: {
        userId: string
        planId: string
        usageTypes: Array<'sent' | 'scheduled' | 'accounts' | 'ai'>
        periodStart: Date
        periodEnd: Date
        limits: {
            sentPostsLimit: number
            scheduledPostsLimit: number
            accountsLimit: number
            aiRequestsLimit: number
        }
        preserveUsageTypes?: Array<'sent' | 'scheduled' | 'accounts' | 'ai'>
    }): Promise<void>
    incrementUsageLimits(params: {
        userId: string
        planId: string
        periodStart: Date
        periodEnd: Date
        deltas: { sent?: number; scheduled?: number; ai?: number }
        baseLimits: { sent: number; scheduled: number; ai: number }
    }): Promise<void>

    getCurrentUsageQuota(
        userId: string,
        periodStart: Date,
        periodEnd: Date
    ): Promise<{
        sentPosts: { used: number; limit: number }
        scheduledPosts: { used: number; limit: number }
        connectedAccounts: { used: number; limit: number }
        aiRequests: { used: number; limit: number }
    }>

    save(user: User): Promise<User>
    updateRefreshToken(userId: string, refreshToken: string | null): Promise<void>
    createPasswordResetToken(params: {
        userId: string
        tokenId: string
        tokenHash: string
        expiresAt: Date
    }): Promise<void>
    findPasswordResetToken(tokenId: string): Promise<
        | {
              id: string
              tenantId: string
              tokenHash: string
              expiresAt: Date
              usedAt: Date | null
          }
        | null
    >
    markPasswordResetTokenUsed(tokenId: string): Promise<void>
    updateUserPassword(userId: string, passwordHash: string): Promise<void>
    createMagicLink(params: {
        tokenId: string
        tokenHash: string
        expiresAt: Date
        promoType: MagicLinkPromoType
        promoDurationDays: number
        maxUses?: number
    }): Promise<void>
    findMagicLink(tokenId: string): Promise<MagicLinkRecord | null>
    redeemMagicLink(params: { magicLinkId: string; userId: string }): Promise<void>
    findExpiredPlans(): Promise<
        Array<{
            tenantId: string
            planId: string
            planName: UserPlans
            endDate: Date | null
            billingStatus: string | null
        }>
    >
}
