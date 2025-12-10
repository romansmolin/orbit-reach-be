import Stripe from 'stripe'
import { IStripeWebhookService } from './stripe.service.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { IUserService } from '@/services/users-service/user.service.interface'
import { resolvePlanFromProduct } from './stripe-plan-map'
import { UserPlans } from '@/shared/consts/plans'

type InvoiceLegacyFields = Stripe.Invoice & {
    paid?: boolean
    subscription?: string | Stripe.Subscription | null
}

type InvoiceLineItemLegacy = Stripe.InvoiceLineItem & {
    price?: Stripe.Price | null
}

export class StripeWebhookService implements IStripeWebhookService {
    constructor(
        private readonly stripeClient: Stripe,
        private readonly webhookSigningSecret: string,
        private readonly userService: IUserService
    ) {
        if (!webhookSigningSecret) {
            throw new BaseAppError(
                'Stripe webhook signing secret is not configured',
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        }
    }

    constructEvent(payload: Buffer, signature: string): Stripe.Event {
        if (!signature) {
            throw new BaseAppError('Stripe signature header is missing', ErrorCode.BAD_REQUEST, 400)
        }

        try {
            return this.stripeClient.webhooks.constructEvent(payload, signature, this.webhookSigningSecret)
        } catch (error) {
            throw new BaseAppError(
                'Failed to verify Stripe webhook signature',
                ErrorCode.BAD_REQUEST,
                400
            )
        }
    }

    async processCheckoutSessionCompleted(event: Stripe.Event): Promise<void> {
        if (event.type !== 'checkout.session.completed') {
            throw new BaseAppError(
                `Unsupported Stripe event type: ${event.type}`,
                ErrorCode.BAD_REQUEST,
                400
            )
        }

        const session = event.data.object as Stripe.Checkout.Session

        if (!session?.id) {
            throw new BaseAppError(
                'Stripe checkout session identifier is missing',
                ErrorCode.BAD_REQUEST,
                400
            )
        }

        const enrichedSession = await this.stripeClient.checkout.sessions.retrieve(session.id, {
            expand: ['line_items', 'subscription']
        })

        const [firstLineItem] = enrichedSession.line_items?.data ?? []
        const price = firstLineItem?.price
        const productId = typeof price?.product === 'string' ? price.product : undefined

        const planName = productId ? resolvePlanFromProduct(productId) : undefined

        if (!planName) {
            throw new BaseAppError(
                `Unsupported Stripe product identifier: ${productId ?? 'unknown'}`,
                ErrorCode.BAD_REQUEST,
                400
            )
        }

        const planType = this.resolvePlanType(price?.recurring?.interval)

        if (!planType) {
            throw new BaseAppError(
                'Unsupported Stripe billing interval for checkout session',
                ErrorCode.BAD_REQUEST,
                400
            )
        }

        const subscription = await this.resolveSubscription(enrichedSession.subscription)
        const subscriptionId = subscription.id
        const currentPeriodStart = this.getSubscriptionPeriodStart(subscription)
        const currentPeriodEnd = this.getSubscriptionPeriodEnd(subscription)
        const stripeCustomerId = this.extractCustomerId(subscription.customer)

        const tenantId = await this.resolveTenantId(enrichedSession, subscription, stripeCustomerId)

        await this.ensureSubscriptionMetadata(subscription, tenantId)

        await this.userService.updateCustomerPlan(tenantId, {
            name: planName,
            planType,
            startDate: currentPeriodStart ?? undefined,
            endDate: currentPeriodEnd ?? undefined,
            stripeSubscriptionId: subscriptionId,
            stripePriceId: price?.id ?? null,
            subscriptionStatus: subscription.status ?? null,
            currentPeriodEnd,
            stripeLookupKey: price?.lookup_key ?? null,
            billingStatus: 'active',
            stripeCustomerId,
        })
    }

    async processInvoicePaid(event: Stripe.Event): Promise<void> {
        if (event.type !== 'invoice.paid') {
            throw new BaseAppError(
                `Unsupported Stripe event type: ${event.type}`,
                ErrorCode.BAD_REQUEST,
                400
            )
        }

        const invoice = event.data.object as InvoiceLegacyFields

        if (!invoice?.paid || invoice.status !== 'paid') {
            return
        }

        if (!invoice.subscription) {
            throw new BaseAppError('Invoice is not linked to a subscription', ErrorCode.BAD_REQUEST, 400)
        }

        if (invoice.billing_reason && invoice.billing_reason !== 'subscription_cycle') {
            return
        }

        const price = this.extractInvoicePrice(invoice)
        const productId = typeof price?.product === 'string' ? price.product : undefined
        const planName = productId ? resolvePlanFromProduct(productId) : undefined

        if (!planName) {
            throw new BaseAppError('Unable to resolve plan from invoice price', ErrorCode.BAD_REQUEST, 400)
        }

        if (planName === UserPlans.FREE) {
            return
        }

        const planType = this.resolvePlanType(price?.recurring?.interval) ?? 'monthly'

        const subscription = await this.resolveSubscription(invoice.subscription)
        const tenantId = typeof subscription.metadata?.tenantId === 'string' ? subscription.metadata.tenantId : undefined

        if (!tenantId) {
            throw new BaseAppError('Stripe subscription is missing tenant metadata', ErrorCode.BAD_REQUEST, 400)
        }

        const { startDate, endDate } = this.resolveInvoicePeriod(invoice)
        const stripeCustomerId = this.extractCustomerId(subscription.customer)

        await this.userService.handleSubscriptionRenewal({
            tenantId,
            planName,
            planType,
            stripeSubscriptionId: subscription.id,
            stripePriceId: price?.id ?? null,
            stripeLookupKey: price?.lookup_key ?? null,
            periodStart: startDate,
            periodEnd: endDate,
            stripeCustomerId,
        })
    }

    async processInvoiceUpcoming(event: Stripe.Event): Promise<void> {
        if (event.type !== 'invoice.upcoming') {
            throw new BaseAppError(
                `Unsupported Stripe event type: ${event.type}`,
                ErrorCode.BAD_REQUEST,
                400
            )
        }

        const invoice = event.data.object as InvoiceLegacyFields

        if (!invoice.subscription) {
            throw new BaseAppError('Invoice is not linked to a subscription', ErrorCode.BAD_REQUEST, 400)
        }

        const price = this.extractInvoicePrice(invoice)
        const productId = typeof price?.product === 'string' ? price.product : undefined
        const planName = productId ? resolvePlanFromProduct(productId) : undefined

        if (!planName) {
            throw new BaseAppError('Unable to resolve plan from upcoming invoice price', ErrorCode.BAD_REQUEST, 400)
        }

        const planType = this.resolvePlanType(price?.recurring?.interval) ?? 'monthly'
        const subscription = await this.resolveSubscription(invoice.subscription)
        const stripeCustomerId = this.extractCustomerId(invoice.customer ?? subscription.customer)

        let tenantId = typeof subscription.metadata?.tenantId === 'string' ? subscription.metadata.tenantId : null

        if (!tenantId && stripeCustomerId) {
            try {
                const user = await this.userService.findUserByStripeCustomerId(stripeCustomerId)
                tenantId = user?.id ?? null
            } catch (error) {
                if (!(error instanceof BaseAppError && error.code === ErrorCode.NOT_FOUND)) {
                    throw error
                }
            }
        }

        if (!tenantId) {
            throw new BaseAppError('Unable to resolve tenant for upcoming invoice', ErrorCode.BAD_REQUEST, 400)
        }

        const trialStart = new Date()
        const trialEnd = new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000)

        await this.userService.updateCustomerPlan(tenantId, {
            name: planName,
            planType,
            startDate: trialStart,
            endDate: trialEnd,
            currentPeriodEnd: trialEnd,
            stripeSubscriptionId: subscription.id,
            stripePriceId: price?.id ?? null,
            stripeLookupKey: price?.lookup_key ?? null,
            stripeCustomerId,
            subscriptionStatus: subscription.status ?? null,
            billingStatus: 'trialing',
        })
    }

    private resolvePlanType(interval?: Stripe.Price.Recurring.Interval | null): 'monthly' | 'yearly' | null {
        if (!interval) {
            return null
        }

        if (interval === 'month') {
            return 'monthly'
        }

        if (interval === 'year') {
            return 'yearly'
        }

        return null
    }

    private async resolveSubscription(
        subscriptionRef: string | Stripe.Subscription | null | undefined
    ): Promise<Stripe.Subscription> {
        if (!subscriptionRef) {
            throw new BaseAppError(
                'Stripe subscription reference is missing for checkout session',
                ErrorCode.BAD_REQUEST,
                400
            )
        }

        if (typeof subscriptionRef === 'string') {
            return await this.stripeClient.subscriptions.retrieve(subscriptionRef)
        }

        return subscriptionRef
    }

    private getSubscriptionPeriodStart(subscription: Stripe.Subscription): Date | null {
        const subscriptionWithLegacyFields = subscription as Stripe.Subscription & {
            current_period_start?: number | null
        }
        const currentPeriodStart = subscriptionWithLegacyFields.current_period_start

        if (typeof currentPeriodStart !== 'number') {
            return null
        }

        return new Date(currentPeriodStart * 1000)
    }

    private getSubscriptionPeriodEnd(subscription: Stripe.Subscription): Date | null {
        const subscriptionWithLegacyFields = subscription as Stripe.Subscription & {
            current_period_end?: number | null
        }
        const currentPeriodEnd = subscriptionWithLegacyFields.current_period_end

        if (typeof currentPeriodEnd !== 'number') {
            return null
        }

        return new Date(currentPeriodEnd * 1000)
    }

    async processSubscriptionDeleted(event: Stripe.Event): Promise<void> {
        if (event.type !== 'customer.subscription.deleted') {
            throw new BaseAppError(
                `Unsupported Stripe event type: ${event.type}`,
                ErrorCode.BAD_REQUEST,
                400
            )
        }

        const subscription = event.data.object as Stripe.Subscription

        if (!subscription?.id) {
            throw new BaseAppError('Subscription identifier is missing in webhook payload', ErrorCode.BAD_REQUEST, 400)
        }

        const tenantId = typeof subscription.metadata?.tenantId === 'string' ? subscription.metadata.tenantId : undefined

        await this.userService.handleSubscriptionCancelled(subscription.id, tenantId)
    }

    private async ensureSubscriptionMetadata(subscription: Stripe.Subscription, tenantId: string): Promise<void> {
        if (subscription.metadata?.tenantId === tenantId) {
            return
        }

        await this.stripeClient.subscriptions.update(subscription.id, {
            metadata: {
                ...(subscription.metadata ?? {}),
                tenantId,
            },
        })
    }

    private extractCustomerId(
        customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined
    ): string | null {
        if (!customer) {
            return null
        }

        if (typeof customer === 'string') {
            return customer
        }

        if ('id' in customer) {
            return customer.id
        }

        return null
    }

    private extractInvoicePrice(invoice: Stripe.Invoice): Stripe.Price | null {
        const firstLine = invoice.lines?.data?.[0] as InvoiceLineItemLegacy | undefined
        return firstLine?.price ?? null
    }

    private resolveInvoicePeriod(invoice: Stripe.Invoice): { startDate: Date; endDate: Date } {
        const linePeriod = invoice.lines?.data?.[0]?.period
        const startTimestamp = linePeriod?.start ?? invoice.period_start ?? Math.floor(Date.now() / 1000)
        const endTimestamp = linePeriod?.end ?? invoice.period_end ?? Math.floor(Date.now() / 1000)

        return {
            startDate: new Date(startTimestamp * 1000),
            endDate: new Date(endTimestamp * 1000),
        }
    }

    private normalizeTenantIdentifier(value?: string | null): string | null {
        if (typeof value !== 'string') {
            return null
        }

        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : null
    }

    private async resolveTenantId(
        session: Stripe.Checkout.Session,
        subscription: Stripe.Subscription,
        stripeCustomerId: string | null
    ): Promise<string> {
        const directRef = this.normalizeTenantIdentifier(session.client_reference_id)
        if (directRef) return directRef

        const sessionMetadataRef = this.normalizeTenantIdentifier(session.metadata?.tenantId)
        if (sessionMetadataRef) return sessionMetadataRef

        const subscriptionMetadataRef = this.normalizeTenantIdentifier(subscription.metadata?.tenantId)
        if (subscriptionMetadataRef) return subscriptionMetadataRef

        if (stripeCustomerId) {
            try {
                const user = await this.userService.findUserByStripeCustomerId(stripeCustomerId)
                if (user) return user.id
            } catch (error) {
                if (error instanceof BaseAppError && error.code === ErrorCode.NOT_FOUND) {
                    // fallback to next strategy
                } else {
                    throw error
                }
            }
        }

        const email = this.normalizeTenantIdentifier(session.customer_details?.email?.toLowerCase())
        if (email) {
            try {
                const user = await this.userService.findUserByEmail(email)
                if (user) return user.id
            } catch (error) {
                if (error instanceof BaseAppError && error.code === ErrorCode.NOT_FOUND) {
                    // continue
                } else {
                    throw error
                }
            }
        }

        throw new BaseAppError(
            'Stripe checkout session is missing client reference identifier',
            ErrorCode.BAD_REQUEST,
            400
        )
    }
}
