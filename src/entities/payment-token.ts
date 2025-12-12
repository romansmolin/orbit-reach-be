import { UserPlans } from '@/shared/consts/plans'

export type PaymentTokenStatus = 'created' | 'pending' | 'successful' | 'failed' | 'declined' | 'expired' | 'error'
export type PaymentTokenItemType = 'plan' | 'addon'

export type UsageDeltas = {
    sentPosts?: number
    scheduledPosts?: number
    aiRequests?: number
}

export class PaymentToken {
    constructor(
        public readonly id: string,
        public readonly token: string,
        public readonly tenantId: string,
        public readonly planCode: UserPlans,
        public readonly billingPeriod: 'monthly' | 'yearly',
        public readonly amount: number,
        public readonly currency: string,
        public readonly description: string | null,
        public readonly testMode: boolean,
        public readonly status: PaymentTokenStatus,
        public readonly gatewayUid: string | null,
        public readonly trackingId: string | null,
        public readonly rawPayload: unknown | null,
        public readonly errorMessage: string | null,
        public readonly createdAt: Date,
        public readonly updatedAt: Date,
        public readonly itemType: PaymentTokenItemType,
        public readonly addonCode: string | null,
        public readonly usageDeltas: UsageDeltas | null
    ) {}
}
