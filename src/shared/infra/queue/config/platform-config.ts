// config/platform-config.ts
import { PostPlatform, SocilaMediaPlatform } from '../../../../schemas/posts.schemas'

export interface PlatformLimits {
    postsPerDay?: number
    postsPerMinute?: number
    quotaUnits?: number
    costPerPost?: number
    requestsPerHour?: number
    requestsPer5Min?: number
    pointsPerPost?: number
    pointsPerDay?: number

    // Дополнительно
    appDailyLimit?: number // например Pinterest trial 1000/day
    appRps?: number // LinkedIn ~1 RPS
    appBurst?: number // LinkedIn burst
    warnThresholdPct?: number // YouTube quota warn %
}

export interface PlatformConfig {
    maxConcurrency: number
    jitterWindowSec: number
    limits: PlatformLimits
    retryConfig: {
        maxRetries: number
        baseDelaySec: number
        jitterPercent: number
        deterministicJitter: boolean
    }
    auditApproved?: boolean // TikTok/LinkedIn audit flags
}

export class PlatformConfigManager {
    private static configs: Omit<Record<PostPlatform, PlatformConfig>, 'x'> = {
        [SocilaMediaPlatform.TIKTOK]: {
            maxConcurrency: parseInt(process.env.TIKTOK_MAX_CONCURRENCY || '3'),
            jitterWindowSec: parseInt(process.env.TIKTOK_JITTER_WINDOW_SEC || '120'),
            limits: {
                postsPerDay: parseInt(process.env.TIKTOK_POSTS_PER_DAY || '15'),
                postsPerMinute: parseInt(process.env.TIKTOK_POSTS_PER_MINUTE || '6'),
            },
            retryConfig: {
                maxRetries: parseInt(process.env.SCHEDULER_MAX_RETRIES || '0'), // Disable retries by default
                baseDelaySec: parseInt(process.env.SCHEDULER_BACKOFF_BASE_SEC || '30'),
                jitterPercent: parseFloat(process.env.SCHEDULER_BACKOFF_JITTER_PCT || '0.15'),
                deterministicJitter: process.env.SCHEDULER_DETERMINISTIC_JITTER === 'true',
            },
            auditApproved: process.env.TIKTOK_AUDITED === 'true',
        },
        [SocilaMediaPlatform.YOUTUBE]: {
            maxConcurrency: parseInt(process.env.YOUTUBE_MAX_PARALLEL_UPLOADS || '2'),
            jitterWindowSec: parseInt(process.env.YOUTUBE_JITTER_WINDOW_SEC || '180'),
            limits: {
                postsPerDay: parseInt(process.env.YOUTUBE_POSTS_PER_DAY || '100'), // Official limit: ~100 uploads/day per channel
                quotaUnits: parseInt(process.env.YOUTUBE_DEFAULT_QUOTA || '10000'),
                costPerPost: parseInt(process.env.YOUTUBE_UPLOAD_COST || '1600'),
                warnThresholdPct: parseFloat(process.env.YOUTUBE_QUOTA_WARN_PCT || '0.2'),
                appDailyLimit: parseInt(
                    process.env.LIMIT_PROFILE === 'prod'
                        ? process.env.YOUTUBE_QUOTA_DAILY_PROD || '300000'
                        : process.env.YOUTUBE_QUOTA_DAILY_DEMO || '10000'
                ),
            },
            retryConfig: {
                maxRetries: parseInt(process.env.SCHEDULER_MAX_RETRIES || '0'), // Disable retries by default
                baseDelaySec: parseInt(process.env.SCHEDULER_BACKOFF_BASE_SEC || '30'),
                jitterPercent: parseFloat(process.env.SCHEDULER_BACKOFF_JITTER_PCT || '0.15'),
                deterministicJitter: process.env.SCHEDULER_DETERMINISTIC_JITTER === 'true',
            },
        },
        [SocilaMediaPlatform.PINTEREST]: {
            maxConcurrency: parseInt(process.env.PINTEREST_MAX_CONCURRENCY || '5'),
            jitterWindowSec: parseInt(process.env.PINTEREST_JITTER_WINDOW_SEC || '90'),
            limits: {
                postsPerDay: parseInt(process.env.PINTEREST_POSTS_PER_DAY || '200'), // Official limit: ≤200 posts/day per account
                requestsPerHour: parseInt(process.env.PINTEREST_TRIAL_DAILY_LIMIT || '1000') / 24,
                appDailyLimit: parseInt(
                    process.env.PINTEREST_ENV === 'prod'
                        ? process.env.PINTEREST_APP_DAILY_CALLS_PROD || '100000'
                        : process.env.PINTEREST_APP_DAILY_CALLS_DEMO || '1000'
                ),
                warnThresholdPct: parseFloat(process.env.PINTEREST_APP_WARN_PCT || '0.8'),
            },
            retryConfig: {
                maxRetries: parseInt(process.env.SCHEDULER_MAX_RETRIES || '0'), // Disable retries by default
                baseDelaySec: parseInt(process.env.SCHEDULER_BACKOFF_BASE_SEC || '30'),
                jitterPercent: parseFloat(process.env.SCHEDULER_BACKOFF_JITTER_PCT || '0.15'),
                deterministicJitter: process.env.SCHEDULER_DETERMINISTIC_JITTER === 'true',
            },
        },
        [SocilaMediaPlatform.INSTAGRAM]: {
            maxConcurrency: parseInt(process.env.META_MAX_CONCURRENCY || '5'),
            jitterWindowSec: parseInt(process.env.INSTAGRAM_JITTER_WINDOW_SEC || '45'),
            limits: {
                postsPerDay: parseInt(process.env.INSTAGRAM_POSTS_PER_DAY || '50'),
                requestsPerHour: parseInt(process.env.INSTAGRAM_API_CALLS_PER_HOUR || '200'), // Official limit: 200 calls/hour/token
            },
            retryConfig: {
                maxRetries: parseInt(process.env.SCHEDULER_MAX_RETRIES || '0'), // Disable retries by default
                baseDelaySec: parseInt(process.env.SCHEDULER_BACKOFF_BASE_SEC || '30'),
                jitterPercent: parseFloat(process.env.SCHEDULER_BACKOFF_JITTER_PCT || '0.15'),
                deterministicJitter: process.env.SCHEDULER_DETERMINISTIC_JITTER === 'true',
            },
        },
        [SocilaMediaPlatform.THREADS]: {
            maxConcurrency: parseInt(process.env.META_MAX_CONCURRENCY || '5'),
            jitterWindowSec: parseInt(process.env.THREADS_JITTER_WINDOW_SEC || '45'),
            limits: {
                postsPerDay: parseInt(process.env.THREADS_POSTS_PER_DAY || '250'),
                requestsPerHour: parseInt(process.env.THREADS_API_CALLS_PER_HOUR || '200'), // Official limit: 200 calls/hour/token
            },
            retryConfig: {
                maxRetries: parseInt(process.env.SCHEDULER_MAX_RETRIES || '0'), // Disable retries by default
                baseDelaySec: parseInt(process.env.SCHEDULER_BACKOFF_BASE_SEC || '30'),
                jitterPercent: parseFloat(process.env.SCHEDULER_BACKOFF_JITTER_PCT || '0.15'),
                deterministicJitter: process.env.SCHEDULER_DETERMINISTIC_JITTER === 'true',
            },
        },
        [SocilaMediaPlatform.FACEBOOK]: {
            maxConcurrency: parseInt(process.env.META_MAX_CONCURRENCY || '5'),
            jitterWindowSec: parseInt(process.env.FACEBOOK_JITTER_WINDOW_SEC || '45'),
            limits: {
                postsPerDay: parseInt(process.env.FACEBOOK_RECOMMENDED_POSTS_PER_DAY || '25'),
                requestsPerHour: parseInt(process.env.FACEBOOK_API_RATE_LIMIT_PER_HOUR || '200'), // Official limit: 200 calls/hour/token
            },
            retryConfig: {
                maxRetries: parseInt(process.env.SCHEDULER_MAX_RETRIES || '0'), // Disable retries by default
                baseDelaySec: parseInt(process.env.SCHEDULER_BACKOFF_BASE_SEC || '30'),
                jitterPercent: parseFloat(process.env.SCHEDULER_BACKOFF_JITTER_PCT || '0.15'),
                deterministicJitter: process.env.SCHEDULER_DETERMINISTIC_JITTER === 'true',
            },
        },
        [SocilaMediaPlatform.BLUESKY]: {
            maxConcurrency: parseInt(process.env.BLUESKY_MAX_CONCURRENCY || '10'),
            jitterWindowSec: parseInt(process.env.BLUESKY_JITTER_WINDOW_SEC || '30'),
            limits: {
                postsPerDay: parseInt(process.env.BLUESKY_POSTS_PER_DAY || '11600'), // Official limit: ~11,600 posts/day (35k points ÷ 3 points/post)
                pointsPerPost: parseInt(process.env.BLUESKY_POINTS_PER_POST || '3'),
                pointsPerDay: parseInt(process.env.BLUESKY_POINTS_PER_DAY || '35000'),
                requestsPer5Min: parseInt(process.env.BLUESKY_REQUESTS_PER_5MIN || '3000'),
            },
            retryConfig: {
                maxRetries: parseInt(process.env.SCHEDULER_MAX_RETRIES || '0'), // Disable retries by default
                baseDelaySec: parseInt(process.env.SCHEDULER_BACKOFF_BASE_SEC || '30'),
                jitterPercent: parseFloat(process.env.SCHEDULER_BACKOFF_JITTER_PCT || '0.15'),
                deterministicJitter: process.env.SCHEDULER_DETERMINISTIC_JITTER === 'true',
            },
        },
        [SocilaMediaPlatform.LINKEDIN]: {
            maxConcurrency: parseInt(process.env.LINKEDIN_MAX_CONCURRENCY || '1'),
            jitterWindowSec: parseInt(process.env.LINKEDIN_JITTER_WINDOW_SEC || '60'),
            limits: {
                postsPerDay: parseInt(process.env.LINKEDIN_POSTS_PER_DAY || '150'),
                appRps: parseInt(process.env.LINKEDIN_APP_THROTTLE_RPS || '1'),
                appBurst: parseInt(process.env.LINKEDIN_APP_BURST || '2'),
            },
            retryConfig: {
                maxRetries: parseInt(process.env.SCHEDULER_MAX_RETRIES || '0'), // Disable retries by default
                baseDelaySec: parseInt(process.env.SCHEDULER_BACKOFF_BASE_SEC || '30'),
                jitterPercent: parseFloat(process.env.SCHEDULER_BACKOFF_JITTER_PCT || '0.15'),
                deterministicJitter: process.env.SCHEDULER_DETERMINISTIC_JITTER === 'true',
            },
            auditApproved: process.env.LINKEDIN_MDP_APPROVED === 'true',
        },
    }

    static getConfig(platform: PostPlatform): PlatformConfig {
        const config = this.configs[platform as keyof typeof this.configs]
        if (!config) {
            throw new Error(`No configuration found for platform: ${platform}`)
        }
        return config
    }

    static getAllConfigs(): Omit<Record<PostPlatform, PlatformConfig>, 'x'> {
        return this.configs
    }

    static getWarmupTime(): number {
        return parseInt(process.env.SCHEDULER_MIN_WARMUP_SEC || '300') * 1000 // Convert to ms
    }
}
