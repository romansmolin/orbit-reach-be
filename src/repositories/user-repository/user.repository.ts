import { Pool } from 'pg'
import { pgClient } from '../../db-connection'
import { User } from '../../entities/tenant'
import { BaseAppError } from '../../shared/errors/base-error'
import type { IUserRepository, MagicLinkPromoType, MagicLinkRecord } from './user.repository.interface'
import { ErrorCode } from '../../shared/consts/error-codes.const'
import { UserPlan } from '@/entities/user-plan'
import { SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { UserPlans } from '@/shared/consts/plans'
import { v4 as uuidv4 } from 'uuid'
import { ILogger } from '@/shared/infra/logger'
export class UserRepository implements IUserRepository {
    private client: Pool
    private logger: ILogger

    constructor(logger: ILogger) {
        this.client = pgClient()
        this.logger = logger
    }

    private mapRowToMagicLink(row: any): MagicLinkRecord {
        return {
            id: row.id,
            tokenId: row.token_id,
            tokenHash: row.token_hash,
            expiresAt: new Date(row.expires_at),
            promoType: row.promo_type as MagicLinkPromoType,
            promoDurationDays: Number(row.promo_duration_days),
            maxUses: Number(row.max_uses),
            redeemedCount: Number(row.redeemed_count ?? 0),
            redeemedAt: row.redeemed_at ? new Date(row.redeemed_at) : null,
            redeemedByUserId: row.redeemed_by_user_id ?? null,
        }
    }

    async findExpiredPlans(): Promise<
        Array<{
            tenantId: string
            planId: string
            planName: UserPlans
            endDate: Date | null
            billingStatus: string | null
        }>
    > {
        try {
            const result = await this.client.query(
                `
                SELECT
                    id,
                    tenant_id,
                    plan_name,
                    current_period_end AS effective_end_date,
                    billing_status
                FROM user_plans
                WHERE COALESCE(is_active, TRUE) = TRUE
                  AND LOWER(plan_name) <> LOWER($1)
                  AND current_period_end IS NOT NULL
                  AND current_period_end <= NOW()
                `,
                [UserPlans.FREE]
            )

            return result.rows.map((row) => ({
                tenantId: row.tenant_id,
                planId: row.id,
                planName: row.plan_name as UserPlans,
                endDate: row.effective_end_date,
                billingStatus: row.billing_status ?? null,
            }))
        } catch (error: any) {
            this.logger.error('Failed to fetch expired plans', {
                operation: 'findExpiredPlans',
                error: error instanceof Error ? { name: error.name } : undefined,
            })
            throw new BaseAppError('Failed to fetch expired plans', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    private mapRowToUserPlan(row: any): UserPlan {
        return new UserPlan(
            row.id,
            row.tenant_id,
            row.plan_name,
            row.plan_type,
            row.sent_posts_limit,
            row.scheduled_posts_limit,
            row.platforms_allowed,
            row.start_date,
            row.end_date,
            row.is_active,
            row.stripe_subscription_id ?? null,
            row.stripe_price_id ?? null,
            row.status ?? null,
            row.current_period_end ?? null,
            row.stripe_lookup_key ?? null,
            row.accounts_limit !== null ? Number(row.accounts_limit) : null,
            row.ai_requests_limit !== null ? Number(row.ai_requests_limit) : null,
            row.billing_status ?? 'active'
        )
    }

    async findByEmail(email: string): Promise<User | null> {
        try {
            const result = await this.client.query(`SELECT * FROM tenants WHERE email = $1`, [email])

            if (result.rows.length === 0) {
                return null
            }

            const tenant = result.rows[0]

            return new User(
                tenant.id,
                tenant.name,
                tenant.email,
                tenant.google_auth,
                tenant.password,
                tenant.avatar || '',
                tenant.refresh_token || null,
                tenant.created_at,
                tenant.default_account_limit ?? null,
                tenant.default_sent_posts_limit ?? 130,
                tenant.default_scheduled_posts_limit ?? 100,
                tenant.default_ai_requests_limit ?? 30
            )
        } catch (error: any) {
            throw new BaseAppError(`Failed to find user by email: ${error.message}`, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async findByStripeCustomerId(customerId: string): Promise<User | null> {
        try {
            const result = await this.client.query(`SELECT * FROM tenants WHERE stripe_customer_id = $1`, [customerId])

            if (result.rows.length === 0) {
                return null
            }

            const tenant = result.rows[0]

            return new User(
                tenant.id,
                tenant.name,
                tenant.email,
                tenant.google_auth,
                tenant.password,
                tenant.avatar || '',
                tenant.refresh_token || null,
                tenant.created_at,
                tenant.default_account_limit ?? null,
                tenant.default_sent_posts_limit ?? 130,
                tenant.default_scheduled_posts_limit ?? 100,
                tenant.default_ai_requests_limit ?? 30
            )
        } catch (error: any) {
            throw new BaseAppError(
                `Failed to find user by Stripe customer id: ${error.message}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        }
    }

    async findById(id: string): Promise<User> {
        try {
            const result = await this.client.query(`SELECT * FROM tenants WHERE id = $1`, [id])

            if (result.rows.length === 0) {
                throw new BaseAppError(`User not found`, ErrorCode.NOT_FOUND, 404)
            }

            const tenant = result.rows[0]

            return new User(
                tenant.id,
                tenant.name,
                tenant.email,
                tenant.google_auth,
                tenant.password,
                tenant.avatar || '',
                tenant.refresh_token || null,
                tenant.created_at,
                tenant.default_account_limit ?? null,
                tenant.default_sent_posts_limit ?? 130,
                tenant.default_scheduled_posts_limit ?? 100,
                tenant.default_ai_requests_limit ?? 30
            )
        } catch (error: any) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError(`Failed to find user by ID: ${error.message}`, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async save(user: User): Promise<User> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            const result = await client.query(
                `INSERT INTO tenants (id, name, email, google_auth, password, avatar, refresh_token, default_account_limit, default_sent_posts_limit, default_scheduled_posts_limit, default_ai_requests_limit)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING *`,
                [
                    user.id,
                    user.name,
                    user.email,
                    user.googleAuth,
                    user.password,
                    user.avatar,
                    user.refreshToken,
                    user.defaultAccountLimit,
                    user.defaultSentPostsLimit,
                    user.defaultScheduledPostsLimit,
                    user.defaultAiRequestsLimit,
                ]
            )

            await client.query('COMMIT')

            const savedTenant = result.rows[0]

            return new User(
                savedTenant.id,
                savedTenant.name,
                savedTenant.email,
                savedTenant.google_auth,
                savedTenant.password,
                savedTenant.avatar || '',
                savedTenant.refresh_token || null,
                savedTenant.created_at,
                savedTenant.default_account_limit ?? null,
                savedTenant.default_sent_posts_limit ?? 130,
                savedTenant.default_scheduled_posts_limit ?? 100,
                savedTenant.default_ai_requests_limit ?? 30
            )
        } catch (error: any) {
            await client.query('ROLLBACK')
            if (error.code === '23505') {
                throw new BaseAppError('User already exists', ErrorCode.USER_ALREADY_EXISTS, 409)
            }
            throw new BaseAppError(`Failed to save user: ${error.message}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async updateRefreshToken(userId: string, refreshToken: string | null): Promise<void> {
        try {
            await this.client.query(`UPDATE tenants SET refresh_token = $2 WHERE id = $1`, [userId, refreshToken])
        } catch (error: any) {
            throw new BaseAppError(`Failed to update refresh token: ${error.message}`, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async createPasswordResetToken(params: {
        userId: string
        tokenId: string
        tokenHash: string
        expiresAt: Date
    }): Promise<void> {
        const { userId, tokenId, tokenHash, expiresAt } = params
        try {
            await this.client.query(
                `INSERT INTO password_reset_tokens (tenant_id, token_id, token_hash, expires_at)
                 VALUES ($1, $2, $3, $4)` ,
                [userId, tokenId, tokenHash, expiresAt]
            )
        } catch (error: any) {
            this.logger.error('Failed to create password reset token', {
                operation: 'createPasswordResetToken',
                userId,
                error: error instanceof Error ? { name: error.name,  } : undefined,
            })
            throw new BaseAppError('Failed to create password reset token', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async findPasswordResetToken(tokenId: string): Promise<
        | {
              id: string
              tenantId: string
              tokenHash: string
              expiresAt: Date
              usedAt: Date | null
          }
        | null
    > {
        try {
            const result = await this.client.query(
                `SELECT id, tenant_id, token_hash, expires_at, used_at
                 FROM password_reset_tokens
                 WHERE token_id = $1`,
                [tokenId]
            )

            if (result.rows.length === 0) {
                return null
            }

            const row = result.rows[0]
            return {
                id: row.id,
                tenantId: row.tenant_id,
                tokenHash: row.token_hash,
                expiresAt: row.expires_at,
                usedAt: row.used_at,
            }
        } catch (error: any) {
            this.logger.error('Failed to fetch password reset token', {
                operation: 'findPasswordResetToken',
                tokenId,
                error: error instanceof Error ? { name: error.name } : undefined,
            })
            throw new BaseAppError('Failed to fetch password reset token', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async markPasswordResetTokenUsed(tokenId: string): Promise<void> {
        try {
            await this.client.query(
                `UPDATE password_reset_tokens
                 SET used_at = NOW()
                 WHERE token_id = $1`,
                [tokenId]
            )
        } catch (error: any) {
            this.logger.error('Failed to mark password reset token as used', {
                operation: 'markPasswordResetTokenUsed',
                tokenId,
                error: error instanceof Error ? { name: error.name,  } : undefined,
            })
            throw new BaseAppError('Failed to update password reset token', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
        try {
            await this.client.query(`UPDATE tenants SET password = $2 WHERE id = $1`, [userId, passwordHash])
        } catch (error: any) {
            this.logger.error('Failed to update user password', {
                operation: 'updateUserPassword',
                userId,
                error: error instanceof Error ? { name: error.name,  } : undefined,
            })
            throw new BaseAppError('Failed to update password', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async findUserPlanByUserId(userId: string): Promise<UserPlan> {
        const query = `
            SELECT *
            FROM user_plans
            WHERE tenant_id = $1
        `

        try {
            const result = await this.client.query(query, [userId])

            if (result.rows.length === 0)
                throw new BaseAppError(
                    `Plan for user with tenant_id ${userId} is not found`,
                    ErrorCode.BAD_REQUEST,
                    500
                )

            return this.mapRowToUserPlan(result.rows[0])
        } catch (error: unknown) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError(`Failed to retrieve plan for user with id ${userId}`, ErrorCode.BAD_REQUEST, 500)
        }
    }

    async findUserPlanBySubscriptionId(subscriptionId: string): Promise<UserPlan | null> {
        const client = await this.client.connect()

        try {
            const result = await client.query(
                `
                SELECT *
                FROM user_plans
                WHERE stripe_subscription_id = $1
                ORDER BY updated_at DESC
                LIMIT 1
                `,
                [subscriptionId]
            )

            if (result.rows.length === 0) {
                return null
            }

            return this.mapRowToUserPlan(result.rows[0])
        } catch (error) {
            throw new BaseAppError('Failed to fetch plan by Stripe subscription', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async updateStripeCustomerId(userId: string, customerId: string): Promise<void> {
        try {
            await this.client.query(
                `
                UPDATE tenants
                SET stripe_customer_id = $2
                WHERE id = $1
                `,
                [userId, customerId]
            )
        } catch (error) {
            throw new BaseAppError('Failed to update Stripe customer identifier', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async getStripeCustomerId(userId: string): Promise<string | null> {
        try {
            const result = await this.client.query<{ stripe_customer_id: string | null }>(
                `SELECT stripe_customer_id FROM tenants WHERE id = $1`,
                [userId]
            )

            if (result.rows.length === 0) {
                return null
            }

            return result.rows[0].stripe_customer_id ?? null
        } catch (error) {
            throw new BaseAppError('Failed to retrieve Stripe customer identifier', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async ensurePlan(
        userId: string,
        plan: {
            name: UserPlans
            planType: 'monthly' | 'yearly'
            sentPostsLimit?: number
            scheduledPostsLimit?: number
            platformsAllowed?: SocilaMediaPlatform[]
            startDate: Date
            endDate: Date
            stripeSubscriptionId?: string | null
            stripePriceId?: string | null
            status?: string | null
            currentPeriodEnd?: Date | null
            stripeLookupKey?: string | null
            accountsLimit?: number | null
            aiRequestsLimit?: number | null
            billingStatus?: string | null
        }
    ): Promise<UserPlan> {
        const client = await this.client.connect()

        try {
            await client.query('BEGIN')

            const existingPlan = await client.query(
                `SELECT id FROM user_plans WHERE tenant_id = $1 LIMIT 1`,
                [userId]
            )

            let result
            const sentPostsLimit = plan.sentPostsLimit ?? 30
            const scheduledPostsLimit = plan.scheduledPostsLimit ?? 10
            const platformsAllowed = plan.platformsAllowed ?? Object.values(SocilaMediaPlatform)
            const stripeSubscriptionId = plan.stripeSubscriptionId ?? null
            const stripePriceId = plan.stripePriceId ?? null
            const planStatus = plan.status ?? null
            const currentPeriodEnd = plan.currentPeriodEnd ?? null
            const stripeLookupKey = plan.stripeLookupKey ?? null
            const accountsLimit = plan.accountsLimit ?? null
            const aiRequestsLimit = plan.aiRequestsLimit ?? null

            if ((existingPlan.rowCount ?? 0) > 0) {
                const planId = existingPlan.rows[0].id

                result = await client.query(
                    `UPDATE user_plans
                    SET
                        plan_name = $1,
                        plan_type = $2,
                        sent_posts_limit = $3,
                        scheduled_posts_limit = $4,
                        platforms_allowed = $5,
                        start_date = $6,
                        end_date = $7,
                        stripe_subscription_id = $8,
                        stripe_price_id = $9,
                        status = $10,
                        current_period_end = $11,
                        stripe_lookup_key = $12,
                        accounts_limit = $13,
                        ai_requests_limit = $14,
                        billing_status = $15,
                        is_active = TRUE
                    WHERE id = $16
                    RETURNING *`,
                    [
                        plan.name,
                        plan.planType,
                        sentPostsLimit,
                        scheduledPostsLimit,
                        platformsAllowed,
                        plan.startDate,
                        plan.endDate,
                        stripeSubscriptionId,
                        stripePriceId,
                        planStatus,
                        currentPeriodEnd,
                        stripeLookupKey,
                        accountsLimit,
                        aiRequestsLimit,
                        plan.billingStatus ?? 'active',
                        planId,
                    ]
                )
            } else {
                result = await client.query(
                    `INSERT INTO user_plans (
                        id,
                        tenant_id,
                        plan_name,
                        plan_type,
                        sent_posts_limit,
                        scheduled_posts_limit,
                        platforms_allowed,
                        start_date,
                        end_date,
                        is_active,
                        stripe_subscription_id,
                        stripe_price_id,
                        status,
                        current_period_end,
                        stripe_lookup_key,
                        accounts_limit,
                        ai_requests_limit,
                        billing_status
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10, $11, $12, $13, $14, $15, $16, $17)
                    RETURNING *`,
                    [
                        uuidv4(),
                        userId,
                        plan.name,
                        plan.planType,
                        sentPostsLimit,
                        scheduledPostsLimit,
                        platformsAllowed,
                        plan.startDate,
                        plan.endDate,
                        stripeSubscriptionId,
                        stripePriceId,
                        planStatus,
                        currentPeriodEnd,
                        stripeLookupKey,
                        accountsLimit,
                        aiRequestsLimit,
                        plan.billingStatus ?? 'active',
                    ]
                )
            }

            await client.query('COMMIT')

            return this.mapRowToUserPlan(result.rows[0])
        } catch (error: any) {
            await client.query('ROLLBACK')
            throw new BaseAppError(`Failed to assign plan: ${error.message}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async updateUserPlanUsage(
        userId: string,
        usageType: 'sent' | 'scheduled' | 'accounts' | 'ai',
        additionalCount: number,
        periodStart: Date,
        periodEnd: Date
    ): Promise<{ success: boolean; newUsageCount: number; limitCount: number }> {
        const client = await this.client.connect()

        try {
            await client.query('BEGIN')

            const query = `
                WITH tenant_defaults AS (
                    SELECT
                        t.id AS tenant_id,
                        CASE
                            WHEN $2 = 'sent' THEN t.default_sent_posts_limit
                            WHEN $2 = 'scheduled' THEN t.default_scheduled_posts_limit
                            WHEN $2 = 'accounts' THEN COALESCE(t.default_account_limit::int, 999999)
                            WHEN $2 = 'ai' THEN t.default_ai_requests_limit
                        END AS default_limit
                    FROM tenants t
                    WHERE t.id = $1
                ),
                plan_ref AS (
                    SELECT id AS plan_id
                    FROM user_plans
                    WHERE tenant_id = $1
                    ORDER BY start_date DESC NULLS LAST
                    LIMIT 1
                ),
                existing_usage AS (
                    SELECT id, used_count, limit_count
                    FROM user_plan_usage
                    WHERE tenant_id = $1
                      AND usage_type = $2
                      AND period_start = $3
                      AND period_end = $4
                    ORDER BY created_at DESC
                    LIMIT 1
                ),
                updated AS (
                    UPDATE user_plan_usage upu
                    SET
                        used_count = GREATEST(0, LEAST(upu.used_count + $5, upu.limit_count)),
                        updated_at = NOW()
                    FROM existing_usage eu
                    WHERE upu.id = eu.id
                    RETURNING upu.used_count, upu.limit_count
                ),
                inserted AS (
                    INSERT INTO user_plan_usage (
                        id, tenant_id, plan_id, usage_type, period_start, period_end, used_count, limit_count
                    )
                    SELECT
                        uuid_generate_v4(), $1, pr.plan_id, $2, $3, $4,
                        GREATEST(0, LEAST($5, td.default_limit)),
                        td.default_limit
                    FROM tenant_defaults td
                    CROSS JOIN plan_ref pr
                    WHERE NOT EXISTS (SELECT 1 FROM existing_usage)
                      AND td.default_limit IS NOT NULL
                      AND td.default_limit > 0
                    RETURNING used_count, limit_count
                )
                SELECT used_count AS new_usage_count, limit_count, true AS success FROM updated
                UNION ALL
                SELECT used_count AS new_usage_count, limit_count, true AS success FROM inserted
            `

            const result = await client.query(query, [userId, usageType, periodStart, periodEnd, additionalCount])

            await client.query('COMMIT')

            const row = result.rows[0]

            if (!row) {
                throw new BaseAppError('Usage counters are not initialized for this plan period', ErrorCode.UNKNOWN_ERROR, 500)
            }

            return {
                success: true,
                newUsageCount: row.new_usage_count,
                limitCount: row.limit_count,
            }
        } catch (error: any) {
            await client.query('ROLLBACK')

            if (error instanceof BaseAppError) throw error

            throw new BaseAppError(`Failed to update user plan usage: ${error.message}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async resetUsageCountersForPlan(params: {
        userId: string
        planId: string
        usageTypes: Array<'sent' | 'scheduled' | 'accounts' | 'ai'>
        periodStart: Date
        periodEnd: Date
        limits: {
            sentPostsLimit: number
            scheduledPostsLimit: number
            accountsLimit: number
            aiRequestsLimit: number
        }
        preserveUsageTypes?: Array<'sent' | 'scheduled' | 'accounts' | 'ai'>
    }): Promise<void> {
        const { userId, planId, usageTypes, periodStart, periodEnd, limits, preserveUsageTypes = [] } = params
        const client = await this.client.connect()

        const resolveLimit = (usageType: 'sent' | 'scheduled' | 'accounts' | 'ai'): number => {
            if (usageType === 'sent') return limits.sentPostsLimit
            if (usageType === 'scheduled') return limits.scheduledPostsLimit
            if (usageType === 'accounts') return limits.accountsLimit
            return limits.aiRequestsLimit
        }

        try {
            await client.query('BEGIN')

            for (const usageType of usageTypes) {
                const limit = resolveLimit(usageType)
                if (limit <= 0) {
                    this.logger.warn('Skipping usage counter with non-positive limit', {
                        operation: 'resetUsageCountersForPlan',
                        userId,
                        planId,
                        usageType,
                        limit,
                    })
                    continue
                }
                const existing = await client.query<{ id: string; period_start: Date; period_end: Date; used_count: number }>(
                    `
                    SELECT id, period_start, period_end, used_count
                    FROM user_plan_usage
                    WHERE tenant_id = $1 AND plan_id = $2 AND usage_type = $3
                    ORDER BY created_at DESC
                    LIMIT 1
                    `,
                    [userId, planId, usageType]
                )

                if (existing.rows.length > 0) {
                    const row = existing.rows[0]
                    const preserveUsage =
                        preserveUsageTypes.includes(usageType) ||
                        (row.period_start.getTime() === periodStart.getTime() &&
                            row.period_end.getTime() === periodEnd.getTime())
                    const nextUsedCount = preserveUsage ? row.used_count : 0

                    await client.query(
                        `
                        UPDATE user_plan_usage
                        SET 
                            period_start = $1,
                            period_end = $2,
                            limit_count = $3,
                            used_count = $4,
                            updated_at = NOW()
                        WHERE id = $5
                        `,
                        [periodStart, periodEnd, limit, nextUsedCount, row.id]
                    )
                } else {
                    await client.query(
                        `
                        INSERT INTO user_plan_usage (
                            id,
                            tenant_id,
                            plan_id,
                            usage_type,
                            period_start,
                            period_end,
                            used_count,
                            limit_count
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
                        `,
                        [uuidv4(), userId, planId, usageType, periodStart, periodEnd, limit]
                    )
                }
            }

            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK')
            throw new BaseAppError('Failed to reset usage counters for plan', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async incrementUsageLimits(params: {
        userId: string
        periodStart: Date
        periodEnd: Date
        deltas: { sent?: number; scheduled?: number; ai?: number }
    }): Promise<void> {
        const client = await this.client.connect()

        try {
            await client.query('BEGIN')

            const tenantRes = await client.query<{
                default_sent_posts_limit: number
                default_scheduled_posts_limit: number
                default_ai_requests_limit: number
            }>(
                `
                SELECT default_sent_posts_limit, default_scheduled_posts_limit, default_ai_requests_limit
                FROM tenants
                WHERE id = $1
                `,
                [params.userId]
            )

            if (tenantRes.rows.length === 0) {
                throw new BaseAppError('Tenant not found', ErrorCode.BAD_REQUEST, 400)
            }

            const tenant = tenantRes.rows[0]
            const baseLimits = {
                sent: tenant.default_sent_posts_limit,
                scheduled: tenant.default_scheduled_posts_limit,
                ai: tenant.default_ai_requests_limit,
            }

            const planRes = await client.query<{ id: string }>(
                `
                SELECT id FROM user_plans
                WHERE tenant_id = $1
                ORDER BY start_date DESC NULLS LAST
                LIMIT 1
                `,
                [params.userId]
            )
            const planId = planRes.rows[0]?.id ?? null

            const applyDelta = async (usageType: 'sent' | 'scheduled' | 'ai', delta: number, baseLimit: number) => {
                if (delta <= 0) return

                const existing = await client.query<{ id: string }>(
                    `
                    SELECT id
                    FROM user_plan_usage
                    WHERE tenant_id = $1 AND usage_type = $2 AND period_start = $3 AND period_end = $4
                    `,
                    [params.userId, usageType, params.periodStart, params.periodEnd]
                )

                if (existing.rows.length > 0) {
                    await client.query(
                        `
                        UPDATE user_plan_usage
                        SET
                            limit_count = GREATEST($1, limit_count + $2),
                            updated_at = NOW()
                        WHERE tenant_id = $3
                          AND usage_type = $4
                          AND period_start = $5
                          AND period_end = $6
                        `,
                        [baseLimit + delta, delta, params.userId, usageType, params.periodStart, params.periodEnd]
                    )
                } else {
                    if (!planId) {
                        throw new BaseAppError(
                            'Cannot create usage row: tenant has no user_plans entry to satisfy FK',
                            ErrorCode.BAD_REQUEST,
                            400
                        )
                    }
                    await client.query(
                        `
                        INSERT INTO user_plan_usage (
                            id,
                            tenant_id,
                            plan_id,
                            usage_type,
                            period_start,
                            period_end,
                            used_count,
                            limit_count
                        )
                        VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
                        `,
                        [uuidv4(), params.userId, planId, usageType, params.periodStart, params.periodEnd, baseLimit + delta]
                    )
                }
            }

            await applyDelta('sent', params.deltas.sent ?? 0, baseLimits.sent)
            await applyDelta('scheduled', params.deltas.scheduled ?? 0, baseLimits.scheduled)
            await applyDelta('ai', params.deltas.ai ?? 0, baseLimits.ai)

            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK')
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to increment usage limits', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getCurrentUsageQuota(
        userId: string,
        periodStart: Date,
        periodEnd: Date
    ): Promise<{
        sentPosts: { used: number; limit: number }
        scheduledPosts: { used: number; limit: number }
        connectedAccounts: { used: number; limit: number }
        aiRequests: { used: number; limit: number }
    }> {
        const client = await this.client.connect()

        try {
            const query = `
                WITH tenant_limits AS (
                    SELECT
                        t.id AS tenant_id,
                        t.default_sent_posts_limit,
                        t.default_scheduled_posts_limit,
                        COALESCE(t.default_account_limit::int, 999999) AS default_account_limit,
                        t.default_ai_requests_limit
                    FROM tenants t
                    WHERE t.id = $1
                ),
                usage_types AS (
                    SELECT unnest(ARRAY['sent', 'scheduled', 'accounts', 'ai'])::text AS usage_type
                ),
                period_usage AS (
                    SELECT DISTINCT ON (usage_type)
                        usage_type,
                        used_count,
                        limit_count
                    FROM user_plan_usage
                    WHERE tenant_id = $1
                      AND period_start = $2
                      AND period_end = $3
                    ORDER BY usage_type, updated_at DESC, created_at DESC
                ),
                usage_data AS (
                    SELECT
                        ut.usage_type,
                        COALESCE(pu.used_count, 0) AS used_count,
                        COALESCE(
                            pu.limit_count,
                            CASE
                                WHEN ut.usage_type = 'sent' THEN tl.default_sent_posts_limit
                                WHEN ut.usage_type = 'scheduled' THEN tl.default_scheduled_posts_limit
                                WHEN ut.usage_type = 'accounts' THEN tl.default_account_limit
                                WHEN ut.usage_type = 'ai' THEN tl.default_ai_requests_limit
                            END
                        ) AS limit_count
                    FROM tenant_limits tl
                    CROSS JOIN usage_types ut
                    LEFT JOIN period_usage pu ON pu.usage_type = ut.usage_type
                )
                SELECT 
                    COALESCE(MAX(CASE WHEN usage_type = 'sent' THEN used_count END), 0) as sent_used,
                    COALESCE(MAX(CASE WHEN usage_type = 'sent' THEN limit_count END), 0) as sent_limit,
                    COALESCE(MAX(CASE WHEN usage_type = 'scheduled' THEN used_count END), 0) as scheduled_used,
                    COALESCE(MAX(CASE WHEN usage_type = 'scheduled' THEN limit_count END), 0) as scheduled_limit,
                    COALESCE(MAX(CASE WHEN usage_type = 'accounts' THEN used_count END), 0) as accounts_used,
                    COALESCE(MAX(CASE WHEN usage_type = 'accounts' THEN limit_count END), 0) as accounts_limit,
                    COALESCE(MAX(CASE WHEN usage_type = 'ai' THEN used_count END), 0) as ai_used,
                    COALESCE(MAX(CASE WHEN usage_type = 'ai' THEN limit_count END), 0) as ai_limit
                FROM usage_data
            `

            const result = await client.query(query, [userId, periodStart, periodEnd])
            const row = result.rows[0]

            this.logger.debug('HERE WE GO: ', {
                sentPosts: {
                    used: row.sent_used,
                    limit: row.sent_limit,
                },
                scheduledPosts: {
                    used: row.scheduled_used,
                    limit: row.scheduled_limit,
                },
                connectedAccounts: {
                    used: row.accounts_used,
                    limit: row.accounts_limit,
                },
                aiRequests: {
                    used: row.ai_used,
                    limit: row.ai_limit,
                },
            })

            return {
                sentPosts: {
                    used: row.sent_used,
                    limit: row.sent_limit,
                },
                scheduledPosts: {
                    used: row.scheduled_used,
                    limit: row.scheduled_limit,
                },
                connectedAccounts: {
                    used: row.accounts_used,
                    limit: row.accounts_limit,
                },
                aiRequests: {
                    used: row.ai_used,
                    limit: row.ai_limit,
                },
            }
        } catch (error: any) {
            if (error instanceof BaseAppError) throw error

            throw new BaseAppError(`Failed to get current usage quota: ${error.message}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async createMagicLink(params: {
        tokenId: string
        tokenHash: string
        expiresAt: Date
        promoType: MagicLinkPromoType
        promoDurationDays: number
        maxUses?: number
    }): Promise<void> {
        const { tokenId, tokenHash, expiresAt, promoType, promoDurationDays, maxUses = 1 } = params

        try {
            await this.client.query(
                `INSERT INTO magic_links (
                    token_id,
                    token_hash,
                    expires_at,
                    promo_type,
                    promo_duration_days,
                    max_uses
                )
                VALUES ($1, $2, $3, $4, $5, $6)`,
                [tokenId, tokenHash, expiresAt, promoType, promoDurationDays, maxUses]
            )
        } catch (error: any) {
            this.logger.error('Failed to create magic link', {
                operation: 'createMagicLink',
                tokenId,
                promoType,
            })
            throw new BaseAppError('Failed to create magic link', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async findMagicLink(tokenId: string): Promise<MagicLinkRecord | null> {
        try {
            const result = await this.client.query(
                `SELECT *
                 FROM magic_links
                 WHERE token_id = $1`,
                [tokenId]
            )

            if (result.rows.length === 0) {
                return null
            }

            return this.mapRowToMagicLink(result.rows[0])
        } catch (error: any) {
            this.logger.error('Failed to fetch magic link', {
                operation: 'findMagicLink',
                tokenId,
            })
            throw new BaseAppError('Failed to fetch magic link', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async redeemMagicLink(params: { magicLinkId: string; userId: string }): Promise<void> {
        const { magicLinkId, userId } = params
        try {
            const result = await this.client.query(
                `UPDATE magic_links
                 SET redeemed_at = COALESCE(redeemed_at, NOW()),
                     redeemed_by_user_id = $2,
                     redeemed_count = redeemed_count + 1,
                     updated_at = NOW()
                 WHERE id = $1
                 AND redeemed_count < max_uses
                 AND expires_at > NOW()`,
                [magicLinkId, userId]
            )

            if (result.rowCount === 0) {
                throw new BaseAppError('Magic link already redeemed or expired', ErrorCode.BAD_REQUEST, 400)
            }
        } catch (error: any) {
            if (error instanceof BaseAppError) {
                throw error
            }

            this.logger.error('Failed to redeem magic link', {
                operation: 'redeemMagicLink',
                magicLinkId,
                userId,
            })
            throw new BaseAppError('Failed to redeem magic link', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
