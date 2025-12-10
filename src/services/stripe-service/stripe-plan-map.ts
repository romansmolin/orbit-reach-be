import { UserPlans } from '@/shared/consts/plans'
const isProduction = process.env.STRIPE_ENV === 'production'

export const STRIPE_PRODUCT_PLAN_MAP: Record<string, UserPlans> = {
    'prod_TPToGP1A9b3Bgo': UserPlans.PRO,
    'prod_TPTxTxQb8y9HjZ': UserPlans.STARTER,
}

export const STRIPE_PRODUCT_PLAN_MAP_DEV: Record<string, UserPlans> = {
    'prod_TQ8yxCGteCFSWT': UserPlans.PRO,
    'prod_TQ8vJBOdasHZnh': UserPlans.STARTER,
}

export const resolvePlanFromProduct = (productId?: string | null): UserPlans | undefined => {
    if (!productId) {
        return undefined
    }

    return  isProduction ? STRIPE_PRODUCT_PLAN_MAP[productId] : STRIPE_PRODUCT_PLAN_MAP_DEV[productId]
}
