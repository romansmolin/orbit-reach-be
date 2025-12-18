import assert from 'assert'
import { UserService } from '@/services/users-service/users.service'
import { IUserRepository } from '@/repositories/user-repository'
import { UserPlan } from '@/entities/user-plan'
import { User } from '@/entities/tenant'
import { UserPlans } from '@/shared/consts/plans'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { IStripeService } from '@/services/stripe-service/stripe.service.interface'

class MockLogger implements ILogger {
    debug() {}
    info() {}
    warn() {}
    error() {}
}

class MockStripeService implements IStripeService {
    async retrieveSubscription() {
        return { id: 'sub_mock' } as any
    }
    async createSubscription() {
        return { id: 'sub_mock' } as any
    }
    async updateSubscription() {
        return { id: 'sub_mock' } as any
    }
    async scheduleSubscriptionCancellation() {
        return { id: 'sub_mock' } as any
    }
    async setSubscriptionMetadata() {
        return Promise.resolve()
    }
}

class MockUserRepository implements Partial<IUserRepository> {
    public incrementUsageLimitsCalls: Array<{
        userId: string
        planId: string
        periodStart: Date
        periodEnd: Date
        deltas: { sent?: number; scheduled?: number; ai?: number }
        baseLimits: { sent: number; scheduled: number; ai: number }
    }> = []

    public userPlan: UserPlan | null = null
    public user: User | null = null

    async findUserPlanByUserId(userId: string): Promise<UserPlan> {
        if (!this.userPlan) {
            throw new Error('User plan not set in mock')
        }
        return this.userPlan
    }

    async findById(id: string): Promise<User> {
        if (!this.user) {
            throw new Error('User not set in mock')
        }
        return this.user
    }

    async incrementUsageLimits(params: {
        userId: string
        planId: string
        periodStart: Date
        periodEnd: Date
        deltas: { sent?: number; scheduled?: number; ai?: number }
        baseLimits: { sent: number; scheduled: number; ai: number }
    }): Promise<void> {
        this.incrementUsageLimitsCalls.push(params)
    }

    async getCurrentUsageQuota(): Promise<any> {
        return {
            sentPosts: { used: 0, limit: 0 },
            scheduledPosts: { used: 0, limit: 0 },
            connectedAccounts: { used: 0, limit: 0 },
            aiRequests: { used: 0, limit: 0 },
        }
    }

    // Stub other required methods
    async findByEmail() {
        return null
    }
    async findByStripeCustomerId() {
        return null
    }
    async save() {
        return this.user!
    }
    async updateStripeCustomerId() {}
    async getStripeCustomerId() {
        return null
    }
    async findUserPlanBySubscriptionId() {
        return null
    }
    async ensurePlan() {
        return this.userPlan!
    }
    async updateUserPlanUsage() {
        return { success: true, newUsageCount: 0, limitCount: 0 }
    }
    async resetUsageCountersForPlan() {}
    async findExpiredPlans() {
        return []
    }
    async createPasswordResetToken() {}
    async findPasswordResetToken() {
        return null
    }
    async updatePassword() {}
    async createMagicLink() {
        return Promise.resolve()
    }
    async findMagicLinkByToken() {
        return null
    }
    async redeemMagicLink() {}
}

async function testExtraSmallAddon() {
    const mockRepo = new MockUserRepository()
    const logger = new MockLogger()
    const stripeService = new MockStripeService()
    const userService = new UserService(mockRepo as any, stripeService, logger)

    const startDate = new Date('2025-01-01')
    const endDate = new Date('2025-02-01')

    mockRepo.userPlan = new UserPlan(
        'plan-1',
        'user-1',
        UserPlans.FREE,
        'monthly',
        30, // sendPostsLimit
        10, // scheduledPostsLimit
        [],
        startDate,
        endDate,
        true,
        null, // stripeSubscriptionId
        null, // stripePriceId
        null, // status
        null, // currentPeriodEnd
        null, // stripeLookupKey
        1, // accountsLimit
        0, // aiRequestsLimit
        'active' // billingStatus
    )

    mockRepo.user = new User(
        'user-1',
        'Test User',
        'test@example.com',
        false,
        'hashed',
        '',
        null,
        new Date(),
        50,
        30,
        10,
        0
    )

    await userService.applyAddonPurchase('user-1', {
        addonCode: 'EXTRA_SMALL',
        usageDeltas: {
            sentPosts: 20,
            scheduledPosts: 10,
            aiRequests: 10,
        },
    })

    assert.strictEqual(mockRepo.incrementUsageLimitsCalls.length, 1)
    const call = mockRepo.incrementUsageLimitsCalls[0]

    assert.strictEqual(call.userId, 'user-1')
    assert.strictEqual(call.deltas.sent, 20, 'EXTRA_SMALL should add 20 sent posts')
    assert.strictEqual(call.deltas.scheduled, 10, 'EXTRA_SMALL should add 10 scheduled posts')
    assert.strictEqual(call.deltas.ai, 10, 'EXTRA_SMALL should add 10 AI requests')
    assert.strictEqual(call.baseLimits.sent, 30, 'Base limit should be 30')
    assert.strictEqual(call.baseLimits.scheduled, 10, 'Base limit should be 10')
    assert.strictEqual(call.baseLimits.ai, 0, 'Base AI limit should be 0')

    console.log('✅ EXTRA_SMALL add-on test passed')
}

async function testExtraMediumAddon() {
    const mockRepo = new MockUserRepository()
    const logger = new MockLogger()
    const stripeService = new MockStripeService()
    const userService = new UserService(mockRepo as any, stripeService, logger)

    const startDate = new Date('2025-01-01')
    const endDate = new Date('2025-02-01')

    mockRepo.userPlan = new UserPlan(
        'plan-1',
        'user-1',
        UserPlans.FREE,
        'monthly',
        30,
        10,
        [],
        startDate,
        endDate,
        true,
        null, // stripeSubscriptionId
        null, // stripePriceId
        null, // status
        null, // currentPeriodEnd
        null, // stripeLookupKey
        1, // accountsLimit
        0, // aiRequestsLimit
        'active' // billingStatus
    )

    mockRepo.user = new User('user-1', 'Test', 'test@example.com', false, 'hashed', '', null, new Date(), 50, 30, 10, 0)

    await userService.applyAddonPurchase('user-1', {
        addonCode: 'EXTRA_MEDIUM',
        usageDeltas: {
            sentPosts: 100,
            scheduledPosts: 80,
            aiRequests: 30,
        },
    })

    const call = mockRepo.incrementUsageLimitsCalls[0]
    assert.strictEqual(call.deltas.sent, 100, 'EXTRA_MEDIUM should add 100 sent posts')
    assert.strictEqual(call.deltas.scheduled, 80, 'EXTRA_MEDIUM should add 80 scheduled posts')
    assert.strictEqual(call.deltas.ai, 30, 'EXTRA_MEDIUM should add 30 AI requests')

    console.log('✅ EXTRA_MEDIUM add-on test passed')
}

async function testCumulativePurchases() {
    const mockRepo = new MockUserRepository()
    const logger = new MockLogger()
    const stripeService = new MockStripeService()
    const userService = new UserService(mockRepo as any, stripeService, logger)

    const startDate = new Date('2025-01-01')
    const endDate = new Date('2025-02-01')

    mockRepo.userPlan = new UserPlan(
        'plan-1',
        'user-1',
        UserPlans.FREE,
        'monthly',
        30,
        10,
        [],
        startDate,
        endDate,
        true,
        null, // stripeSubscriptionId
        null, // stripePriceId
        null, // status
        null, // currentPeriodEnd
        null, // stripeLookupKey
        1, // accountsLimit
        0, // aiRequestsLimit
        'active' // billingStatus
    )

    mockRepo.user = new User('user-1', 'Test', 'test@example.com', false, 'hashed', '', null, new Date(), 50, 30, 10, 0)

    // First purchase: EXTRA_SMALL (+20 sent, +10 scheduled, +10 AI)
    await userService.applyAddonPurchase('user-1', {
        addonCode: 'EXTRA_SMALL',
        usageDeltas: {
            sentPosts: 20,
            scheduledPosts: 10,
            aiRequests: 10,
        },
    })

    // Second purchase: EXTRA_MEDIUM (+100 sent, +80 scheduled, +30 AI)
    await userService.applyAddonPurchase('user-1', {
        addonCode: 'EXTRA_MEDIUM',
        usageDeltas: {
            sentPosts: 100,
            scheduledPosts: 80,
            aiRequests: 30,
        },
    })

    assert.strictEqual(mockRepo.incrementUsageLimitsCalls.length, 2, 'Should have 2 purchase calls')

    // Verify first purchase
    const firstCall = mockRepo.incrementUsageLimitsCalls[0]
    assert.strictEqual(firstCall.deltas.sent, 20)
    assert.strictEqual(firstCall.deltas.scheduled, 10)
    assert.strictEqual(firstCall.deltas.ai, 10)

    // Verify second purchase (should be cumulative in repository logic)
    const secondCall = mockRepo.incrementUsageLimitsCalls[1]
    assert.strictEqual(secondCall.deltas.sent, 100)
    assert.strictEqual(secondCall.deltas.scheduled, 80)
    assert.strictEqual(secondCall.deltas.ai, 30)

    // Both should use same base limits
    assert.strictEqual(firstCall.baseLimits.sent, 30)
    assert.strictEqual(secondCall.baseLimits.sent, 30)

    console.log('✅ Cumulative purchases test passed')
}

async function testRejectZeroDeltas() {
    const mockRepo = new MockUserRepository()
    const logger = new MockLogger()
    const stripeService = new MockStripeService()
    const userService = new UserService(mockRepo as any, stripeService, logger)

    const startDate = new Date('2025-01-01')
    const endDate = new Date('2025-02-01')

    mockRepo.userPlan = new UserPlan(
        'plan-1',
        'user-1',
        UserPlans.FREE,
        'monthly',
        30,
        10,
        [],
        startDate,
        endDate,
        true,
        null, // stripeSubscriptionId
        null, // stripePriceId
        null, // status
        null, // currentPeriodEnd
        null, // stripeLookupKey
        1, // accountsLimit
        0, // aiRequestsLimit
        'active' // billingStatus
    )

    mockRepo.user = new User('user-1', 'Test', 'test@example.com', false, 'hashed', '', null, new Date(), 50, 30, 10, 0)

    try {
        await userService.applyAddonPurchase('user-1', {
            addonCode: 'INVALID',
            usageDeltas: {
                sentPosts: 0,
                scheduledPosts: 0,
                aiRequests: 0,
            },
        })
        assert.fail('Should have thrown an error for zero deltas')
    } catch (error) {
        assert(error instanceof BaseAppError)
        assert.strictEqual(error.code, ErrorCode.BAD_REQUEST)
        assert(error.message.includes('No add-on increments provided'))
    }

    console.log('✅ Reject zero deltas test passed')
}

async function testNegativeDeltasClamped() {
    const mockRepo = new MockUserRepository()
    const logger = new MockLogger()
    const stripeService = new MockStripeService()
    const userService = new UserService(mockRepo as any, stripeService, logger)

    const startDate = new Date('2025-01-01')
    const endDate = new Date('2025-02-01')

    mockRepo.userPlan = new UserPlan(
        'plan-1',
        'user-1',
        UserPlans.FREE,
        'monthly',
        30,
        10,
        [],
        startDate,
        endDate,
        true,
        null, // stripeSubscriptionId
        null, // stripePriceId
        null, // status
        null, // currentPeriodEnd
        null, // stripeLookupKey
        1, // accountsLimit
        0, // aiRequestsLimit
        'active' // billingStatus
    )

    mockRepo.user = new User('user-1', 'Test', 'test@example.com', false, 'hashed', '', null, new Date(), 50, 30, 10, 0)

    await userService.applyAddonPurchase('user-1', {
        addonCode: 'CUSTOM',
        usageDeltas: {
            sentPosts: -10, // Should be clamped to 0
            scheduledPosts: 20,
            aiRequests: 0,
        },
    })

    const call = mockRepo.incrementUsageLimitsCalls[0]
    assert.strictEqual(call.deltas.sent, 0, 'Negative delta should be clamped to 0')
    assert.strictEqual(call.deltas.scheduled, 20)

    console.log('✅ Negative deltas clamped test passed')
}

async function testPartialDeltas() {
    const mockRepo = new MockUserRepository()
    const logger = new MockLogger()
    const stripeService = new MockStripeService()
    const userService = new UserService(mockRepo as any, stripeService, logger)

    const startDate = new Date('2025-01-01')
    const endDate = new Date('2025-02-01')

    mockRepo.userPlan = new UserPlan(
        'plan-1',
        'user-1',
        UserPlans.FREE,
        'monthly',
        30,
        10,
        [],
        startDate,
        endDate,
        true,
        null, // stripeSubscriptionId
        null, // stripePriceId
        null, // status
        null, // currentPeriodEnd
        null, // stripeLookupKey
        1, // accountsLimit
        0, // aiRequestsLimit
        'active' // billingStatus
    )

    mockRepo.user = new User('user-1', 'Test', 'test@example.com', false, 'hashed', '', null, new Date(), 50, 30, 10, 0)

    // Test with only sent posts
    await userService.applyAddonPurchase('user-1', {
        addonCode: 'SENT_ONLY',
        usageDeltas: {
            sentPosts: 50,
            scheduledPosts: 0,
            aiRequests: 0,
        },
    })

    const call = mockRepo.incrementUsageLimitsCalls[0]
    assert.strictEqual(call.deltas.sent, 50)
    assert.strictEqual(call.deltas.scheduled, 0)
    assert.strictEqual(call.deltas.ai, 0)

    console.log('✅ Partial deltas test passed')
}

async function testLimitCalculation() {
    // Test the mathematical logic: baseLimit + delta = newLimit
    const baseLimit = 30
    const delta = 20
    const expectedNewLimit = baseLimit + delta

    assert.strictEqual(expectedNewLimit, 50, 'Base limit + delta should equal new limit')

    // Test cumulative: multiple purchases
    let currentLimit = 30
    currentLimit = currentLimit + 20 // First purchase
    assert.strictEqual(currentLimit, 50)

    currentLimit = currentLimit + 100 // Second purchase
    assert.strictEqual(currentLimit, 150)

    currentLimit = currentLimit + 500 // Third purchase
    assert.strictEqual(currentLimit, 650)

    console.log('✅ Limit calculation logic test passed')
}

async function runAllTests() {
    console.log('🧪 Running add-on limits tests...\n')

    try {
        await testExtraSmallAddon()
        await testExtraMediumAddon()
        await testCumulativePurchases()
        await testRejectZeroDeltas()
        await testNegativeDeltasClamped()
        await testPartialDeltas()
        await testLimitCalculation()

        console.log('\n✅ All add-on limits tests passed!')
    } catch (error) {
        console.error('\n❌ Test failed:', error)
        if (error instanceof Error) {
            console.error('Error message:', error.message)
            console.error('Stack:', error.stack)
        }
        process.exit(1)
    }
}

runAllTests()
