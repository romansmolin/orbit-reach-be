import { PaymentTokenStatus } from '@/entities/payment-token'

export type SecureProcessorPlanCode = 'STARTER' | 'PRO'
export type SecureProcessorBillingPeriod = 'monthly' | 'yearly'
export type SecureProcessorItemType = 'plan' | 'addon'
export type SecureProcessorAddonCode = 'EXTRA_POSTS_100' | 'EXTRA_SCHEDULES_100' | 'EXTRA_AI_50'

export interface CheckoutTokenResponse {
    token: string
    checkout: {
        token: string
    }
}

export interface ReturnHandlingResult {
    status: PaymentTokenStatus
    redirectUrl: string
}

export type CreatePlanCheckoutParams = {
    itemType?: 'plan'
    userId: string
    planCode: SecureProcessorPlanCode
    billingPeriod: SecureProcessorBillingPeriod
}

export type CreateAddonCheckoutParams = {
    itemType: 'addon'
    userId: string
    addonCode: SecureProcessorAddonCode
}

export type CreateCheckoutParams = CreatePlanCheckoutParams | CreateAddonCheckoutParams

export interface ISecureProcessorPaymentService {
    createCheckoutToken(params: CreateCheckoutParams): Promise<CheckoutTokenResponse>
    handleReturn(params: {
        token: string
        status?: string | null
        uid?: string | null
    }): Promise<ReturnHandlingResult>
    processWebhook(rawPayload: Buffer, headers: { authorization?: string; contentSignature?: string }): Promise<void>
}
