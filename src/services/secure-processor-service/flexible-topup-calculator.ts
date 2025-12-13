import { UsageDeltas } from '@/entities/payment-token'

type UsageRate = {
    upToCents: number
    postsPerEuro: number
    schedulesPerEuro: number
    aiPerEuro: number
}

const FLEXIBLE_USAGE_RATES: UsageRate[] = [
    { upToCents: 1000, postsPerEuro: 20, schedulesPerEuro: 10, aiPerEuro: 5 },
    { upToCents: 3000, postsPerEuro: 30, schedulesPerEuro: 18, aiPerEuro: 8 },
    { upToCents: Number.MAX_SAFE_INTEGER, postsPerEuro: 45, schedulesPerEuro: 25, aiPerEuro: 12 },
]

export const FLEXIBLE_TOP_UP_MIN_CENTS = 100
export const FLEXIBLE_TOP_UP_MAX_CENTS = 1_000_000

export function calculateFlexibleTopUpUsage(amountCents: number): UsageDeltas {
    let remaining = Math.max(0, amountCents)
    let processed = 0

    const deltas = {
        sentPosts: 0,
        scheduledPosts: 0,
        aiRequests: 0,
    }

    for (const tier of FLEXIBLE_USAGE_RATES) {
        if (remaining <= 0) break

        const tierCapacity = Math.max(0, tier.upToCents - processed)
        const amountInTier = Math.min(remaining, tierCapacity)

        if (amountInTier > 0) {
            deltas.sentPosts += Math.floor((tier.postsPerEuro * amountInTier) / 100)
            deltas.scheduledPosts += Math.floor((tier.schedulesPerEuro * amountInTier) / 100)
            deltas.aiRequests += Math.floor((tier.aiPerEuro * amountInTier) / 100)
        }

        remaining -= amountInTier
        processed += amountInTier
    }

    return deltas
}
