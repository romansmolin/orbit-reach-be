import assert from 'assert'
import { UserRepository } from '@/repositories/user-repository'

type UsageType = 'sent' | 'scheduled' | 'accounts' | 'ai'

class FakeClient {
    public usage: Record<UsageType, number> = { sent: 0, scheduled: 0, accounts: 0, ai: 0 }
    public limits: Record<UsageType, number> = { sent: 300, scheduled: 200, accounts: 10, ai: 0 }
    public existingRow = true
    public hasPlan = true

    async query(sql: string, params?: any[]) {
        const text = sql.trim().toLowerCase()

        if (text.startsWith('begin') || text.startsWith('commit') || text.startsWith('rollback')) {
            return { rows: [] }
        }

        if (text.startsWith('select id, used_count, limit_count') && text.includes('from user_plan_usage')) {
            const usageType = params?.[1] as UsageType
            if (!this.existingRow) return { rows: [] }
            return {
                rows: [
                    {
                        id: 'row-1',
                        used_count: this.usage[usageType] ?? 0,
                        limit_count: this.limits[usageType] ?? 0,
                    },
                ],
            }
        }

        if (text.startsWith('update user_plan_usage')) {
            const delta = params?.[0] ?? 0
            const usageType = params?.[2] as UsageType
            const limit = this.limits[usageType] ?? 0
            const next = Math.max(0, Math.min((this.usage[usageType] ?? 0) + delta, limit))
            this.usage[usageType] = next
            return { rows: [{ used_count: next, limit_count: limit }] }
        }

        if (text.includes('from tenants') && text.includes('default_limit')) {
            const usageType = params?.[1] as UsageType
            return { rows: [{ default_limit: this.limits[usageType] ?? 0 }] }
        }

        if (text.startsWith('select id from user_plans')) {
            return { rows: this.hasPlan ? [{ id: 'plan-1' }] : [] }
        }

        if (text.startsWith('insert into user_plan_usage')) {
            const usageType = params?.[3] as UsageType
            const used = params?.[6] ?? 0
            const limit = params?.[7] ?? 0
            this.usage[usageType] = used
            this.limits[usageType] = limit
            return { rows: [{ used_count: used, limit_count: limit }] }
        }

        if (text.startsWith('select')) return { rows: [] }

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
    repo.logger = { info() {}, warn() {}, error() {}, debug() {} }
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
