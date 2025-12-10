// enhanced-bullmq-post-worker.ts
import { Worker, Job } from 'bullmq'
import { PostPlatform } from '../../../../../schemas/posts.schemas'
import { PlatformConfigManager } from '../../config/platform-config'
import { redis, redisConnection } from '../../scheduler/redis'
import { RetryUtils, JitterUtils, RetryableError } from '../../utils/jitter'
import { PlatformRateLimiter } from '../../utils/rate-limiter'
import { PlatformLimits } from '../../config/platform-config'
import { IPostWorker } from './post-worker.interface'

import { ISocialMediaPostSenderService } from '@/services/social-media-post-sender-service'

export class BullMqPostWorker implements IPostWorker {
    private worker: Worker
    private socialMediaPostSender: ISocialMediaPostSenderService
    private rateLimiter: PlatformRateLimiter
    private config: any
    private onJobFailureCallback?: (userId: string, postId: string) => Promise<void>

    constructor(
        private platform: PostPlatform,
        postInteractor: ISocialMediaPostSenderService
    ) {
        this.config = PlatformConfigManager.getConfig(platform)
        this.rateLimiter = new PlatformRateLimiter(redis)
        this.socialMediaPostSender = postInteractor

        this.worker = new Worker(`${platform}-scheduler`, async (job) => this.handleJob(job), {
            connection: redisConnection,
            concurrency: this.config.maxConcurrency,
            limiter: {
                max: this.calculateLimiterMax(),
                duration: this.calculateLimiterDuration(),
            },
            settings: {
                // @ts-ignore
                backoffStrategy: this.customBackoffStrategy.bind(this),
                retryProcessDelay: 1000, // 1 second between retry checks
            },
        })
    }

    setOnJobFailureCallback(callback: (userId: string, postId: string) => Promise<void>): void {
        this.onJobFailureCallback = callback
    }

    private calculateLimiterMax(): number {
        // Calculate based on platform limits
        const limits = this.config.limits

        if (limits.postsPerMinute) {
            return Math.min(limits.postsPerMinute, this.config.maxConcurrency)
        }

        if (limits.requestsPer5Min) {
            // Convert 5-minute limit to per-minute
            return Math.min(Math.floor(limits.requestsPer5Min / 5), this.config.maxConcurrency)
        }

        if (limits.requestsPerHour) {
            // Convert hourly limit to per-minute
            return Math.min(Math.floor(limits.requestsPerHour / 60), this.config.maxConcurrency)
        }

        // Default fallback
        return this.config.maxConcurrency
    }

    private calculateLimiterDuration(): number {
        // Duration in milliseconds
        const limits = this.config.limits

        if (limits.postsPerMinute) {
            return 60 * 1000 // 1 minute
        }

        if (limits.requestsPer5Min) {
            return 5 * 60 * 1000 // 5 minutes
        }

        return 60 * 1000 // Default 1 minute
    }

    private customBackoffStrategy(attemptsMade: number, err: any, job: Job): number {
        // Check if job.data exists before destructuring
        if (!job.data) {
            console.log(`[${this.platform}] Job data is undefined for job ${job.id}, not retrying`)
            return -1 // Don't retry
        }

        const { postId, userId } = job.data

        // Check if it's a retryable error
        if (!RetryUtils.isRetryableError(err)) {
            console.log(`[${this.platform}] Non-retryable error for job ${job.id}, not retrying`)
            return -1 // Don't retry
        }

        // Check if we've exceeded max retries
        if (attemptsMade >= this.config.retryConfig.maxRetries) {
            console.log(`[${this.platform}] Max retries exceeded for job ${job.id}`)
            return -1 // Don't retry
        }

        // Extract retry-after from error if available
        const errorRetryAfter = RetryUtils.extractRetryAfter(err)
        if (errorRetryAfter) {
            console.log(`[${this.platform}] Using error-specified retry delay: ${errorRetryAfter}ms for job ${job.id}`)
            return errorRetryAfter
        }

        // Calculate exponential backoff with jitter
        const retryDelay = JitterUtils.calculateRetryDelay(this.platform, attemptsMade, postId, userId)

        console.log(
            `[${this.platform}] Calculated retry delay: ${retryDelay}ms for job ${job.id}, attempt ${attemptsMade}`
        )
        return retryDelay
    }

    start(): void {
        this.worker.on('completed', (job) => {
            const { postId, userId } = job.data
            console.log(`[${this.platform}] Job ${job.id} completed successfully:`, {
                postId,
                userId,
                attempts: job.attemptsMade,
                processingTime: job.processedOn ? job.finishedOn! - job.processedOn : 'unknown',
            })
        })

        this.worker.on('failed', (job, err) => {
            if (!job) return

            const { postId, userId } = job.data
            const isRetryable = RetryUtils.isRetryableError(err)
            const willRetry = job.attemptsMade < this.config.retryConfig.maxRetries && isRetryable

            console.error(`[${this.platform}] Job ${job.id} failed:`, {
                postId,
                userId,
                attempts: job.attemptsMade,
                maxAttempts: this.config.retryConfig.maxRetries,
                error: err.message,
                isRetryable,
                willRetry,
                processingTime: job.processedOn ? job.finishedOn! - job.processedOn : 'unknown',
            })
        })

        this.worker.on('stalled', (jobId) => {
            console.warn(`[${this.platform}] Job ${jobId} stalled and will be retried`)
        })

        this.worker.on('progress', (job, progress) => {
            console.log(`[${this.platform}] Job ${job.id} progress: ${progress}%`)
        })

        this.worker.on('error', (err) => {
            console.error(`[${this.platform}] Worker error:`, err)
        })

        console.log(`[${this.platform}] Worker started with config:`, {
            concurrency: this.config.maxConcurrency,
            maxRetries: this.config.retryConfig.maxRetries,
            limiterMax: this.calculateLimiterMax(),
            limiterDuration: this.calculateLimiterDuration(),
        })
    }

    async stop(): Promise<void> {
        console.log(`[${this.platform}] Stopping worker...`)
        await this.worker.close()
        console.log(`[${this.platform}] Worker stopped`)
    }

    private async handleJob(job: Job): Promise<void> {
        const { postId, userId, platform, socialAccountId } = job.data
        const startTime = Date.now()

        console.log(`[${this.platform}] Starting job ${job.id}:`, {
            postId,
            userId,
            socialAccountId,
            attempt: job.attemptsMade + 1,
            maxAttempts: this.config.retryConfig.maxRetries + 1,
            scheduledFor: job.data.jitteredScheduledDate || job.data.originalScheduledDate,
        })

        try {
            // Update status: Uploading
            await job.updateProgress(10)
            await this.updateJobStatus(job, 'uploading', 'Starting upload process')

            // Pre-flight rate limit check (both per-account and per-app)
            const rateLimitResult = await this.rateLimiter.checkRateLimit(platform, userId, socialAccountId, postId)

            if (!rateLimitResult.allowed) {
                const retryAfter = rateLimitResult.retryAfter || 60 // Default 1 minute
                const error = RetryUtils.createRetryableError(
                    new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds`),
                    true,
                    retryAfter
                )
                await this.updateJobStatus(job, 'rate_limited', `Rate limit exceeded. Retry after ${retryAfter}s`)
                throw error
            }

            // Update status: Processing
            await job.updateProgress(25)
            await this.updateJobStatus(job, 'processing', 'Rate limits passed, processing post')

            // Perform the actual post sending
            await this.socialMediaPostSender.sendPost(userId, postId, platform, socialAccountId)

            // Update status: Published
            await job.updateProgress(75)
            await this.updateJobStatus(job, 'published', 'Post published successfully')

            // Increment both per-account and per-app usage counters only on success
            await this.rateLimiter.incrementUsage(platform, userId, socialAccountId)
            await this.rateLimiter.incrementAppUsage(platform, userId)

            // Final progress update
            await job.updateProgress(100)

            const endTime = Date.now()
            const duration = endTime - startTime

            console.log(`[${this.platform}] Job ${job.id} completed successfully:`, {
                postId,
                userId,
                attempt: job.attemptsMade + 1,
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                duration: `${duration}ms`,
                remainingQuota: rateLimitResult.remainingQuota,
                status: 'published',
            })

            // Emit metrics
            this.emitMetrics('success', duration, rateLimitResult.remainingQuota)
        } catch (error) {
            const endTime = Date.now()
            const duration = endTime - startTime

            // Determine if error is retryable
            const isRetryable = RetryUtils.isRetryableError(error)
            const retryAfter = RetryUtils.extractRetryAfter(error)

            // Convert to retryable error if not already
            const retryableError = isRetryable
                ? (error as RetryableError)
                : RetryUtils.createRetryableError(error as Error, false)

            // Update status based on error type
            const status = isRetryable ? 'retrying' : 'failed'
            const message = isRetryable
                ? `Temporary error: ${retryableError.message}`
                : `Permanent error: ${retryableError.message}`

            await this.updateJobStatus(job, status, message)

            console.error(`[${this.platform}] Job ${job.id} failed:`, {
                postId,
                userId,
                attempt: job.attemptsMade + 1,
                maxAttempts: this.config.retryConfig.maxRetries + 1,
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                duration: `${duration}ms`,
                error: retryableError.message,
                isRetryable: retryableError.isRetryable,
                retryAfter: retryableError.retryAfter,
                status,
                stack: retryableError.stack,
            })

            // Emit metrics
            const metricsType = isRetryable ? 'retry' : 'error'
            this.emitMetrics(metricsType, duration, 0, retryableError.message)

            // Call failure callback to update base post status
            if (this.onJobFailureCallback) {
                try {
                    console.log(`[${this.platform}] Calling failure callback for post ${postId}`)
                    await this.onJobFailureCallback(userId, postId)
                    console.log(`[${this.platform}] Failure callback completed for post ${postId}`)
                } catch (callbackError) {
                    console.error(`[${this.platform}] Failed to call job failure callback:`, callbackError)
                }
            } else {
                console.log(`[${this.platform}] No failure callback set for post ${postId}`)
            }

            // Re-throw the error for BullMQ to handle retries
            throw retryableError
        }
    }

    async getWorkerMetrics(): Promise<{
        isRunning: boolean
        concurrency: number
        processing: number
        name: string
        opts: any
    }> {
        return {
            isRunning: !this.worker.closing,
            concurrency: this.config.maxConcurrency,

            processing: 0, // TODO: Find proper way to get active job count from BullMQ worker
            name: this.worker.name,
            opts: {
                limiter: this.worker.opts.limiter,
                concurrency: this.worker.opts.concurrency,
            },
        }
    }

    async pauseWorker(): Promise<void> {
        await this.worker.pause()
        console.log(`[${this.platform}] Worker paused`)
    }

    async resumeWorker(): Promise<void> {
        this.worker.resume()
        console.log(`[${this.platform}] Worker resumed`)
    }

    // ========== HELPER METHODS ==========

    private async updateJobStatus(job: Job, status: string, message: string): Promise<void> {
        try {
            await job.updateData({
                ...job.data,
                status,
                statusMessage: message,
                statusUpdatedAt: new Date().toISOString(),
            })
        } catch (error) {
            console.warn(`[${this.platform}] Failed to update job status:`, error)
        }
    }

    private emitMetrics(
        type: 'success' | 'error' | 'retry' | 'rate_limited',
        duration: number,
        remainingQuota: number,
        errorMessage?: string
    ): void {
        // Log metrics (you can integrate with your existing monitoring system)
        console.log(`[METRICS] ${this.platform}:`, {
            type,
            duration,
            remainingQuota,
            timestamp: new Date().toISOString(),
            ...(errorMessage && { errorMessage }),
        })
    }

    // ========== QUOTA MANAGEMENT ==========

    async getQuotaStatus(
        platform: PostPlatform,
        userId?: string
    ): Promise<{
        perAccount: any
        perApp: any
        warnings: string[]
    }> {
        const config = PlatformConfigManager.getConfig(platform)
        const limits = config.limits
        const now = Date.now()

        const warnings: string[] = []

        // Check per-account quota
        const perAccountResult = userId
            ? await this.rateLimiter.checkRateLimit(platform, userId)
            : { allowed: true, remainingQuota: Infinity, resetTime: new Date() }

        // Check per-app quota
        const perAppResult = await this.checkAppQuotaStatus(platform, limits, now)

        // Generate warnings
        if (
            limits.warnThresholdPct &&
            limits.appDailyLimit &&
            perAppResult.remainingQuota < limits.appDailyLimit * limits.warnThresholdPct
        ) {
            warnings.push(
                `App quota usage at ${Math.round((1 - perAppResult.remainingQuota / limits.appDailyLimit) * 100)}%`
            )
        }

        if (perAccountResult.remainingQuota < 5) {
            warnings.push(`User quota low: ${perAccountResult.remainingQuota} remaining`)
        }

        return {
            perAccount: perAccountResult,
            perApp: perAppResult,
            warnings,
        }
    }

    private async checkAppQuotaStatus(platform: PostPlatform, limits: PlatformLimits, now: number): Promise<any> {
        if (!limits.appDailyLimit) {
            return { allowed: true, remainingQuota: Infinity, resetTime: new Date() }
        }

        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

        const key = `app_rate_limit:${platform}:daily:${dayStart.getTime()}`
        const current = await redis.get(key)
        const currentCount = current ? parseInt(current) : 0

        return {
            allowed: currentCount < limits.appDailyLimit,
            remainingQuota: Math.max(0, limits.appDailyLimit - currentCount),
            resetTime: dayEnd,
            usage: currentCount,
            limit: limits.appDailyLimit,
        }
    }
}
