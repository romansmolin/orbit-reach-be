import { Worker, Job } from 'bullmq'

import { IAccessTokenWorker } from './access-token-worker.interface'
import { redisConnection } from '../../scheduler/redis'
import { ISocialMediaTokenRefresherService } from '@/services/social-media-token-refresher-service'
import { ILogger } from '@/shared/infra/logger/logger.interface'

export class BullMqAccessTokenWorker implements IAccessTokenWorker {
    private worker: Worker
    private socialMediaTokenRefresher: ISocialMediaTokenRefresherService
    private logger: ILogger

    private async checkForExpiringTokensAndUpdate(job: Job): Promise<void> {
        this.logger.info('[Access Token Worker] Processing job', {
            jobId: job.id,
            name: job.name,
        })

        try {
            const { accountIds } = await this.socialMediaTokenRefresher.findExpiringAccessTokensAndUpdate()

            this.logger.info('[Access Token Worker] Job finished successfully', {
                jobId: job.id,
                name: job.name,
                updatedAccounts: accountIds.length,
            })
        } catch (error: unknown) {
            this.logger.error('[Access Token Worker] Job failed during execution', {
                jobId: job.id,
                name: job.name,
                reason: error instanceof Error ? error.message : 'Failed to refresh social tokens',
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof Error && 'code' in error ? (error as any).code : undefined,
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })

            if (error instanceof Error) {
                throw error
            }

            throw new Error('Failed to refresh social tokens')
        }
    }

    constructor(logger: ILogger, socialMediaTokenRefresher: ISocialMediaTokenRefresherService) {
        this.logger = logger
        this.socialMediaTokenRefresher = socialMediaTokenRefresher
        this.worker = new Worker('check-expiring-tokens', async (job) => this.checkForExpiringTokensAndUpdate(job), {
            connection: redisConnection,
        })
    }

    start(): void {
        this.worker.on('completed', (job) => {
            this.logger.info('[Access Token Worker] Job completed', {
                jobId: job.id,
                name: job.name,
            })
        })

        this.worker.on('failed', (job, err) => {
            this.logger.error('[Access Token Worker] Job failed', {
                jobId: job?.id,
                name: job?.name,
                reason: err instanceof Error ? err.message : 'Unknown error',
                error: {
                    name: err instanceof Error ? err.name : 'Unknown Error',
                    code: err instanceof Error && 'code' in err ? (err as any).code : undefined,
                    stack: err instanceof Error ? err.stack : undefined,
                },
            })
        })

        this.worker.on('error', (err) => {
            this.logger.error('[Access Token Worker] Worker encountered an error', {
                reason: err instanceof Error ? err.message : 'Unknown error',
                error: {
                    name: err instanceof Error ? err.name : 'Unknown Error',
                    code: err instanceof Error && 'code' in err ? (err as any).code : undefined,
                    stack: err instanceof Error ? err.stack : undefined,
                },
            })
        })

        this.logger.info('Access Token Worker started')
    }

    async stop(): Promise<void> {
        await this.worker.close()
    }
}
