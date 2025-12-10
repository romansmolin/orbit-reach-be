import { Queue } from 'bullmq'
import { ITokenRefreshScheduler } from './token-refresh.interface'
import { redisConnection } from '../redis'

export class BullMqTokenRefreshScheduler implements ITokenRefreshScheduler {
    private accessTokenRefreshQueue: Queue

    constructor() {
        this.accessTokenRefreshQueue = new Queue('check-expiring-tokens', { connection: redisConnection })
    }

    async scheduleDailyAccessTokenRefresh(): Promise<void> {
        await this.accessTokenRefreshQueue.waitUntilReady()

        await this.accessTokenRefreshQueue.add(
            'refresh-access-tokens',
            {},
            {
                jobId: 'refresh-access-tokens',
                removeOnComplete: true,
                removeOnFail: false,
                repeat: { every: 60_000 },
            }
        )

        console.log('[Access Token Scheduler] repeat job registered (every 60s)')
    }
}
