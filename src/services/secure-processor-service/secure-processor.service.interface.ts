import { PaymentTokenStatus } from '@/entities/payment-token'

export type SecureProcessorPlanCode = 'STARTER' | 'PRO'
export type SecureProcessorBillingPeriod = 'monthly' | 'yearly'
export type SecureProcessorItemType = 'plan' | 'addon'
export type SecureProcessorAddonCode = 'EXTRA_SMALL' | 'EXTRA_MEDIUM' | 'EXTRA_LARGE' | 'FLEX_TOP_UP'

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
    addonCode: 'EXTRA_SMALL' | 'EXTRA_MEDIUM' | 'EXTRA_LARGE'
    promoCode?: string
} | {
    itemType: 'addon'
    userId: string
    addonCode: 'FLEX_TOP_UP'
    amount: number
    currency?: 'EUR'
    promoCode?: string
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
