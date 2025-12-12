import assert from 'assert'
import { SecureProcessorPaymentService } from '@/services/secure-processor-service'
import {
    CheckoutTokenResponse,
    SecureProcessorAddonCode,
    SecureProcessorBillingPeriod,
    SecureProcessorPlanCode,
} from '@/services/secure-processor-service'
import { IPaymentTokensRepository } from '@/repositories/payment-tokens-repository'
import { PaymentToken, PaymentTokenStatus, UsageDeltas } from '@/entities/payment-token'
import { UserPlans } from '@/shared/consts/plans'
import { IApiClient } from '@/shared/infra/api'
import { ILogger } from '@/shared/infra/logger/logger.interface'

class MockApiClient implements IApiClient {
    public lastPost?: { url: string; body: any; options?: any }
    public postResponse: any = { checkout: { token: 'tok_mock', uid: 'uid_mock' } }

    async post<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: any
    ): Promise<TResponse> {
        this.lastPost = { url: apiUrl, body, options }
        return this.postResponse as TResponse
    }

    async get<TResponse = unknown>(apiUrl: string, _options?: any): Promise<TResponse> {
        throw new Error(`GET not implemented: ${apiUrl}`)
    }
    async delete<TResponse = unknown>(_apiUrl: string, _options?: any): Promise<TResponse> {
        throw new Error('DELETE not implemented')
    }
    async put<TResponse = unknown, TBody = unknown>(_apiUrl: string, _body?: TBody, _options?: any): Promise<TResponse> {
        throw new Error('PUT not implemented')
    }
    async patch<TResponse = unknown, TBody = unknown>(_apiUrl: string, _body?: TBody, _options?: any): Promise<TResponse> {
        throw new Error('PATCH not implemented')
    }
}

class MockPaymentTokensRepository implements IPaymentTokensRepository {
    public lastCreateInput: any = null
    public storage = new Map<string, PaymentToken>()

    async create(data: any): Promise<PaymentToken> {
        this.lastCreateInput = data
        const token = new PaymentToken(
            'id_' + data.token,
            data.token,
            data.tenantId,
            data.planCode,
            data.billingPeriod,
            data.amount,
            data.currency,
            data.description ?? null,
            data.testMode ?? false,
            data.status ?? ('created' as PaymentTokenStatus),
            data.gatewayUid ?? null,
            data.trackingId ?? null,
            data.rawPayload ?? null,
            data.errorMessage ?? null,
            new Date(),
            new Date(),
            data.itemType ?? 'plan',
            data.addonCode ?? null,
            data.usageDeltas ?? null
        )
        this.storage.set(data.token, token)
        return token
    }

    async findByToken(token: string): Promise<PaymentToken | null> {
        return this.storage.get(token) ?? null
    }

    async updateByToken(token: string, updates: any): Promise<PaymentToken | null> {
        const existing = this.storage.get(token)
        if (!existing) return null
        const updated = new PaymentToken(
            existing.id,
            existing.token,
            existing.tenantId,
            existing.planCode,
            existing.billingPeriod,
            updates.amount ?? existing.amount,
            updates.currency ?? existing.currency,
            updates.description ?? existing.description,
            updates.testMode ?? existing.testMode,
            updates.status ?? existing.status,
            updates.gatewayUid ?? existing.gatewayUid,
            updates.trackingId ?? existing.trackingId,
            updates.rawPayload ?? existing.rawPayload,
            updates.errorMessage ?? existing.errorMessage,
            existing.createdAt,
            new Date(),
            updates.itemType ?? existing.itemType,
            updates.addonCode ?? existing.addonCode,
            updates.usageDeltas ?? existing.usageDeltas
        )
        this.storage.set(token, updated)
        return updated
    }
}

class MockUserService {
    public plan = {
        id: 'plan_1',
        planName: UserPlans.STARTER,
        planType: 'monthly' as 'monthly' | 'yearly',
        sendPostsLimit: 300,
        scheduledPostsLimit: 200,
        platformAllowed: [],
        startDate: new Date(),
        endDate: new Date(),
        isActive: true,
        status: 'active',
        currentPeriodEnd: new Date(),
        accountsLimit: 10,
        aiRequestsLimit: 0,
        subscriptionEndsAt: new Date(),
        isPendingCancellation: false,
        canReactivate: false,
        canUpdateSubscription: true,
        billingStatus: 'active',
        stripeLookupKey: null,
        stripePriceId: null,
        stripeSubscriptionId: null,
        planId: 'plan_1',
        tenantId: 'tenant_1',
    }

    async findUserById(id: string): Promise<any> {
        return {
            user: {
                id,
                email: 'user@example.com',
            },
            plan: this.plan,
            quotaUsage: {
                sentPosts: { used: 0, limit: 0 },
                scheduledPosts: { used: 0, limit: 0 },
                connectedAccounts: { used: 0, limit: 0 },
                aiRequests: { used: 0, limit: 0 },
            },
        }
    }

    async getUserPlan(_userId: string): Promise<any> {
        return {
            tenantId: 'tenant_1',
            planName: this.plan.planName,
            planType: this.plan.planType,
            sendPostsLimit: this.plan.sendPostsLimit,
            scheduledPostsLimit: this.plan.scheduledPostsLimit,
            aiRequestsLimit: this.plan.aiRequestsLimit,
            platformAllowed: [],
            startDate: new Date(),
            endDate: new Date(),
            isActive: true,
            stripeSubscriptionId: null,
            stripePriceId: null,
            status: 'active',
            currentPeriodEnd: new Date(),
            stripeLookupKey: null,
            accountsLimit: this.plan.accountsLimit,
            billingStatus: 'active',
            id: 'plan_1',
        }
    }

    async updateCustomerPlan(_userId: string, _plan: any): Promise<void> {
        return
    }

    async applyAddonPurchase(_userId: string, _addon: any): Promise<void> {
        return
    }

    // Unused interface methods stubbed
    async signup(): Promise<any> {
        throw new Error('not implemented')
    }
    async signin(): Promise<any> {
        throw new Error('not implemented')
    }
    async findUserByEmail(): Promise<any> {
        throw new Error('not implemented')
    }
    async findUserByStripeCustomerId(): Promise<any> {
        throw new Error('not implemented')
    }
    async findOrCreateUser(): Promise<any> {
        throw new Error('not implemented')
    }
    async getUsageQuota(): Promise<any> {
        throw new Error('not implemented')
    }
    async incrementConnectedAccountsUsage(): Promise<void> {
        throw new Error('not implemented')
    }
    async decrementConnectedAccountsUsage(): Promise<void> {
        throw new Error('not implemented')
    }
    async incrementAiUsage(): Promise<void> {
        throw new Error('not implemented')
    }
    async updateSubscription(): Promise<void> {
        throw new Error('not implemented')
    }
    async cancelSubscription(): Promise<void> {
        throw new Error('not implemented')
    }
    async handleSubscriptionCancelled(): Promise<void> {
        throw new Error('not implemented')
    }
    async handleSubscriptionRenewal(): Promise<void> {
        throw new Error('not implemented')
    }
    async processExpiredPlans(): Promise<void> {
        throw new Error('not implemented')
    }
}

class MockLogger implements ILogger {
    info(_message: string, _meta?: any): void {
        return
    }
    warn(_message: string, _meta?: any): void {
        return
    }
    error(_message: string, _meta?: any): void {
        return
    }
    debug(_message: string, _meta?: any): void {
        return
    }
}

function setEnv() {
    process.env.SECURE_PROCESSOR_SHOP_ID = 'shop_123'
    process.env.SECURE_PROCESSOR_SECRET_KEY = 'secret_abc'
    process.env.SECURE_PROCESSOR_PUBLIC_KEY =
        'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtestpublickeyvalue'
    process.env.BACKEND_URL = 'https://backend.example.com'
    process.env.FRONTEND_URL = 'https://frontend.example.com'
    process.env.NEXT_PUBLIC_SECURE_PROCESSOR_TEST_MODE = 'true'
}

async function testPlanCheckout() {
    setEnv()
    const apiClient = new MockApiClient()
    const repo = new MockPaymentTokensRepository()
    const userService = new MockUserService()
    const logger = new MockLogger()

    const service = new SecureProcessorPaymentService(repo, userService as any, logger, apiClient)

    const result: CheckoutTokenResponse = await service.createCheckoutToken({
        itemType: 'plan',
        userId: 'tenant_1',
        planCode: 'STARTER' as SecureProcessorPlanCode,
        billingPeriod: 'monthly' as SecureProcessorBillingPeriod,
    })

    assert.strictEqual(result.token, 'tok_mock')
    assert.strictEqual(apiClient.lastPost?.url, '/ctp/api/checkouts')
    const body = apiClient.lastPost?.body as any
    assert.ok(body.checkout?.order, 'checkout.order should be present')
    assert.ok(body.order, 'order should be present at top-level')
    assert.strictEqual(body.order.amount, 1000)
    assert.strictEqual(body.order.currency, 'EUR')
    assert.strictEqual(repo.lastCreateInput.itemType, 'plan')
    assert.strictEqual(repo.lastCreateInput.planCode, UserPlans.STARTER)
    assert.strictEqual(repo.lastCreateInput.billingPeriod, 'monthly')
    assert.strictEqual(repo.lastCreateInput.amount, 1000)
    assert.strictEqual(repo.lastCreateInput.currency, 'EUR')
}

async function testAddonCheckout() {
    setEnv()
    const apiClient = new MockApiClient()
    apiClient.postResponse = { checkout: { token: 'tok_addon', uid: 'uid_addon' } }
    const repo = new MockPaymentTokensRepository()
    const userService = new MockUserService()
    userService.plan.planName = UserPlans.PRO
    userService.plan.planType = 'yearly'
    const logger = new MockLogger()

    const service = new SecureProcessorPaymentService(repo, userService as any, logger, apiClient)

    const result: CheckoutTokenResponse = await service.createCheckoutToken({
        itemType: 'addon',
        userId: 'tenant_1',
        addonCode: 'EXTRA_POSTS_100' as SecureProcessorAddonCode,
    })

    assert.strictEqual(result.token, 'tok_addon')
    const body = apiClient.lastPost?.body as any
    assert.strictEqual(body.order.amount, 900)
    assert.strictEqual(body.order.currency, 'EUR')
    assert.strictEqual(repo.lastCreateInput.itemType, 'addon')
    assert.strictEqual(repo.lastCreateInput.addonCode, 'EXTRA_POSTS_100')
    assert.deepStrictEqual(repo.lastCreateInput.usageDeltas, { sentPosts: 100 })
    assert.strictEqual(repo.lastCreateInput.planCode, UserPlans.PRO)
    assert.strictEqual(repo.lastCreateInput.billingPeriod, 'yearly')
}

async function run() {
    await testPlanCheckout()
    await testAddonCheckout()
    console.log('Secure Processor service tests passed')
}

run().catch((error) => {
    console.error('Test failed', error)
    process.exit(1)
})
