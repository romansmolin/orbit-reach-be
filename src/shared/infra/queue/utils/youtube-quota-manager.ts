// utils/youtube-quota-manager.ts
import { Redis } from 'ioredis'
import { PostPlatform, SocilaMediaPlatform } from '../../../../schemas/posts.schemas'
import { PlatformConfigManager } from '../config/platform-config'

export interface QuotaBudget {
    totalQuota: number
    usedQuota: number
    remainingQuota: number
    resetTime: Date
    warningThreshold: number
    criticalThreshold: number
    canUpload: boolean
    estimatedUploadsRemaining: number
}

export class YouTubeQuotaManager {
    constructor(private redis: Redis) {}

    async getQuotaBudget(platform: PostPlatform = SocilaMediaPlatform.YOUTUBE): Promise<QuotaBudget> {
        const config = PlatformConfigManager.getConfig(platform)
        const limits = config.limits

        if (!limits.appDailyLimit || !limits.costPerPost) {
            throw new Error('YouTube quota configuration missing')
        }

        const now = Date.now()
        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

        const quotaKey = `app_rate_limit:${platform}:quota:${dayStart.getTime()}`
        const usedQuota = await this.redis.get(quotaKey)
        const used = usedQuota ? parseInt(usedQuota) : 0

        const totalQuota = limits.appDailyLimit
        const remainingQuota = Math.max(0, totalQuota - used)
        const warningThreshold = Math.floor(totalQuota * (limits.warnThresholdPct || 0.2))
        const criticalThreshold = Math.floor(totalQuota * 0.1) // 10% critical threshold

        return {
            totalQuota,
            usedQuota: used,
            remainingQuota,
            resetTime: dayEnd,
            warningThreshold,
            criticalThreshold,
            canUpload: remainingQuota >= limits.costPerPost,
            estimatedUploadsRemaining: Math.floor(remainingQuota / limits.costPerPost),
        }
    }

    async reserveQuota(
        platform: PostPlatform = SocilaMediaPlatform.YOUTUBE,
        userId: string
    ): Promise<{
        success: boolean
        reservedQuota?: number
        retryAfter?: number
        budget?: QuotaBudget
    }> {
        const config = PlatformConfigManager.getConfig(platform)
        const limits = config.limits

        if (!limits.appDailyLimit || !limits.costPerPost) {
            return { success: false }
        }

        const budget = await this.getQuotaBudget(platform)

        if (!budget.canUpload) {
            return {
                success: false,
                retryAfter: Math.ceil((budget.resetTime.getTime() - Date.now()) / 1000),
                budget,
            }
        }

        // Reserve quota atomically
        const now = Date.now()
        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)

        const quotaKey = `app_rate_limit:${platform}:quota:${dayStart.getTime()}`
        const reservationKey = `quota_reservation:${platform}:${userId}:${Date.now()}`

        // Use Redis transaction to reserve quota
        const result = await this.redis
            .multi()
            .get(quotaKey)
            .incrby(quotaKey, limits.costPerPost)
            .expire(quotaKey, 86400)
            .setex(reservationKey, 300, limits.costPerPost) // 5 minute reservation
            .exec()

        if (!result || result[0][0] || result[1][0]) {
            return { success: false, budget }
        }

        const newUsedQuota = result[1][1] as number
        if (newUsedQuota > limits.appDailyLimit) {
            // Rollback if we exceeded limit
            await this.redis.incrby(quotaKey, -limits.costPerPost)
            await this.redis.del(reservationKey)
            return { success: false, budget }
        }

        return {
            success: true,
            reservedQuota: limits.costPerPost,
            budget: await this.getQuotaBudget(platform),
        }
    }

    async releaseQuota(
        platform: PostPlatform = SocilaMediaPlatform.YOUTUBE,
        userId: string,
        reservationId?: string
    ): Promise<void> {
        const config = PlatformConfigManager.getConfig(platform)
        const limits = config.limits

        if (!limits.appDailyLimit || !limits.costPerPost) return

        const now = Date.now()
        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)

        const quotaKey = `app_rate_limit:${platform}:quota:${dayStart.getTime()}`

        if (reservationId) {
            const reservationKey = `quota_reservation:${platform}:${userId}:${reservationId}`
            const reservedAmount = await this.redis.get(reservationKey)

            if (reservedAmount) {
                await this.redis.multi().incrby(quotaKey, -parseInt(reservedAmount)).del(reservationKey).exec()
            }
        } else {
            // Release standard amount
            await this.redis.incrby(quotaKey, -limits.costPerPost)
        }
    }

    async getQuotaUsageStats(platform: PostPlatform = SocilaMediaPlatform.YOUTUBE): Promise<{
        hourly: Array<{ hour: string; usage: number }>
        daily: Array<{ day: string; usage: number }>
        topUsers: Array<{ userId: string; usage: number }>
    }> {
        const now = Date.now()
        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)

        // Get hourly usage for today
        const hourly: Array<{ hour: string; usage: number }> = []
        for (let i = 0; i < 24; i++) {
            const hourStart = new Date(dayStart.getTime() + i * 60 * 60 * 1000)
            const hourKey = `quota_usage:${platform}:hour:${hourStart.getTime()}`
            const usage = await this.redis.get(hourKey)
            hourly.push({
                hour: hourStart.toISOString().substring(11, 13) + ':00',
                usage: usage ? parseInt(usage) : 0,
            })
        }

        // Get daily usage for last 7 days
        const daily: Array<{ day: string; usage: number }> = []
        for (let i = 6; i >= 0; i--) {
            const day = new Date(dayStart.getTime() - i * 24 * 60 * 60 * 1000)
            const dayKey = `app_rate_limit:${platform}:quota:${day.getTime()}`
            const usage = await this.redis.get(dayKey)
            daily.push({
                day: day.toISOString().substring(0, 10),
                usage: usage ? parseInt(usage) : 0,
            })
        }

        // Get top users for today
        const userPattern = `quota_usage:${platform}:user:*:${dayStart.getTime()}`
        const userKeys = await this.redis.keys(userPattern)
        const topUsers: Array<{ userId: string; usage: number }> = []

        for (const key of userKeys) {
            const usage = await this.redis.get(key)
            const userId = key.split(':')[3] // Extract userId from key
            if (usage && userId) {
                topUsers.push({ userId, usage: parseInt(usage) })
            }
        }

        topUsers.sort((a, b) => b.usage - a.usage)

        return { hourly, daily, topUsers: topUsers.slice(0, 10) }
    }

    async scheduleQuotaReset(platform: PostPlatform = SocilaMediaPlatform.YOUTUBE): Promise<void> {
        const now = Date.now()
        const dayStart = new Date(now)
        dayStart.setHours(0, 0, 0, 0)
        const nextReset = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)

        // Schedule cleanup of old quota keys
        const cleanupDelay = nextReset.getTime() - now
        setTimeout(async () => {
            const oldDay = new Date(now - 7 * 24 * 60 * 60 * 1000) // 7 days ago
            const oldKey = `app_rate_limit:${platform}:quota:${oldDay.getTime()}`
            await this.redis.del(oldKey)
        }, cleanupDelay)
    }
}
