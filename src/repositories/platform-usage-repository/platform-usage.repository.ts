import { Pool } from 'pg'
import { pgClient } from '../../db-connection'
import { BaseAppError } from '../../shared/errors/base-error'
import { ErrorCode } from '../../shared/consts/error-codes.const'
import { IPlatformUsageRepository, PlatformDailyUsage } from './platform-usage-repository.interface'

export class PlatformUsageRepository implements IPlatformUsageRepository {
    private client: Pool

    constructor() {
        this.client = pgClient()
    }

    async getDailyPlatformUsage(userId: string, platform: string, date: Date): Promise<PlatformDailyUsage | null> {
        const client = await this.client.connect()
        try {
            const query = `SELECT * FROM platform_daily_usage WHERE user_id = $1 AND platform = $2 AND usage_date = $3`
            const result = await client.query(query, [userId, platform, date])

            if (result.rows.length === 0) return null

            const row = result.rows[0]
            return {
                id: row.id,
                userId: row.user_id,
                platform: row.platform,
                usageDate: row.usage_date,
                scheduledCount: row.scheduled_count,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
            }
        } catch (error: any) {
            throw new BaseAppError(`Failed to get daily platform usage: ${error.message}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async incrementScheduledCount(userId: string, platform: string, date: Date, count: number): Promise<void> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            const upsertQuery = `
                INSERT INTO platform_daily_usage (user_id, platform, usage_date, scheduled_count)
                VALUES ($1, $2, $3, GREATEST($4, 0))
                ON CONFLICT (user_id, platform, usage_date)
                DO UPDATE SET 
                    scheduled_count = GREATEST(platform_daily_usage.scheduled_count + $4, 0),
                    updated_at = NOW()
            `

            await client.query(upsertQuery, [userId, platform, date, count])
            await client.query('COMMIT')
        } catch (error: any) {
            await client.query('ROLLBACK')
            throw new BaseAppError(
                `Failed to increment scheduled count: ${error.message}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        } finally {
            client.release()
        }
    }
}
