import { SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { UserPlans } from '@/shared/consts/plans'

export class UserPlan {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly planName: UserPlans,
        public readonly planType: 'monthly' | 'yearly',
        public readonly sendPostsLimit: number,
        public readonly scheduledPostsLimit: number,
        public readonly platformAllowed: SocilaMediaPlatform[],
        public readonly startDate: Date,
        public readonly endDate: Date | null,
        public readonly isActive: boolean,
        public readonly stripeSubscriptionId: string | null,
        public readonly stripePriceId: string | null,
        public readonly status: string | null,
        public readonly currentPeriodEnd: Date | null,
        public readonly stripeLookupKey: string | null,
        public readonly accountsLimit: number | null,
        public readonly aiRequestsLimit: number | null,
        public readonly billingStatus: string
    ) {}
}
