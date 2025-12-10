// utils/jitter-utils.ts
import { createHash } from 'crypto'
import { PlatformConfigManager } from '../config/platform-config'
import { PostPlatform } from '../../../../schemas/posts.schemas'

export class JitterUtils {
    /**
     * Apply jitter to a scheduled time to spread load
     */
    static applyJitter(platform: PostPlatform, originalTime: Date, postId: string, userId: string): Date {
        const config = PlatformConfigManager.getConfig(platform)
        const jitterWindowMs = config.jitterWindowSec * 1000

        if (config.retryConfig.deterministicJitter) {
            return this.deterministicJitter(originalTime, jitterWindowMs, postId, userId)
        } else {
            return this.randomJitter(originalTime, jitterWindowMs)
        }
    }

    /**
     * Deterministic jitter based on hash of postId + userId
     */
    private static deterministicJitter(
        originalTime: Date,
        jitterWindowMs: number,
        postId: string,
        userId: string
    ): Date {
        const hash = createHash('sha256').update(`${postId}-${userId}`).digest('hex')

        // Use first 8 characters of hash to get a number between 0 and 1
        const hashValue = parseInt(hash.substring(0, 8), 16)
        const normalizedHash = hashValue / 0xffffffff

        // Apply jitter: -jitterWindow/2 to +jitterWindow/2
        const jitterMs = (normalizedHash - 0.5) * jitterWindowMs

        return new Date(originalTime.getTime() + jitterMs)
    }

    /**
     * Random jitter
     */
    private static randomJitter(originalTime: Date, jitterWindowMs: number): Date {
        const jitterMs = (Math.random() - 0.5) * jitterWindowMs
        return new Date(originalTime.getTime() + jitterMs)
    }

    /**
     * Calculate retry delay with exponential backoff and jitter
     */
    static calculateRetryDelay(platform: PostPlatform, attemptNumber: number, postId: string, userId: string): number {
        const config = PlatformConfigManager.getConfig(platform)
        const { baseDelaySec, jitterPercent, deterministicJitter } = config.retryConfig

        // Exponential backoff: baseDelay * 2^attempt
        const baseDelayMs = baseDelaySec * 1000 * Math.pow(2, attemptNumber - 1)

        // Apply jitter to prevent thundering herd
        const jitterRange = baseDelayMs * jitterPercent
        let jitter: number

        if (deterministicJitter) {
            const hash = createHash('sha256').update(`${postId}-${userId}-${attemptNumber}`).digest('hex')
            const hashValue = parseInt(hash.substring(0, 8), 16)
            const normalizedHash = hashValue / 0xffffffff
            jitter = (normalizedHash - 0.5) * 2 * jitterRange
        } else {
            jitter = (Math.random() - 0.5) * 2 * jitterRange
        }

        return Math.max(1000, baseDelayMs + jitter) // Minimum 1 second delay
    }

    /**
     * Check if we should apply warmup delay
     */
    static shouldApplyWarmup(scheduledTime: Date): boolean {
        const now = Date.now()
        const scheduledTimeMs = scheduledTime.getTime()
        const warmupTimeMs = PlatformConfigManager.getWarmupTime()

        return scheduledTimeMs - now < warmupTimeMs
    }

    /**
     * Calculate warmup delay to ensure minimum warmup time
     */
    static calculateWarmupDelay(scheduledTime: Date): number {
        const now = Date.now()
        const scheduledTimeMs = scheduledTime.getTime()
        const warmupTimeMs = PlatformConfigManager.getWarmupTime()
        const currentDelay = scheduledTimeMs - now

        // Skip warmup delay for posts scheduled within 5 minutes (300 seconds)
        // This prevents the 5-minute warmup delay for most user-scheduled posts
        if (currentDelay <= 300000) {
            return 0
        }

        if (currentDelay < warmupTimeMs) {
            return Math.max(0, warmupTimeMs - currentDelay)
        }

        return 0
    }
}

export interface RetryableError extends Error {
    isRetryable: boolean
    retryAfter?: number // seconds to wait before retry
}

export class RetryUtils {
    /**
     * Determine if an error is retryable
     */
    static isRetryableError(error: any): error is RetryableError {
        if (!error) return false

        // Network errors are typically retryable
        if (error.code === 'ENOTFOUND' || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            return true
        }

        // HTTP status codes that are retryable
        if (error.response?.status) {
            const status = error.response.status
            // 429 (Too Many Requests), 502, 503, 504 are retryable
            return [429, 502, 503, 504].includes(status)
        }

        // Platform-specific retryable errors
        if (error.message) {
            const message = error.message.toLowerCase()
            return (
                message.includes('rate limit') ||
                message.includes('timeout') ||
                message.includes('server error') ||
                message.includes('service unavailable') ||
                message.includes('temporary')
            )
        }

        return false
    }

    /**
     * Extract retry-after delay from error response
     */
    static extractRetryAfter(error: any): number | undefined {
        // Check Retry-After header (in seconds)
        if (error.response?.headers?.['retry-after']) {
            const retryAfter = parseInt(error.response.headers['retry-after'])
            return isNaN(retryAfter) ? undefined : retryAfter * 1000 // Convert to ms
        }

        // Check rate limit reset headers
        if (error.response?.headers?.['x-rate-limit-reset']) {
            const resetTime = parseInt(error.response.headers['x-rate-limit-reset'])
            if (!isNaN(resetTime)) {
                return Math.max(0, resetTime * 1000 - Date.now())
            }
        }

        // Platform-specific error parsing
        if (error.response?.data) {
            const data = error.response.data

            // TikTok specific
            if (data.error?.code === 'rate_limit_exceeded' && data.error?.retry_after) {
                return data.error.retry_after * 1000
            }

            // Generic API error with retry_after
            if (data.retry_after) {
                return data.retry_after * 1000
            }
        }

        return undefined
    }

    /**
     * Create a retryable error wrapper
     */
    static createRetryableError(originalError: Error, isRetryable: boolean, retryAfter?: number): RetryableError {
        const retryableError = originalError as RetryableError
        retryableError.isRetryable = isRetryable
        retryableError.retryAfter = retryAfter
        return retryableError
    }
}
