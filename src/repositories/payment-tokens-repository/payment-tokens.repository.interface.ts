import { PaymentToken, PaymentTokenItemType, PaymentTokenStatus, UsageDeltas } from '@/entities/payment-token'
import { UserPlans } from '@/shared/consts/plans'

export interface PaymentTokenCreateInput {
    token: string
    tenantId: string
    planCode: UserPlans
    billingPeriod: 'monthly' | 'yearly'
    amount: number
    currency: string
    description?: string | null
    testMode: boolean
    status?: PaymentTokenStatus
    gatewayUid?: string | null
    trackingId?: string | null
    rawPayload?: unknown | null
    itemType?: PaymentTokenItemType
    addonCode?: string | null
    usageDeltas?: UsageDeltas | null
}

export interface PaymentTokenUpdateInput {
    status?: PaymentTokenStatus
    gatewayUid?: string | null
    rawPayload?: unknown | null
    errorMessage?: string | null
    testMode?: boolean
    usageDeltas?: UsageDeltas | null
}

export interface IPaymentTokensRepository {
    create(data: PaymentTokenCreateInput): Promise<PaymentToken>
    findByToken(token: string): Promise<PaymentToken | null>
    updateByToken(token: string, updates: PaymentTokenUpdateInput): Promise<PaymentToken | null>
}
