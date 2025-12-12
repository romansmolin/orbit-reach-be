import crypto from 'crypto'
import { AxiosApiClient, IApiClient } from '@/shared/infra/api'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { getEnvVar } from '@/shared/utils/get-env-var'
import { IPaymentTokensRepository } from '@/repositories/payment-tokens-repository'
import { IUserService } from '@/services/users-service/user.service.interface'
import { PaymentToken, PaymentTokenStatus, UsageDeltas } from '@/entities/payment-token'
import {
    CheckoutTokenResponse,
    CreateCheckoutParams,
    ISecureProcessorPaymentService,
    ReturnHandlingResult,
    SecureProcessorAddonCode,
    SecureProcessorBillingPeriod,
    SecureProcessorPlanCode,
} from './secure-processor.service.interface'
import { UserPlans } from '@/shared/consts/plans'

type PlanPricing = { amount: number; currency: string; description: string }

type CheckoutDetails = {
    token: string
    status: PaymentTokenStatus | null
    uid: string | null
    amount?: number
    currency?: string | null
    testMode?: boolean
    rawPayload?: unknown
}

export class SecureProcessorPaymentService implements ISecureProcessorPaymentService {
    private static readonly PLAN_PRICING: Record<SecureProcessorPlanCode, { monthly: PlanPricing; yearly: PlanPricing }> =
        {
            STARTER: {
                monthly: { amount: 1000, currency: 'EUR', description: 'Starter monthly subscription' },
                yearly: { amount: 7300, currency: 'EUR', description: 'Starter yearly subscription' },
            },
            PRO: {
                monthly: { amount: 1700, currency: 'EUR', description: 'Pro monthly subscription' },
                yearly: { amount: 12000, currency: 'EUR', description: 'Pro yearly subscription' },
            },
        }

    private static readonly ADDON_PRICING: Record<
        SecureProcessorAddonCode,
        { amount: number; currency: string; description: string; usageDeltas: UsageDeltas }
    > = {
        EXTRA_POSTS_100: {
            amount: 900,
            currency: 'EUR',
            description: 'Extra 100 posts allowance',
            usageDeltas: { sentPosts: 100 },
        },
        EXTRA_SCHEDULES_100: {
            amount: 800,
            currency: 'EUR',
            description: 'Extra 100 scheduled posts allowance',
            usageDeltas: { scheduledPosts: 100 },
        },
        EXTRA_AI_50: {
            amount: 1200,
            currency: 'EUR',
            description: 'Extra 50 AI requests allowance',
            usageDeltas: { aiRequests: 50 },
        },
    }

    private readonly repository: IPaymentTokensRepository
    private readonly userService: IUserService
    private readonly logger: ILogger
    private readonly apiClient: IApiClient
    private readonly shopId: string
    private readonly secretKey: string
    private readonly publicKey: string
    private readonly testMode: boolean
    private readonly backendBaseUrl: string
    private readonly frontendBaseUrl: string
    private readonly authHeader: string

    constructor(
        repository: IPaymentTokensRepository,
        userService: IUserService,
        logger: ILogger,
        apiClient: IApiClient = new AxiosApiClient('https://checkout.secure-processor.com')
    ) {
        this.repository = repository
        this.userService = userService
        this.logger = logger
        this.apiClient = apiClient
        this.shopId = getEnvVar('SECURE_PROCESSOR_SHOP_ID')
        this.secretKey = getEnvVar('SECURE_PROCESSOR_SECRET_KEY')
        this.publicKey = this.formatPublicKey(getEnvVar('SECURE_PROCESSOR_PUBLIC_KEY'))
        this.testMode = process.env.NEXT_PUBLIC_SECURE_PROCESSOR_TEST_MODE === 'true'
        this.backendBaseUrl = this.resolveBackendBaseUrl()
        this.frontendBaseUrl = this.resolveFrontendBaseUrl()
        this.authHeader = `Basic ${Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64')}`
    }

    async createCheckoutToken(params: CreateCheckoutParams): Promise<CheckoutTokenResponse> {
        const userData = await this.userService.findUserById(params.userId)

        if (!userData?.user?.email) {
            throw new BaseAppError('User email is required for payment', ErrorCode.BAD_REQUEST, 400)
        }

        if (params.itemType === 'addon') {
            return this.createAddonCheckoutToken(params, userData.user.email)
        }

        return this.createPlanCheckoutToken(params, userData.user.email)
    }

    async handleReturn(params: { token: string; status?: string | null; uid?: string | null }): Promise<ReturnHandlingResult> {
        const record = await this.requireTokenRecord(params.token)
        const normalizedStatus = this.normalizeStatus(params.status)
        const shouldReconcile = !normalizedStatus || normalizedStatus === 'pending'

        let finalStatus: PaymentTokenStatus = normalizedStatus ?? 'pending'
        let gatewayUid = params.uid ?? record.gatewayUid ?? null

        if (shouldReconcile) {
            const checkout = await this.queryCheckoutStatus(record.token)
            this.ensurePayloadConsistency(record, checkout)
            finalStatus = checkout.status ?? 'pending'
            gatewayUid = checkout.uid ?? gatewayUid

            await this.repository.updateByToken(record.token, {
                status: finalStatus,
                gatewayUid,
                rawPayload: checkout.rawPayload,
                testMode: checkout.testMode,
            })

            if (finalStatus === 'successful' && record.status !== 'successful') {
                await this.applyFulfillment(record)
            }
        } else {
            await this.applyStatusUpdate(record, finalStatus, {
                gatewayUid,
            })
        }

        return {
            status: finalStatus,
            redirectUrl: this.buildRedirectUrl(finalStatus, record.token),
        }
    }

    async processWebhook(rawPayload: Buffer, headers: { authorization?: string; contentSignature?: string }): Promise<void> {
        this.verifyBasicAuth(headers.authorization)
        this.verifySignature(rawPayload, headers.contentSignature)

        let parsed: unknown
        try {
            parsed = JSON.parse(rawPayload.toString('utf-8'))
        } catch {
            throw new BaseAppError('Webhook payload is not valid JSON', ErrorCode.BAD_REQUEST, 400)
        }

        const checkout = this.extractCheckoutDetails(parsed)
        const record = await this.requireTokenRecord(checkout.token)

        this.ensurePayloadConsistency(record, checkout)

        await this.applyStatusUpdate(record, checkout.status ?? 'pending', {
            gatewayUid: checkout.uid ?? record.gatewayUid ?? null,
            rawPayload: parsed,
        })
    }

    private async applyStatusUpdate(
        record: PaymentToken,
        status: PaymentTokenStatus,
        updates?: {
            gatewayUid?: string | null
            rawPayload?: unknown
            errorMessage?: string | null
            testMode?: boolean
            usageDeltas?: UsageDeltas | null
        }
    ): Promise<PaymentTokenStatus> {
        const nextStatus = status ?? 'pending'
        const shouldActivate = nextStatus === 'successful' && record.status !== 'successful'

        await this.repository.updateByToken(record.token, {
            status: nextStatus,
            gatewayUid: updates?.gatewayUid,
            rawPayload: updates?.rawPayload,
            errorMessage: updates?.errorMessage,
            testMode: updates?.testMode,
            usageDeltas: updates?.usageDeltas,
        })

        if (shouldActivate) {
            await this.applyFulfillment(record)
        }

        return nextStatus
    }

    private async applyFulfillment(record: PaymentToken): Promise<void> {
        if (record.itemType === 'addon') {
            const deltas = record.usageDeltas ?? undefined
            await this.userService.applyAddonPurchase(record.tenantId, {
                addonCode: record.addonCode ?? 'UNKNOWN_ADDON',
                usageDeltas: {
                    sentPosts: deltas?.sentPosts ?? 0,
                    scheduledPosts: deltas?.scheduledPosts ?? 0,
                    aiRequests: deltas?.aiRequests ?? 0,
                },
            })
            return
        }

        await this.userService.updateCustomerPlan(record.tenantId, {
            name: record.planCode,
            planType: record.billingPeriod,
            billingStatus: 'active',
            subscriptionStatus: 'active',
        })
    }

    private async requireTokenRecord(token: string): Promise<PaymentToken> {
        const record = await this.repository.findByToken(token)

        if (!record) {
            throw new BaseAppError('Payment token was not found', ErrorCode.NOT_FOUND, 404)
        }

        return record
    }

    private resolvePlanPricing(planCode: SecureProcessorPlanCode, billingPeriod: SecureProcessorBillingPeriod): PlanPricing {
        const planPricing = SecureProcessorPaymentService.PLAN_PRICING[planCode]
        const pricing = planPricing?.[billingPeriod]

        if (!pricing) {
            throw new BaseAppError('Unsupported plan selection', ErrorCode.BAD_REQUEST, 400)
        }

        return pricing
    }

    private resolveAddonPricing(addonCode: SecureProcessorAddonCode): {
        amount: number
        currency: string
        description: string
        usageDeltas: UsageDeltas
    } {
        const pricing = SecureProcessorPaymentService.ADDON_PRICING[addonCode]

        if (!pricing) {
            throw new BaseAppError('Unsupported add-on selection', ErrorCode.BAD_REQUEST, 400)
        }

        return pricing
    }

    private normalizeStatus(status?: string | null): PaymentTokenStatus | null {
        if (!status) return null

        const normalized = status.toLowerCase()

        if (['success', 'successful', 'paid', 'approved'].includes(normalized)) return 'successful'
        if (['pending', 'processing', 'incomplete', 'awaiting'].includes(normalized)) return 'pending'
        if (['declined', 'canceled', 'cancelled'].includes(normalized)) return 'declined'
        if (['failed', 'error'].includes(normalized)) return 'failed'
        if (normalized === 'expired') return 'expired'

        return null
    }

    private buildTrackingId(userId: string, planCode: SecureProcessorPlanCode, billingPeriod: SecureProcessorBillingPeriod): string {
        return `${userId}-${planCode}-${billingPeriod}-${Date.now()}`
    }

    private buildAddonTrackingId(userId: string, addonCode: SecureProcessorAddonCode): string {
        return `${userId}-${addonCode}-${Date.now()}`
    }

    private buildRequestHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-API-Version': '2',
            Authorization: this.authHeader,
        }
    }

    private resolveBackendBaseUrl(): string {
        const base = getEnvVar('BACKEND_URL').replace(/\/$/, '')

        if (process.env.NODE_ENV === 'production' && base.startsWith('http://')) {
            throw new BaseAppError(
                'BACKEND_URL must use HTTPS in production for payment callbacks',
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        }

        return base
    }

    private resolveFrontendBaseUrl(): string {
        const raw = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0]?.trim()
        return (raw || 'http://localhost:3000').replace(/\/$/, '')
    }

    private verifyBasicAuth(authorization?: string): void {
        if (!authorization?.startsWith('Basic ')) {
            throw new BaseAppError('Webhook authorization header is missing', ErrorCode.UNAUTHORIZED, 401)
        }

        const provided = authorization.slice('Basic '.length).trim()
        const expected = this.authHeader.slice('Basic '.length)

        const providedBuffer = Buffer.from(provided)
        const expectedBuffer = Buffer.from(expected)

        const lengthsMatch = providedBuffer.length === expectedBuffer.length
        const isMatch = lengthsMatch && crypto.timingSafeEqual(providedBuffer, expectedBuffer)

        if (!isMatch) {
            throw new BaseAppError('Webhook authorization failed', ErrorCode.UNAUTHORIZED, 401)
        }
    }

    private verifySignature(rawPayload: Buffer, signatureHeader?: string): void {
        if (!signatureHeader) {
            throw new BaseAppError('Content-Signature header is missing', ErrorCode.UNAUTHORIZED, 401)
        }

        const signature = this.extractSignature(signatureHeader)

        const isValid = crypto.verify('RSA-SHA256', rawPayload, this.publicKey, Buffer.from(signature, 'base64'))

        if (!isValid) {
            throw new BaseAppError('Invalid webhook signature', ErrorCode.UNAUTHORIZED, 401)
        }
    }

    private extractSignature(header: string): string {
        const trimmed = header.trim()

        if (trimmed.includes('=')) {
            const [, value] = trimmed.split('=')
            if (value) return value
        }

        return trimmed
    }

    private formatPublicKey(key: string): string {
        const normalized = key
            .replace(/-----BEGIN PUBLIC KEY-----/g, '')
            .replace(/-----END PUBLIC KEY-----/g, '')
            .replace(/\r?\n/g, '')
            .replace(/\\n/g, '')
            .trim()

        const wrapped = normalized.match(/.{1,64}/g)?.join('\n') ?? normalized

        return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`
    }

    private extractCheckoutDetails(payload: any): CheckoutDetails {
        const checkout = payload?.checkout ?? payload ?? {}
        const order = checkout.order ?? payload?.order ?? {}
        const gatewayResponse = checkout.gateway_response ?? payload?.gateway_response ?? {}
        const payment = gatewayResponse.payment ?? checkout.payment ?? payload?.payment ?? {}

        const token = checkout.token ?? payment.token ?? payload?.token
        const status = this.normalizeStatus(payment.status ?? checkout.status ?? payload?.status ?? gatewayResponse.status)
        const uid = payment.uid ?? checkout.uid ?? gatewayResponse.uid ?? payload?.uid ?? null
        const amount =
            typeof order.amount === 'number'
                ? order.amount
                : typeof checkout.amount === 'number'
                  ? checkout.amount
                  : typeof payment.amount === 'number'
                    ? payment.amount
                    : undefined

        const currency = order.currency ?? checkout.currency ?? payment.currency ?? null
        const testMode = Boolean(
            checkout.test ?? payload?.test ?? payment.test ?? checkout.settings?.test ?? payload?.settings?.test
        )

        if (!token) {
            throw new BaseAppError('Checkout token is missing in webhook payload', ErrorCode.BAD_REQUEST, 400)
        }

        return {
            token,
            status,
            uid,
            amount,
            currency,
            testMode,
            rawPayload: payload,
        }
    }

    private async queryCheckoutStatus(token: string): Promise<CheckoutDetails> {
        try {
            const response = await this.apiClient.get<any>(`/ctp/api/checkouts/${token}`, {
                headers: this.buildRequestHeaders(),
            })

            const checkout = response?.checkout ?? response ?? {}
            const order = checkout.order ?? {}
            const gatewayResponse = checkout.gateway_response ?? {}
            const payment = gatewayResponse.payment ?? checkout.payment ?? {}

            const status = this.normalizeStatus(
                payment.status ?? checkout.status ?? checkout.state ?? gatewayResponse.status
            )
            const uid = payment.uid ?? checkout.uid ?? gatewayResponse.uid ?? null
            const amount = typeof order.amount === 'number' ? order.amount : checkout.amount
            const currency = order.currency ?? checkout.currency ?? null
            const testMode = Boolean(checkout.test ?? gatewayResponse.test ?? payment.test ?? checkout.settings?.test)

            return {
                token,
                status,
                uid,
                amount,
                currency,
                testMode,
                rawPayload: response,
            }
        } catch (error) {
            this.logger.error('Failed to reconcile Secure Processor checkout', {
                operation: 'queryCheckoutStatus',
                token,
                error: error instanceof Error ? { name: error.name, message: error.message } : undefined,
            })

            throw new BaseAppError('Unable to reconcile payment status', ErrorCode.UNKNOWN_ERROR, 502)
        }
    }

    private ensurePayloadConsistency(record: PaymentToken, checkout: CheckoutDetails): void {
        const mismatches: string[] = []

        if (checkout.amount !== undefined && Number(checkout.amount) !== Number(record.amount)) {
            mismatches.push('amount')
        }

        if (checkout.currency && checkout.currency !== record.currency) {
            mismatches.push('currency')
        }

        if (checkout.testMode !== undefined && Boolean(checkout.testMode) !== Boolean(record.testMode)) {
            mismatches.push('test flag')
        }

        if (mismatches.length > 0) {
            const message = `Checkout data mismatch: ${mismatches.join(', ')}`
            this.repository.updateByToken(record.token, {
                status: 'error',
                errorMessage: message,
                rawPayload: checkout.rawPayload,
            }).catch(() => {
                // Best-effort update; avoid blocking the request path
            })

            throw new BaseAppError(message, ErrorCode.BAD_REQUEST, 400)
        }
    }

    private buildRedirectUrl(status: PaymentTokenStatus, token: string): string {
        const searchParams = new URLSearchParams({ status, token }).toString()

        if (status === 'successful') {
            return `${this.frontendBaseUrl}/payments/secure-processor/success?${searchParams}`
        }

        if (status === 'pending') {
            return `${this.frontendBaseUrl}/payments/secure-processor/pending?${searchParams}`
        }

        return `${this.frontendBaseUrl}/payments/secure-processor/failed?${searchParams}`
    }

    private async createPlanCheckoutToken(
        params: { userId: string; planCode: SecureProcessorPlanCode; billingPeriod: SecureProcessorBillingPeriod },
        email: string
    ): Promise<CheckoutTokenResponse> {
        const pricing = this.resolvePlanPricing(params.planCode, params.billingPeriod)
        const trackingId = this.buildTrackingId(params.userId, params.planCode, params.billingPeriod)
        const normalizedEmail = email.toLowerCase()

        const body = {
            checkout: {
                test: this.testMode,
                transaction_type: 'payment',
                iframe: true,
                settings: {
                    return_url: `${this.backendBaseUrl}/payments/secure-processor/return`,
                    notification_url: `${this.backendBaseUrl}/payments/secure-processor/webhook`,
                    language: 'en',
                },
                order: {
                    currency: pricing.currency,
                    amount: pricing.amount,
                    description: pricing.description,
                    tracking_id: trackingId,
                },
            },
            order: {
                currency: pricing.currency,
                amount: pricing.amount,
                description: pricing.description,
                tracking_id: trackingId,
            },
            customer: {
                email: normalizedEmail,
            },
            payment_method: {
                types: ['credit_card'],
            },
        }

        try {
            const response = await this.apiClient.post<any>('/ctp/api/checkouts', body, {
                headers: this.buildRequestHeaders(),
            })

            const token = response?.checkout?.token ?? response?.token

            if (!token) {
                throw new BaseAppError('Secure Processor did not return a checkout token', ErrorCode.UNKNOWN_ERROR, 502)
            }

            await this.repository.create({
                token,
                tenantId: params.userId,
                planCode: params.planCode as UserPlans,
                billingPeriod: params.billingPeriod,
                amount: pricing.amount,
                currency: pricing.currency,
                description: pricing.description,
                testMode: this.testMode,
                status: 'created',
                gatewayUid: response?.checkout?.uid ?? null,
                trackingId,
                itemType: 'plan',
            })

            return {
                token,
                checkout: {
                    token,
                },
            }
        } catch (error: any) {
            const message =
                error instanceof BaseAppError
                    ? error.message
                    : error?.response?.data?.message || 'Failed to create checkout token'

            this.logger.error('Secure Processor token creation failed', {
                operation: 'createPlanCheckoutToken',
                userId: params.userId,
                error: error instanceof Error ? { name: error.name, message: error.message } : message,
            })

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError(message, ErrorCode.UNKNOWN_ERROR, 502)
        }
    }

    private async createAddonCheckoutToken(
        params: { userId: string; addonCode: SecureProcessorAddonCode },
        email: string
    ): Promise<CheckoutTokenResponse> {
        const pricing = this.resolveAddonPricing(params.addonCode)
        const plan = await this.userService.getUserPlan(params.userId)
        const trackingId = this.buildAddonTrackingId(params.userId, params.addonCode)
        const normalizedEmail = email.toLowerCase()

        if (!plan) {
            throw new BaseAppError('Active plan is required before purchasing add-ons', ErrorCode.BAD_REQUEST, 400)
        }

        const body = {
            checkout: {
                test: this.testMode,
                transaction_type: 'payment',
                iframe: true,
                settings: {
                    return_url: `${this.backendBaseUrl}/payments/secure-processor/return`,
                    notification_url: `${this.backendBaseUrl}/payments/secure-processor/webhook`,
                    language: 'en',
                },
                order: {
                    currency: pricing.currency,
                    amount: pricing.amount,
                    description: pricing.description,
                    tracking_id: trackingId,
                },
            },
            order: {
                currency: pricing.currency,
                amount: pricing.amount,
                description: pricing.description,
                tracking_id: trackingId,
            },
            customer: {
                email: normalizedEmail,
            },
            payment_method: {
                types: ['credit_card'],
            },
        }

        try {
            const response = await this.apiClient.post<any>('/ctp/api/checkouts', body, {
                headers: this.buildRequestHeaders(),
            })

            const token = response?.checkout?.token ?? response?.token

            if (!token) {
                throw new BaseAppError('Secure Processor did not return a checkout token', ErrorCode.UNKNOWN_ERROR, 502)
            }

            await this.repository.create({
                token,
                tenantId: params.userId,
                planCode: plan.planName,
                billingPeriod: plan.planType,
                amount: pricing.amount,
                currency: pricing.currency,
                description: pricing.description,
                testMode: this.testMode,
                status: 'created',
                gatewayUid: response?.checkout?.uid ?? null,
                trackingId,
                itemType: 'addon',
                addonCode: params.addonCode,
                usageDeltas: pricing.usageDeltas,
            })

            return {
                token,
                checkout: {
                    token,
                },
            }
        } catch (error: any) {
            const message =
                error instanceof BaseAppError
                    ? error.message
                    : error?.response?.data?.message || 'Failed to create add-on checkout token'

            this.logger.error('Secure Processor add-on token creation failed', {
                operation: 'createAddonCheckoutToken',
                userId: params.userId,
                addonCode: params.addonCode,
                error: error instanceof Error ? { name: error.name, message: error.message } : message,
            })

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError(message, ErrorCode.UNKNOWN_ERROR, 502)
        }
    }
}
