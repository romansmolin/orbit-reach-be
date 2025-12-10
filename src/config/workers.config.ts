import { PostPlatformsWithoutX } from '@/schemas/posts.schemas'
import { SocialMediaPostSenderService } from '@/services/social-media-post-sender-service'
import { SocialMediaTokenRefresherService } from '@/services/social-media-token-refresher-service'
import { BullMqTokenRefreshScheduler, BullMqAccessTokenWorker, BullMqPostWorker } from '@/shared/infra/queue'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { UserService } from '@/services/users-service'

export interface Workers {
    accessTokensRefreshScheduler: BullMqTokenRefreshScheduler
    accessTokensRefreshWorker: BullMqAccessTokenWorker
    postWorkers: BullMqPostWorker[]
    planExpiryInterval?: NodeJS.Timeout
}

export async function initializeWorkers(
    logger: ILogger,
    socialMediaPostSender: SocialMediaPostSenderService,
    socialMediaTokenRefresher: SocialMediaTokenRefresherService,
    postsService: any, // PostService type
    userService: UserService
): Promise<Workers> {
    const accessTokensRefreshScheduler = new BullMqTokenRefreshScheduler()
    await accessTokensRefreshScheduler.scheduleDailyAccessTokenRefresh()

    const postWorkers = PostPlatformsWithoutX.map((platform) => {
        const worker = new BullMqPostWorker(platform, socialMediaPostSender)
        // Set up failure callback to update base post status
        console.log(`[WORKERS] Setting up failure callback for ${platform}, postsService:`, !!postsService)
        worker.setOnJobFailureCallback(postsService.checkAndUpdateBasePostStatus.bind(postsService))
        worker.start()
        return worker
    })

    const accessTokensRefreshWorker = new BullMqAccessTokenWorker(logger, socialMediaTokenRefresher)
    accessTokensRefreshWorker.start()

    const planExpiryIntervalMs = Number(process.env.PLAN_EXPIRY_CHECK_INTERVAL_MS || 60 * 1000)

    const runPlanExpiryCheck = async (): Promise<void> => {
        try {
            await userService.processExpiredPlans()
            logger.info('Plan expiry check completed', {
                operation: 'initializeWorkers.runPlanExpiryCheck',
                intervalMs: planExpiryIntervalMs,
            })
        } catch (error) {
            logger.error('Plan expiry check failed', {
                operation: 'initializeWorkers.runPlanExpiryCheck',
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              stack: error.stack,
                              code: (error as any).code,
                          }
                        : undefined,
            })
        }
    }

    await runPlanExpiryCheck()

    const planExpiryInterval = setInterval(runPlanExpiryCheck, planExpiryIntervalMs)

    return {
        accessTokensRefreshScheduler,
        accessTokensRefreshWorker,
        postWorkers,
        planExpiryInterval,
    }
}
