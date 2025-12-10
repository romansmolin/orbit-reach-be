// utils/rate-limiter.ts
import { Redis } from 'ioredis'
import { PostPlatform } from '../../../../schemas/posts.schemas'
import { PlatformConfigManager, PlatformLimits } from '../config/platform-config'

export interface RateLimitResult {
    allowed: boolean
    remainingQuota: number
    resetTime: Date
    retryAfter?: number // seconds to wait if not allowed
}

export class PlatformRateLimiter {
    constructor(private redis: Redis) {}

    async getPlatformConfig(platform: PostPlatform) {
        return PlatformConfigManager.getConfig(platform)
    }

    async checkRateLimit(
        platform: PostPlatform,
        userId: string,
        socialAccountId?: string,
        postId?: string
    ): Promise<RateLimitResult> {
        const config = PlatformConfigManager.getConfig(platform)
        const limits = config.limits
        const now = Date.now()

        // Use socialAccountId for per-account limits, userId for per-app limits
        const accountId = socialAccountId || userId

        // Check both per-account and per-app limits
        const checks = [
            // Per-account limits (use socialAccountId if available)
            this.checkDailyPostLimit(platform, accountId, limits, now),
            this.checkMinutePostLimit(platform, accountId, limits, now),
            this.checkHourlyRequestLimit(platform, accountId, limits, now),
            this.checkFiveMinuteRequestLimit(platform, accountId, limits, now),

            // Per-app limits (always use userId)
            this.checkAppDailyLimit(platform, limits, now),
            this.checkAppRpsLimit(platform, limits, now),
            this.checkAppQuotaLimit(platform, limits, now),
        ]

        // Only add user limit check for non-TikTok platforms (TikTok is handled in checkAppDailyLimit)
        if (platform !== 'tiktok') {
            checks.push(this.checkAppUserLimit(platform, userId, limits, now))
        }

        // Special handling for platforms with mixed limits
        if (platform === 'youtube') {
            // YouTube: postsPerDay is per-account, quotaUnits is per-app
            checks.push(this.checkQuotaLimit(platform, userId, limits, now)) // App-level quota
        } else {
            // Other platforms: quota and points are per-account
            checks.push(this.checkQuotaLimit(platform, accountId, limits, now))
            checks.push(this.checkPointsLimit(platform, accountId, limits, now))
        }

        const results = await Promise.all(checks)

        // Find the most restrictive limit
        const mostRestrictive = results.reduce(
            (prev, current) => {
                if (!current) return prev
                if (!prev) return current
                return current.retryAfter && current.retryAfter > (prev.retryAfter || 0) ? current : prev
            },
            null as RateLimitResult | null
        )

        return (
            mostRestrictive || {
                allowed: true,
                remainingQuota: Infinity,
                resetTime: new Date(now + 24 * 60 * 60 * 1000), // 24 hours from now
            }
        )
    }

    private async checkDailyPostLimit(
        platform: PostPlatform,
        userId: string,
        limits: PlatformLimits,
        now: number
    ): Promise<RateLimitResult | null> {
        if (!limits.postsPerDay) return null

        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

        const key = `rate_limit:${platform}:${userId}:daily:${dayStart.getTime()}`
        const current = await this.redis.get(key)
        const currentCount = current ? parseInt(current) : 0

        if (currentCount >= limits.postsPerDay) {
            return {
                allowed: false,
                remainingQuota: 0,
                resetTime: dayEnd,
                retryAfter: Math.ceil((dayEnd.getTime() - now) / 1000),
            }
        }

        return {
            allowed: true,
            remainingQuota: limits.postsPerDay - currentCount,
            resetTime: dayEnd,
        }
    }

    private async checkMinutePostLimit(
        platform: PostPlatform,
        userId: string,
        limits: PlatformLimits,
        now: number
    ): Promise<RateLimitResult | null> {
        if (!limits.postsPerMinute) return null

        const minuteStart = Math.floor(now / (60 * 1000)) * 60 * 1000
        const minuteEnd = minuteStart + 60 * 1000

        const key = `rate_limit:${platform}:${userId}:minute:${minuteStart}`
        const current = await this.redis.get(key)
        const currentCount = current ? parseInt(current) : 0

        if (currentCount >= limits.postsPerMinute) {
            return {
                allowed: false,
                remainingQuota: 0,
                resetTime: new Date(minuteEnd),
                retryAfter: Math.ceil((minuteEnd - now) / 1000),
            }
        }

        return {
            allowed: true,
            remainingQuota: limits.postsPerMinute - currentCount,
            resetTime: new Date(minuteEnd),
        }
    }

    private async checkHourlyRequestLimit(
        platform: PostPlatform,
        userId: string,
        limits: PlatformLimits,
        now: number
    ): Promise<RateLimitResult | null> {
        if (!limits.requestsPerHour) return null

        const hourStart = Math.floor(now / (60 * 60 * 1000)) * 60 * 60 * 1000
        const hourEnd = hourStart + 60 * 60 * 1000

        const key = `rate_limit:${platform}:${userId}:hour:${hourStart}`
        const current = await this.redis.get(key)
        const currentCount = current ? parseInt(current) : 0

        if (currentCount >= limits.requestsPerHour) {
            return {
                allowed: false,
                remainingQuota: 0,
                resetTime: new Date(hourEnd),
                retryAfter: Math.ceil((hourEnd - now) / 1000),
            }
        }

        return {
            allowed: true,
            remainingQuota: limits.requestsPerHour - currentCount,
            resetTime: new Date(hourEnd),
        }
    }

    private async checkFiveMinuteRequestLimit(
        platform: PostPlatform,
        userId: string,
        limits: PlatformLimits,
        now: number
    ): Promise<RateLimitResult | null> {
        if (!limits.requestsPer5Min) return null

        const fiveMinStart = Math.floor(now / (5 * 60 * 1000)) * 5 * 60 * 1000
        const fiveMinEnd = fiveMinStart + 5 * 60 * 1000

        const key = `rate_limit:${platform}:${userId}:5min:${fiveMinStart}`
        const current = await this.redis.get(key)
        const currentCount = current ? parseInt(current) : 0

        if (currentCount >= limits.requestsPer5Min) {
            return {
                allowed: false,
                remainingQuota: 0,
                resetTime: new Date(fiveMinEnd),
                retryAfter: Math.ceil((fiveMinEnd - now) / 1000),
            }
        }

        return {
            allowed: true,
            remainingQuota: limits.requestsPer5Min - currentCount,
            resetTime: new Date(fiveMinEnd),
        }
    }

    private async checkQuotaLimit(
        platform: PostPlatform,
        userId: string,
        limits: PlatformLimits,
        now: number
    ): Promise<RateLimitResult | null> {
        if (!limits.quotaUnits || !limits.costPerPost) return null

        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

        // YouTube quota is per-app, other platforms are per-account
        const key =
            platform === 'youtube'
                ? `rate_limit:${platform}:app:quota:${dayStart.getTime()}`
                : `rate_limit:${platform}:${userId}:quota:${dayStart.getTime()}`
        const current = await this.redis.get(key)
        const currentQuota = current ? parseInt(current) : 0

        if (currentQuota + limits.costPerPost > limits.quotaUnits) {
            return {
                allowed: false,
                remainingQuota: Math.max(0, limits.quotaUnits - currentQuota),
                resetTime: dayEnd,
                retryAfter: Math.ceil((dayEnd.getTime() - now) / 1000),
            }
        }

        return {
            allowed: true,
            remainingQuota: limits.quotaUnits - currentQuota,
            resetTime: dayEnd,
        }
    }

    private async checkPointsLimit(
        platform: PostPlatform,
        userId: string,
        limits: PlatformLimits,
        now: number
    ): Promise<RateLimitResult | null> {
        if (!limits.pointsPerPost || !limits.pointsPerDay) return null

        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

        const key = `rate_limit:${platform}:${userId}:points:${dayStart.getTime()}`
        const current = await this.redis.get(key)
        const currentPoints = current ? parseInt(current) : 0

        if (currentPoints + limits.pointsPerPost > limits.pointsPerDay) {
            return {
                allowed: false,
                remainingQuota: Math.max(0, Math.floor((limits.pointsPerDay - currentPoints) / limits.pointsPerPost)),
                resetTime: dayEnd,
                retryAfter: Math.ceil((dayEnd.getTime() - now) / 1000),
            }
        }

        return {
            allowed: true,
            remainingQuota: Math.floor((limits.pointsPerDay - currentPoints) / limits.pointsPerPost),
            resetTime: dayEnd,
        }
    }

    async incrementUsage(platform: PostPlatform, userId: string, socialAccountId?: string): Promise<void> {
        const config = PlatformConfigManager.getConfig(platform)
        const limits = config.limits
        const now = Date.now()

        // Use socialAccountId for per-account limits, userId for per-app limits
        const accountId = socialAccountId || userId

        const operations: Promise<any>[] = []

        // Increment daily post counter
        if (limits.postsPerDay) {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)
            const key = `rate_limit:${platform}:${accountId}:daily:${dayStart.getTime()}`
            operations.push(this.redis.incr(key))
            operations.push(this.redis.expire(key, 86400)) // 24 hours
        }

        // Increment minute post counter
        if (limits.postsPerMinute) {
            const minuteStart = Math.floor(now / (60 * 1000)) * 60 * 1000
            const key = `rate_limit:${platform}:${accountId}:minute:${minuteStart}`
            operations.push(this.redis.incr(key))
            operations.push(this.redis.expire(key, 60)) // 1 minute
        }

        // Increment hourly request counter
        if (limits.requestsPerHour) {
            const hourStart = Math.floor(now / (60 * 60 * 1000)) * 60 * 60 * 1000
            const key = `rate_limit:${platform}:${accountId}:hour:${hourStart}`
            operations.push(this.redis.incr(key))
            operations.push(this.redis.expire(key, 3600)) // 1 hour
        }

        // Increment 5-minute request counter
        if (limits.requestsPer5Min) {
            const fiveMinStart = Math.floor(now / (5 * 60 * 1000)) * 5 * 60 * 1000
            const key = `rate_limit:${platform}:${accountId}:5min:${fiveMinStart}`
            operations.push(this.redis.incr(key))
            operations.push(this.redis.expire(key, 300)) // 5 minutes
        }

        // Increment quota usage
        if (limits.quotaUnits && limits.costPerPost) {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)

            if (platform === 'youtube') {
                // YouTube quota is per-app, not per-account
                const key = `rate_limit:${platform}:app:quota:${dayStart.getTime()}`
                operations.push(this.redis.incrby(key, limits.costPerPost))
                operations.push(this.redis.expire(key, 86400)) // 24 hours
            } else {
                // Other platforms: quota is per-account
                const key = `rate_limit:${platform}:${accountId}:quota:${dayStart.getTime()}`
                operations.push(this.redis.incrby(key, limits.costPerPost))
                operations.push(this.redis.expire(key, 86400)) // 24 hours
            }
        }

        // Increment points usage
        if (limits.pointsPerPost && limits.pointsPerDay) {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)
            const key = `rate_limit:${platform}:${accountId}:points:${dayStart.getTime()}`
            operations.push(this.redis.incrby(key, limits.pointsPerPost))
            operations.push(this.redis.expire(key, 86400)) // 24 hours
        }

        await Promise.all(operations)
    }

    async decrementUsage(platform: PostPlatform, userId: string, socialAccountId?: string): Promise<void> {
        const config = PlatformConfigManager.getConfig(platform)
        const limits = config.limits
        const now = Date.now()

        // Use socialAccountId for per-account limits, userId for per-app limits
        const accountId = socialAccountId || userId

        const operations: Promise<any>[] = []

        // Decrement daily post counter (with minimum value of 0)
        if (limits.postsPerDay) {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)
            const key = `rate_limit:${platform}:${accountId}:daily:${dayStart.getTime()}`

            // Use DECRBY with a check to ensure it doesn't go below 0
            const currentValue = await this.redis.get(key)
            const current = currentValue ? parseInt(currentValue) : 0
            if (current > 0) {
                operations.push(this.redis.decr(key))
            }
            operations.push(this.redis.expire(key, 86400)) // 24 hours
        }

        // Decrement minute post counter (with minimum value of 0)
        if (limits.postsPerMinute) {
            const minuteStart = Math.floor(now / (60 * 1000)) * 60 * 1000
            const key = `rate_limit:${platform}:${accountId}:minute:${minuteStart}`

            const currentValue = await this.redis.get(key)
            const current = currentValue ? parseInt(currentValue) : 0
            if (current > 0) {
                operations.push(this.redis.decr(key))
            }
            operations.push(this.redis.expire(key, 60)) // 1 minute
        }

        // Decrement hourly request counter (with minimum value of 0)
        if (limits.requestsPerHour) {
            const hourStart = Math.floor(now / (60 * 60 * 1000)) * 60 * 60 * 1000
            const key = `rate_limit:${platform}:${accountId}:hour:${hourStart}`

            const currentValue = await this.redis.get(key)
            const current = currentValue ? parseInt(currentValue) : 0
            if (current > 0) {
                operations.push(this.redis.decr(key))
            }
            operations.push(this.redis.expire(key, 3600)) // 1 hour
        }

        // Decrement 5-minute request counter (with minimum value of 0)
        if (limits.requestsPer5Min) {
            const fiveMinStart = Math.floor(now / (5 * 60 * 1000)) * 5 * 60 * 1000
            const key = `rate_limit:${platform}:${accountId}:5min:${fiveMinStart}`

            const currentValue = await this.redis.get(key)
            const current = currentValue ? parseInt(currentValue) : 0
            if (current > 0) {
                operations.push(this.redis.decr(key))
            }
            operations.push(this.redis.expire(key, 300)) // 5 minutes
        }

        // Decrement quota usage
        if (limits.quotaUnits && limits.costPerPost) {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)

            if (platform === 'youtube') {
                // YouTube quota is per-app, not per-account
                const key = `rate_limit:${platform}:app:quota:${dayStart.getTime()}`
                operations.push(this.redis.incrby(key, -limits.costPerPost))
                operations.push(this.redis.expire(key, 86400)) // 24 hours
            } else {
                // Other platforms: quota is per-account
                const key = `rate_limit:${platform}:${accountId}:quota:${dayStart.getTime()}`
                operations.push(this.redis.incrby(key, -limits.costPerPost))
                operations.push(this.redis.expire(key, 86400)) // 24 hours
            }
        }

        // Decrement points usage
        if (limits.pointsPerPost && limits.pointsPerDay) {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)
            const key = `rate_limit:${platform}:${accountId}:points:${dayStart.getTime()}`
            operations.push(this.redis.incrby(key, -limits.pointsPerPost))
            operations.push(this.redis.expire(key, 86400)) // 24 hours
        }

        await Promise.all(operations)
    }

    // ========== PER-APP LIMIT CHECKS ==========

    private async checkAppDailyLimit(
        platform: PostPlatform,
        limits: PlatformLimits,
        now: number
    ): Promise<RateLimitResult | null> {
        if (!limits.appDailyLimit) return null

        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

        // For TikTok (and other platforms that limit by unique users), check user count instead of post count
        if (platform === 'tiktok') {
            const userKey = `app_rate_limit:${platform}:users:${dayStart.getTime()}`
            const currentUserCount = await this.redis.scard(userKey)

            if (currentUserCount >= limits.appDailyLimit) {
                return {
                    allowed: false,
                    remainingQuota: 0,
                    resetTime: dayEnd,
                    retryAfter: Math.ceil((dayEnd.getTime() - now) / 1000),
                }
            }

            return {
                allowed: true,
                remainingQuota: limits.appDailyLimit - currentUserCount,
                resetTime: dayEnd,
            }
        }

        // For other platforms, check post count
        const key = `app_rate_limit:${platform}:daily:${dayStart.getTime()}`
        const current = await this.redis.get(key)
        const currentCount = current ? parseInt(current) : 0

        if (currentCount >= limits.appDailyLimit) {
            return {
                allowed: false,
                remainingQuota: 0,
                resetTime: dayEnd,
                retryAfter: Math.ceil((dayEnd.getTime() - now) / 1000),
            }
        }

        return {
            allowed: true,
            remainingQuota: limits.appDailyLimit - currentCount,
            resetTime: dayEnd,
        }
    }

    private async checkAppRpsLimit(
        platform: PostPlatform,
        limits: PlatformLimits,
        now: number
    ): Promise<RateLimitResult | null> {
        if (!limits.appRps) return null

        const secondStart = Math.floor(now / 1000) * 1000
        const secondEnd = secondStart + 1000

        const key = `app_rate_limit:${platform}:rps:${secondStart}`
        const current = await this.redis.get(key)
        const currentCount = current ? parseInt(current) : 0

        if (currentCount >= limits.appRps) {
            return {
                allowed: false,
                remainingQuota: 0,
                resetTime: new Date(secondEnd),
                retryAfter: Math.ceil((secondEnd - now) / 1000),
            }
        }

        return {
            allowed: true,
            remainingQuota: limits.appRps - currentCount,
            resetTime: new Date(secondEnd),
        }
    }

    private async checkAppQuotaLimit(
        platform: PostPlatform,
        limits: PlatformLimits,
        now: number
    ): Promise<RateLimitResult | null> {
        if (!limits.appDailyLimit || !limits.costPerPost) return null

        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

        const key = `app_rate_limit:${platform}:quota:${dayStart.getTime()}`
        const current = await this.redis.get(key)
        const currentQuota = current ? parseInt(current) : 0

        if (currentQuota + limits.costPerPost > limits.appDailyLimit) {
            return {
                allowed: false,
                remainingQuota: Math.max(0, Math.floor((limits.appDailyLimit - currentQuota) / limits.costPerPost)),
                resetTime: dayEnd,
                retryAfter: Math.ceil((dayEnd.getTime() - now) / 1000),
            }
        }

        return {
            allowed: true,
            remainingQuota: Math.floor((limits.appDailyLimit - currentQuota) / limits.costPerPost),
            resetTime: dayEnd,
        }
    }

    private async checkAppUserLimit(
        platform: PostPlatform,
        userId: string,
        limits: PlatformLimits,
        now: number
    ): Promise<RateLimitResult | null> {
        if (!limits.appDailyLimit) return null

        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

        // Check if user is already tracked today
        const userKey = `app_rate_limit:${platform}:users:${dayStart.getTime()}`
        const userExists = await this.redis.sismember(userKey, userId)
        const currentUserCount = await this.redis.scard(userKey)

        if (!userExists) {
            // Check if we can add more users today
            if (currentUserCount >= limits.appDailyLimit) {
                return {
                    allowed: false,
                    remainingQuota: 0,
                    resetTime: dayEnd,
                    retryAfter: Math.ceil((dayEnd.getTime() - now) / 1000),
                }
            }
        }

        return {
            allowed: true,
            remainingQuota: limits.appDailyLimit - currentUserCount,
            resetTime: dayEnd,
        }
    }

    // ========== PER-APP COUNTER INCREMENT ==========

    async incrementAppUsage(platform: PostPlatform, userId: string): Promise<void> {
        const config = PlatformConfigManager.getConfig(platform)
        const limits = config.limits
        const now = Date.now()

        const operations: Promise<any>[] = []

        // Increment app daily counter (skip for TikTok as it uses user count instead)
        if (limits.appDailyLimit && platform !== 'tiktok') {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)
            const key = `app_rate_limit:${platform}:daily:${dayStart.getTime()}`
            operations.push(this.redis.incr(key))
            operations.push(this.redis.expire(key, 86400)) // 24 hours
        }

        // Increment app RPS counter
        if (limits.appRps) {
            const secondStart = Math.floor(now / 1000) * 1000
            const key = `app_rate_limit:${platform}:rps:${secondStart}`
            operations.push(this.redis.incr(key))
            operations.push(this.redis.expire(key, 1)) // 1 second
        }

        // Increment app quota usage
        if (limits.appDailyLimit && limits.costPerPost) {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)
            const key = `app_rate_limit:${platform}:quota:${dayStart.getTime()}`
            operations.push(this.redis.incrby(key, limits.costPerPost))
            operations.push(this.redis.expire(key, 86400)) // 24 hours
        }

        // Add user to daily users set
        if (limits.appDailyLimit) {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)
            const userKey = `app_rate_limit:${platform}:users:${dayStart.getTime()}`
            operations.push(this.redis.sadd(userKey, userId))
            operations.push(this.redis.expire(userKey, 86400)) // 24 hours
        }

        await Promise.all(operations)
    }

    async decrementAppUsage(platform: PostPlatform, userId: string, socialAccountId?: string): Promise<void> {
        const config = PlatformConfigManager.getConfig(platform)
        const limits = config.limits
        const now = Date.now()

        const operations: Promise<any>[] = []

        // Decrement app daily counter (skip for TikTok as it uses user count instead)
        if (limits.appDailyLimit && platform !== 'tiktok') {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)
            const key = `app_rate_limit:${platform}:daily:${dayStart.getTime()}`
            operations.push(this.redis.decr(key))
            operations.push(this.redis.expire(key, 86400)) // 24 hours
        }

        // Decrement app quota usage
        if (limits.appDailyLimit && limits.costPerPost) {
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)
            const key = `app_rate_limit:${platform}:quota:${dayStart.getTime()}`
            operations.push(this.redis.incrby(key, -limits.costPerPost))
            operations.push(this.redis.expire(key, 86400)) // 24 hours
        }

        // Note: We don't decrement RPS or remove from users set as those are time-based
        // and the user might have other posts that were actually published

        await Promise.all(operations)
    }
}
