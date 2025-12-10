import Stripe from 'stripe'

export interface IStripeWebhookService {
    constructEvent(payload: Buffer, signature: string): Stripe.Event
    processCheckoutSessionCompleted(event: Stripe.Event): Promise<void>
    processSubscriptionDeleted(event: Stripe.Event): Promise<void>
    processInvoicePaid(event: Stripe.Event): Promise<void>
    processInvoiceUpcoming(event: Stripe.Event): Promise<void>
}

export interface StripeSubscriptionUpdatePayload {
    subscriptionId: string
    subscriptionItemId: string
    priceId: string
    prorationBehavior?: Stripe.SubscriptionUpdateParams.ProrationBehavior
    cancelAtPeriodEnd?: boolean
}

export interface IStripeService {
    retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>
    updateSubscription(payload: StripeSubscriptionUpdatePayload): Promise<Stripe.Subscription>
    scheduleSubscriptionCancellation(subscriptionId: string): Promise<Stripe.Subscription>
    setSubscriptionMetadata(subscriptionId: string, metadata: Stripe.MetadataParam): Promise<void>
    createSubscription(
        customerId: string,
        priceId: string,
        metadata?: Stripe.MetadataParam
    ): Promise<Stripe.Subscription>
}
