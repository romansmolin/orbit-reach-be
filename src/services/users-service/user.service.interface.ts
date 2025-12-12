import type { UserSchema } from '../../schemas/user.schemas'
import { UserPlans } from '@/shared/consts/plans'
import { UserPlan } from '@/entities/user-plan'
import { SocilaMediaPlatform } from '@/schemas/posts.schemas'

export interface UsageCounter {
    used: number
    limit: number
}

export interface UserPlanUsageSummary {
    sentPosts: UsageCounter
    scheduledPosts: UsageCounter
    connectedAccounts: UsageCounter
    aiRequests: UsageCounter
}

export interface UserPlanResponse {
    id: string
    planName: UserPlans
    planType: 'monthly' | 'yearly'
    sendPostsLimit: number
    scheduledPostsLimit: number
    platformAllowed: SocilaMediaPlatform[]
    startDate: Date
    endDate: Date | null
    isActive: boolean
    status: string | null
    currentPeriodEnd: Date | null
    accountsLimit: number | null
    aiRequestsLimit: number | null
    subscriptionEndsAt: Date | null
    isPendingCancellation: boolean
    canReactivate: boolean
    canUpdateSubscription: boolean
}

export interface IUserService {
    signup(
        email: string,
        googleId: string,
        name: string,
        passwordHash?: string,
        magicToken?: string
    ): Promise<UserSchema | null>
    signin(email: string, password: string): Promise<UserSchema | null>
    findUserByEmail(email: string): Promise<UserSchema | null>
    findUserByStripeCustomerId(customerId: string): Promise<UserSchema | null>
    findOrCreateUser(user: any, magicToken?: string): Promise<UserSchema | null>
    findUserById(id: string): Promise<{
        user: UserSchema
        plan: UserPlanResponse | null
        quotaUsage: UserPlanUsageSummary
    } | null>
    updateCustomerPlan(
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
    ): Promise<void>
    getUserPlan(userId: string): Promise<UserPlan>
    getUsageQuota(userId: string, periodStart?: Date, periodEnd?: Date): Promise<UserPlanUsageSummary>
    incrementConnectedAccountsUsage(userId: string): Promise<void>
    decrementConnectedAccountsUsage(userId: string): Promise<void>
    incrementAiUsage(userId: string): Promise<void>
    updateSubscription(userId: string, planName: UserPlans, planType?: 'monthly' | 'yearly'): Promise<void>
    cancelSubscription(userId: string): Promise<void>
    handleSubscriptionCancelled(stripeSubscriptionId: string, tenantId?: string): Promise<void>
    handleSubscriptionRenewal(params: {
        tenantId: string
        planName: UserPlans
        planType: 'monthly' | 'yearly'
        stripeSubscriptionId?: string | null
        stripePriceId?: string | null
        stripeLookupKey?: string | null
        stripeCustomerId?: string | null
        periodStart: Date
        periodEnd: Date
    }): Promise<void>
    applyAddonPurchase(
        userId: string,
        addon: {
            addonCode: string
            usageDeltas: {
                sentPosts?: number
                scheduledPosts?: number
                aiRequests?: number
            }
        }
    ): Promise<void>
    processExpiredPlans(): Promise<void>
}
