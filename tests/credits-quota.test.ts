import assert from 'assert'
import { newDb } from 'pg-mem'
import Module from 'module'
import { v4 as uuidv4 } from 'uuid'

let sharedPool: any = null
const originalResolve = (Module as any)._resolveFilename
const dbConnectionPath = require.resolve('../src/db-connection')
require.cache[dbConnectionPath] = {
    id: dbConnectionPath,
    filename: dbConnectionPath,
    loaded: true,
    exports: {
        pgClient: () => sharedPool,
    },
} as any

import { UserRepository } from '../src/repositories/user-repository/user.repository'

const TENANT_ID = '11111111-1111-1111-1111-111111111111'
const PLAN_ID = '22222222-2222-2222-2222-222222222222'

function makePool() {
    const db = newDb({ autoCreateForeignKeyIndices: true })
    db.public.registerFunction({ name: 'uuid_generate_v4', returns: 'uuid' as any, implementation: () => uuidv4() })
    db.public.registerFunction({ name: 'gen_random_uuid', returns: 'uuid' as any, implementation: () => uuidv4() })

    db.public.none(`
        CREATE TABLE tenants (
            id uuid PRIMARY KEY,
            default_account_limit integer,
            default_sent_posts_limit integer NOT NULL DEFAULT 30,
            default_scheduled_posts_limit integer NOT NULL DEFAULT 10,
            default_ai_requests_limit integer NOT NULL DEFAULT 0
        );

        CREATE TABLE user_plans (
            id uuid PRIMARY KEY,
            tenant_id uuid NOT NULL,
            plan_name text NOT NULL DEFAULT 'FREE',
            sent_posts_limit integer NOT NULL DEFAULT 30,
            scheduled_posts_limit integer NOT NULL DEFAULT 10,
            accounts_limit integer,
            ai_requests_limit integer,
            start_date timestamptz NOT NULL DEFAULT NOW(),
            end_date timestamptz,
            is_active boolean NOT NULL DEFAULT true
        );

        CREATE TABLE user_plan_usage (
            id uuid PRIMARY KEY,
            tenant_id uuid NOT NULL,
            plan_id uuid NOT NULL,
            usage_type text NOT NULL,
            period_start timestamptz NOT NULL,
            period_end timestamptz NOT NULL,
            used_count integer NOT NULL DEFAULT 0,
            limit_count integer NOT NULL,
            created_at timestamptz NOT NULL DEFAULT NOW(),
            updated_at timestamptz NOT NULL DEFAULT NOW(),
            UNIQUE (tenant_id, plan_id, usage_type, period_start, period_end)
        );
    `)

    const adapter = db.adapters.createPg()
    const pool = new adapter.Pool()
    sharedPool = pool
    return pool
}

function billingPeriod(): { start: Date; end: Date } {
    const start = new Date()
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setMonth(end.getMonth() + 1)
    end.setDate(0)
    end.setHours(23, 59, 59, 999)
    return { start, end }
}

async function seedTenant(pool: any, defaults: { sent: number; scheduled: number; ai: number; accounts: number }) {
    await pool.query(
        `INSERT INTO tenants (id, default_sent_posts_limit, default_scheduled_posts_limit, default_ai_requests_limit, default_account_limit)
         VALUES ($1, $2, $3, $4, $5)`,
        [TENANT_ID, defaults.sent, defaults.scheduled, defaults.ai, defaults.accounts]
    )
    await pool.query(
        `INSERT INTO user_plans (id, tenant_id, plan_name, sent_posts_limit, scheduled_posts_limit, accounts_limit, ai_requests_limit)
         VALUES ($1, $2, 'FREE', $3, $4, $5, $6)`,
        [PLAN_ID, TENANT_ID, defaults.sent, defaults.scheduled, defaults.accounts, defaults.ai]
    )
}

const silentLogger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }

async function testFirstTopUpInsertsAndReaderSeesIt() {
    const pool = makePool()
    await seedTenant(pool, { sent: 30, scheduled: 10, ai: 0, accounts: 50 })
    const repo = new UserRepository(silentLogger)
    const { start, end } = billingPeriod()

    await repo.incrementUsageLimits({
        userId: TENANT_ID,
        periodStart: start,
        periodEnd: end,
        deltas: { sent: 20, scheduled: 10, ai: 10 },
    })

    const quota = await repo.getCurrentUsageQuota(TENANT_ID, start, end)
    assert.strictEqual(quota.sentPosts.limit, 50, `sent limit expected 50, got ${quota.sentPosts.limit}`)
    assert.strictEqual(quota.scheduledPosts.limit, 20, `scheduled limit expected 20, got ${quota.scheduledPosts.limit}`)
    assert.strictEqual(quota.aiRequests.limit, 10, `ai limit expected 10, got ${quota.aiRequests.limit}`)
    console.log('✅ first top-up: insert + read matches')
}

async function testSecondTopUpAccumulates() {
    const pool = makePool()
    await seedTenant(pool, { sent: 30, scheduled: 10, ai: 0, accounts: 50 })
    const repo = new UserRepository(silentLogger)
    const { start, end } = billingPeriod()

    await repo.incrementUsageLimits({
        userId: TENANT_ID,
        periodStart: start,
        periodEnd: end,
        deltas: { sent: 27, scheduled: 13, ai: 7 },
    })
    await repo.incrementUsageLimits({
        userId: TENANT_ID,
        periodStart: start,
        periodEnd: end,
        deltas: { sent: 28, scheduled: 14, ai: 6 },
    })

    const quota = await repo.getCurrentUsageQuota(TENANT_ID, start, end)
    assert.strictEqual(quota.sentPosts.limit, 30 + 27 + 28, `sent limit expected 85, got ${quota.sentPosts.limit}`)
    assert.strictEqual(quota.scheduledPosts.limit, 10 + 13 + 14, `scheduled limit expected 37, got ${quota.scheduledPosts.limit}`)
    assert.strictEqual(quota.aiRequests.limit, 0 + 7 + 6, `ai limit expected 13, got ${quota.aiRequests.limit}`)
    console.log('✅ cumulative top-ups: limits accumulate correctly')
}

async function testExistingStaleRowDoesNotShadow() {
    const pool = makePool()
    await seedTenant(pool, { sent: 30, scheduled: 10, ai: 0, accounts: 50 })
    const repo = new UserRepository(silentLogger)
    const { start, end } = billingPeriod()

    // Pre-existing legacy row at same period with a different (stale) plan_id, limit 85
    const stalePlanId = '33333333-3333-3333-3333-333333333333'
    await pool.query(
        `INSERT INTO user_plans (id, tenant_id, plan_name, sent_posts_limit) VALUES ($1, $2, 'FREE', 85)`,
        [stalePlanId, TENANT_ID]
    )
    await pool.query(
        `INSERT INTO user_plan_usage (id, tenant_id, plan_id, usage_type, period_start, period_end, used_count, limit_count)
         VALUES ($1, $2, $3, 'sent', $4, $5, 0, 85)`,
        [uuidv4(), TENANT_ID, stalePlanId, start, end]
    )

    await repo.incrementUsageLimits({
        userId: TENANT_ID,
        periodStart: start,
        periodEnd: end,
        deltas: { sent: 24 },
    })

    const quota = await repo.getCurrentUsageQuota(TENANT_ID, start, end)
    assert.ok(
        quota.sentPosts.limit >= 85 + 24,
        `after +24 delta on 85 base, limit should be at least 109, got ${quota.sentPosts.limit}`
    )
    console.log('✅ stale legacy row does not shadow; limit advanced to', quota.sentPosts.limit)
}

async function testPostUsageDoesNotStompCredits() {
    const pool = makePool()
    await seedTenant(pool, { sent: 30, scheduled: 10, ai: 0, accounts: 50 })
    const repo = new UserRepository(silentLogger)
    const { start, end } = billingPeriod()

    await repo.incrementUsageLimits({
        userId: TENANT_ID,
        periodStart: start,
        periodEnd: end,
        deltas: { sent: 26 },
    })

    await repo.updateUserPlanUsage(TENANT_ID, 'sent', 1, start, end)

    const quota = await repo.getCurrentUsageQuota(TENANT_ID, start, end)
    assert.strictEqual(quota.sentPosts.used, 1, `used should be 1, got ${quota.sentPosts.used}`)
    assert.strictEqual(
        quota.sentPosts.limit,
        56,
        `limit must remain 56 (not stomped by post usage), got ${quota.sentPosts.limit}`
    )
    console.log('✅ sending a post does not stomp credited limit')
}

async function main() {
    console.log('🧪 credits-quota integration tests\n')
    await testFirstTopUpInsertsAndReaderSeesIt()
    await testSecondTopUpAccumulates()
    await testExistingStaleRowDoesNotShadow()
    await testPostUsageDoesNotStompCredits()
    console.log('\n✅ All credits-quota tests passed')
}

main().catch(err => {
    console.error('❌ test failed:', err)
    process.exit(1)
})
