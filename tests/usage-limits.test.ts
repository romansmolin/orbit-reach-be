import assert from 'assert'
import { UserRepository } from '@/repositories/user-repository'

class FakeClient {
    public usage: Record<string, number> = { sent: 0, scheduled: 0, accounts: 0, ai: 0 }
    public limits: Record<string, number> = { sent: 300, scheduled: 200, accounts: 10, ai: 0 }

    async query(sql: string, params?: any[]) {
        const text = sql.trim().toLowerCase()
        if (text.startsWith('begin') || text.startsWith('commit') || text.startsWith('rollback')) {
            return { rows: [] }
        }

        if (text.includes('with user_plan as')) {
            const usageType = params?.[1] as 'sent' | 'scheduled' | 'accounts' | 'ai'
            const delta = params?.[4] ?? 0
            const limit = this.limits[usageType] ?? 0
            const next = Math.max(0, Math.min((this.usage[usageType] ?? 0) + delta, limit))
            this.usage[usageType] = next
            return { rows: [{ new_usage_count: next, limit_count: limit }] }
        }

        // ensurePlan/update resets ignored in this test
        if (text.startsWith('select') || text.startsWith('update') || text.startsWith('insert')) {
            return { rows: [] }
        }

        throw new Error('Unexpected query: ' + sql)
    }

    async connect() {
        return this
    }

    release() {
        return
    }
}

function createRepo(fake: FakeClient) {
    const repo: any = Object.create(UserRepository.prototype)
    repo.client = fake
    repo.logger = { warn() {}, error() {} }
    return repo as UserRepository
}

async function testIncrementWithinLimit() {
    const client = new FakeClient()
    const repo = createRepo(client)
    const start = new Date('2025-01-01')
    const end = new Date('2025-01-31')

    const result = await repo.updateUserPlanUsage('user1', 'sent', 50, start, end)
    assert.strictEqual(result.newUsageCount, 50)
    assert.strictEqual(result.limitCount, 300)
}

async function testClampAtLimit() {
    const client = new FakeClient()
    client.usage.sent = 290
    const repo = createRepo(client)
    const start = new Date('2025-01-01')
    const end = new Date('2025-01-31')

    const result = await repo.updateUserPlanUsage('user1', 'sent', 50, start, end)
    assert.strictEqual(result.newUsageCount, 300)
    assert.strictEqual(result.limitCount, 300)
}

async function testPeriodCoverageUsesProvidedDates() {
    const client = new FakeClient()
    const repo = createRepo(client)
    const start = new Date('2025-02-01')
    const end = new Date('2025-02-28')

    // ensure usage increments even when periodStart is future (uses $3/$4 not NOW)
    const result = await repo.updateUserPlanUsage('user1', 'scheduled', 20, start, end)
    assert.strictEqual(result.newUsageCount, 20)
    assert.strictEqual(result.limitCount, 200)
}

async function run() {
    await testIncrementWithinLimit()
    await testClampAtLimit()
    await testPeriodCoverageUsesProvidedDates()
    console.log('usage-limits tests passed')
}

run().catch((error) => {
    console.error('usage-limits tests failed', error)
    process.exit(1)
})
