import { Pool, PoolClient } from 'pg'
import { pgClient } from '@/db-connection'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { AiCreditChangeReason, IAiCreditsRepository } from './ai-credits.repository.interface'

export class AiCreditsRepository implements IAiCreditsRepository {
    private readonly client: Pool

    constructor() {
        this.client = pgClient()
    }

    async getBalance(tenantId: string): Promise<number> {
        try {
            const result = await this.client.query('SELECT balance FROM tenant_ai_credits WHERE tenant_id = $1', [
                tenantId,
            ])

            return result.rows[0]?.balance ?? 0
        } catch (error) {
            throw this.wrapError('Failed to get AI credits balance', error)
        }
    }

    async credit(
        tenantId: string,
        amount: number,
        reason: AiCreditChangeReason,
        reference?: string
    ): Promise<boolean> {
        return this.inTransaction(async (client) => {
            const inserted = await client.query(
                `INSERT INTO ai_credit_transactions (tenant_id, delta, reason, reference)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (reference) DO NOTHING
                 RETURNING id`,
                [tenantId, amount, reason, reference ?? null]
            )

            if (inserted.rowCount === 0) return false

            await client.query(
                `INSERT INTO tenant_ai_credits (tenant_id, balance)
                 VALUES ($1, $2)
                 ON CONFLICT (tenant_id)
                 DO UPDATE SET balance = tenant_ai_credits.balance + $2, updated_at = NOW()`,
                [tenantId, amount]
            )

            return true
        })
    }

    async tryDebit(tenantId: string, amount: number): Promise<boolean> {
        return this.inTransaction(async (client) => {
            const updated = await client.query(
                `UPDATE tenant_ai_credits
                 SET balance = balance - $2, updated_at = NOW()
                 WHERE tenant_id = $1 AND balance >= $2`,
                [tenantId, amount]
            )

            if (updated.rowCount === 0) return false

            await client.query(
                `INSERT INTO ai_credit_transactions (tenant_id, delta, reason) VALUES ($1, $2, 'generation')`,
                [tenantId, -amount]
            )

            return true
        })
    }

    private async inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await this.client.connect()

        try {
            await client.query('BEGIN')
            const result = await work(client)
            await client.query('COMMIT')
            return result
        } catch (error) {
            await client.query('ROLLBACK')
            throw this.wrapError('Failed to update AI credits', error)
        } finally {
            client.release()
        }
    }

    private wrapError(message: string, error: unknown): BaseAppError {
        const details = error instanceof Error ? error.message : String(error)
        return new BaseAppError(`${message}: ${details}`, ErrorCode.UNKNOWN_ERROR, 500)
    }
}
