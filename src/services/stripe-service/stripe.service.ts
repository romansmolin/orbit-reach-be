import Stripe from 'stripe'
import { IStripeService, StripeSubscriptionUpdatePayload } from './stripe.service.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { getStripeConfigVar } from '@/shared/utils/get-stripe-config'

export class StripeService implements IStripeService {
    private readonly stripeClient: Stripe

    constructor(stripeSecretKey = getStripeConfigVar('STRIPE_SECRET_KEY')) {
        if (!stripeSecretKey) {
            throw new BaseAppError('Stripe secret key is not configured', ErrorCode.UNKNOWN_ERROR, 500)
        }

        this.stripeClient = new Stripe(stripeSecretKey)
    }

    async retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
        try {
            return await this.stripeClient.subscriptions.retrieve(subscriptionId)
        } catch (error) {
            throw this.wrapStripeError('Failed to retrieve Stripe subscription', error)
        }
    }

    async updateSubscription(payload: StripeSubscriptionUpdatePayload): Promise<Stripe.Subscription> {
        try {
            return await this.stripeClient.subscriptions.update(payload.subscriptionId, {
                items: [
                    {
                        id: payload.subscriptionItemId,
                        price: payload.priceId,
                    },
                ],
                proration_behavior: payload.prorationBehavior ?? 'create_prorations',
                cancel_at_period_end: payload.cancelAtPeriodEnd,
            })
        } catch (error) {
            throw this.wrapStripeError('Failed to update Stripe subscription', error)
        }
    }

    async scheduleSubscriptionCancellation(subscriptionId: string): Promise<Stripe.Subscription> {
        try {
            return await this.stripeClient.subscriptions.update(subscriptionId, {
                cancel_at_period_end: true,
            })
        } catch (error) {
            throw this.wrapStripeError('Failed to schedule Stripe subscription cancellation', error)
        }
    }

    async setSubscriptionMetadata(subscriptionId: string, metadata: Stripe.MetadataParam): Promise<void> {
        try {
            await this.stripeClient.subscriptions.update(subscriptionId, {
                metadata,
            })
        } catch (error) {
            throw this.wrapStripeError('Failed to update Stripe subscription metadata', error)
        }
    }

    async createSubscription(
        customerId: string,
        priceId: string,
        metadata?: Stripe.MetadataParam
    ): Promise<Stripe.Subscription> {
        try {
            return await this.stripeClient.subscriptions.create({
                customer: customerId,
                items: [{ price: priceId }],
                metadata,
            })
        } catch (error) {
            throw this.wrapStripeError('Failed to create Stripe subscription', error)
        }
    }

    private wrapStripeError(message: string, error: unknown): BaseAppError {
        if (error instanceof BaseAppError) {
            return error
        }

        if (error instanceof Error) {
            return new BaseAppError(`${message}: ${error.message}`, ErrorCode.UNKNOWN_ERROR, 502)
        }

        return new BaseAppError(message, ErrorCode.UNKNOWN_ERROR, 502)
    }
}
