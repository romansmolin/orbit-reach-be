import crypto from 'crypto'
import { AxiosApiClient, IApiClient } from '@/shared/infra/api'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { getEnvVar } from '@/shared/utils/get-env-var'
import { IPaymentTokensRepository } from '@/repositories/payment-tokens-repository'
import { IUserService } from '@/services/users-service/user.service.interface'
import { PaymentToken, PaymentTokenStatus, UsageDeltas } from '@/entities/payment-token'
import { IPromoCodesService } from '@/services/promo-codes-service/promo-codes.service.interface'
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
import {
    FLEXIBLE_TOP_UP_MAX_CENTS,
    FLEXIBLE_TOP_UP_MIN_CENTS,
    calculateFlexibleTopUpUsage,
} from './flexible-topup-calculator'

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
        Exclude<SecureProcessorAddonCode, 'FLEX_TOP_UP'>,
        { amount: number; currency: string; description: string; usageDeltas: UsageDeltas }
    > = {
        EXTRA_SMALL: {
            amount: 100,
            currency: 'EUR',
            description: 'Extra Small Usage Package',
            usageDeltas: { sentPosts: 20, scheduledPosts: 10, aiRequests: 10 },
        },
        EXTRA_MEDIUM: {
            amount: 500,
            currency: 'EUR',
            description: 'Extra Medium Usage Package',
            usageDeltas: { sentPosts: 100, scheduledPosts: 80, aiRequests: 30 },
        },
        EXTRA_LARGE: {
            amount: 1000,
            currency: 'EUR',
            description: 'Extra Large Usage Package',
            usageDeltas: { sentPosts: 500, scheduledPosts: 450, aiRequests: 100 },
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
    private readonly promoCodesService?: IPromoCodesService

    constructor(
        repository: IPaymentTokensRepository,
        userService: IUserService,
        logger: ILogger,
        apiClient: IApiClient = new AxiosApiClient('https://checkout.secure-processor.com'),
        promoCodesService?: IPromoCodesService
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
        this.promoCodesService = promoCodesService
    }

    async createCheckoutToken(params: CreateCheckoutParams): Promise<CheckoutTokenResponse> {
        const userData = await this.userService.findUserById(params.userId)

        if (!userData?.user?.email) {
            throw new BaseAppError('User email is required for payment', ErrorCode.BAD_REQUEST, 400)
        }

        if (params.itemType === 'addon') {
            if (params.addonCode === 'FLEX_TOP_UP') {
                return this.createFlexibleTopUpCheckoutToken(params, userData.user.email)
            }

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

            if (record.promoCodeId && this.promoCodesService) {
                try {
                    await this.promoCodesService.recordUsage(record.promoCodeId)
                } catch (error) {
                    this.logger.error('Failed to record promo code usage', {
                        operation: 'applyFulfillment',
                        promoCodeId: record.promoCodeId,
                        error: error instanceof Error ? { name: error.name, message: error.message } : undefined,
                    })
                }
            }
            return
        }

        // Plans are no longer supported
        this.logger.warn('Attempted to apply plan fulfillment, but plans are no longer supported', {
            operation: 'applyFulfillment',
            recordId: record.id,
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

    private resolveAddonPricing(addonCode: Exclude<SecureProcessorAddonCode, 'FLEX_TOP_UP'>): {
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

    private async createFlexibleTopUpCheckoutToken(
        params: { userId: string; addonCode: 'FLEX_TOP_UP'; amount: number; currency?: 'EUR'; promoCode?: string },
        email: string
    ): Promise<CheckoutTokenResponse> {
        const currency = params.currency ?? 'EUR'
        const amountCents = this.normalizeFlexibleAmount(params.amount)
        const usageDeltas = calculateFlexibleTopUpUsage(amountCents)
        const plan = await this.userService.getUserPlan(params.userId)
        const trackingId = this.buildAddonTrackingId(params.userId, params.addonCode)
        const normalizedEmail = email.toLowerCase()

        if (currency !== 'EUR') {
            throw new BaseAppError('Only EUR payments are supported for this top-up', ErrorCode.BAD_REQUEST, 400)
        }

        if (!plan) {
            throw new BaseAppError('Active plan is required before purchasing add-ons', ErrorCode.BAD_REQUEST, 400)
        }

        let originalAmount = amountCents
        let finalAmount = amountCents
        let discountAmount = 0
        let promoCodeId: string | null = null

        if (params.promoCode && this.promoCodesService) {
            try {
                const promoResult = await this.promoCodesService.validateAndApply(params.promoCode, originalAmount)
                finalAmount = promoResult.finalAmount
                discountAmount = promoResult.discountAmount
                promoCodeId = promoResult.promoCode.id
            } catch (error) {
                if (error instanceof BaseAppError) {
                    throw error
                }
                throw new BaseAppError('Failed to apply promo code', ErrorCode.UNKNOWN_ERROR, 500)
            }
        }

        const description = `Flexible usage top-up (€${(finalAmount / 100).toFixed(2)})`

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
                    currency,
                    amount: finalAmount,
                    description,
                    tracking_id: trackingId,
                },
            },
            order: {
                currency,
                amount: finalAmount,
                description,
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
                amount: finalAmount,
                currency,
                description,
                testMode: this.testMode,
                status: 'created',
                gatewayUid: response?.checkout?.uid ?? null,
                trackingId,
                itemType: 'addon',
                addonCode: params.addonCode,
                usageDeltas,
                promoCodeId,
                originalAmount: discountAmount > 0 ? originalAmount : null,
                discountAmount,
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
                    : error?.response?.data?.message || 'Failed to create flexible top-up checkout token'

            this.logger.error('Secure Processor flexible top-up token creation failed', {
                operation: 'createFlexibleTopUpCheckoutToken',
                userId: params.userId,
                amountCents,
                currency,
                error: error instanceof Error ? { name: error.name, message: error.message } : message,
            })

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError(message, ErrorCode.UNKNOWN_ERROR, 502)
        }
    }

    private normalizeFlexibleAmount(amount: number): number {
        if (!Number.isFinite(amount)) {
            throw new BaseAppError('Payment amount must be a valid number', ErrorCode.BAD_REQUEST, 400)
        }

        const normalized = Number(amount.toFixed(2))

        if (Math.abs(normalized - amount) > 0.000001) {
            throw new BaseAppError('Amount must have at most two decimal places', ErrorCode.BAD_REQUEST, 400)
        }

        const cents = Math.round(normalized * 100)

        if (cents < FLEXIBLE_TOP_UP_MIN_CENTS) {
            throw new BaseAppError(
                `Minimum top-up is ${(FLEXIBLE_TOP_UP_MIN_CENTS / 100).toFixed(2)} EUR`,
                ErrorCode.BAD_REQUEST,
                400
            )
        }

        if (cents > FLEXIBLE_TOP_UP_MAX_CENTS) {
            throw new BaseAppError(
                `Maximum top-up is ${(FLEXIBLE_TOP_UP_MAX_CENTS / 100).toFixed(2)} EUR`,
                ErrorCode.BAD_REQUEST,
                400
            )
        }

        return cents
    }

    private async createAddonCheckoutToken(
        params: { userId: string; addonCode: Exclude<SecureProcessorAddonCode, 'FLEX_TOP_UP'>; promoCode?: string },
        email: string
    ): Promise<CheckoutTokenResponse> {
        const pricing = this.resolveAddonPricing(params.addonCode)
        const plan = await this.userService.getUserPlan(params.userId)
        const trackingId = this.buildAddonTrackingId(params.userId, params.addonCode)
        const normalizedEmail = email.toLowerCase()

        if (!plan) {
            throw new BaseAppError('Active plan is required before purchasing add-ons', ErrorCode.BAD_REQUEST, 400)
        }

        let originalAmount = pricing.amount
        let finalAmount = pricing.amount
        let discountAmount = 0
        let promoCodeId: string | null = null

        if (params.promoCode && this.promoCodesService) {
            try {
                const promoResult = await this.promoCodesService.validateAndApply(params.promoCode, originalAmount)
                finalAmount = promoResult.finalAmount
                discountAmount = promoResult.discountAmount
                promoCodeId = promoResult.promoCode.id
            } catch (error) {
                if (error instanceof BaseAppError) {
                    throw error
                }
                throw new BaseAppError('Failed to apply promo code', ErrorCode.UNKNOWN_ERROR, 500)
            }
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
                    amount: finalAmount,
                    description: pricing.description,
                    tracking_id: trackingId,
                },
            },
            order: {
                currency: pricing.currency,
                amount: finalAmount,
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
                amount: finalAmount,
                currency: pricing.currency,
                description: pricing.description,
                testMode: this.testMode,
                status: 'created',
                gatewayUid: response?.checkout?.uid ?? null,
                trackingId,
                itemType: 'addon',
                addonCode: params.addonCode,
                usageDeltas: pricing.usageDeltas,
                promoCodeId,
                originalAmount: discountAmount > 0 ? originalAmount : null,
                discountAmount,
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
