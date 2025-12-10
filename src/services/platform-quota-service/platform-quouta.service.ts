import { IPlatformUsageRepository } from '@/repositories/platform-usage-repository/platform-usage-repository.interface'
import { PlatformConfigManager } from '../../shared/infra/queue/config/platform-config'
import { PostPlatform } from '@/schemas/posts.schemas'
import {
    IPlatformQuotaService,
    PlatformQuotaError,
    PlatformQuotaValidationResult,
} from './platform-quota.service.interface'
import { ErrorCode } from '@/shared/consts/error-codes.const'

interface PlatformValidationResult {
    isValid: boolean
    error: PlatformQuotaError | null
}

export class PlatformQuotaService implements IPlatformQuotaService {
    private platformUsageRepository: IPlatformUsageRepository

    constructor(platformUsageRepository: IPlatformUsageRepository) {
        this.platformUsageRepository = platformUsageRepository
    }

    async validatePlatformQuotas(
        userId: string,
        posts: any[], // Replace with your SinglePost type
        scheduledTime: Date
    ): Promise<PlatformQuotaValidationResult> {
        const errors: PlatformQuotaError[] = []

        const postsByPlatform = this.groupPostsByPlatform(posts)

        for (const [platform, platformPosts] of postsByPlatform) {
            const validation = await this.validatePlatformLimit(
                userId,
                platform as PostPlatform,
                platformPosts.length,
                scheduledTime
            )

            if (!validation.isValid) {
                errors.push(validation.error!)
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
        }
    }

    private async validatePlatformLimit(
        userId: string,
        platform: PostPlatform,
        postCount: number,
        scheduledTime: Date
    ): Promise<PlatformValidationResult> {
        const config = PlatformConfigManager.getConfig(platform)
        const dailyLimit = config.limits.postsPerDay || 0

        if (dailyLimit === 0) {
            return { isValid: true, error: null }
        }

        const dailyUsage = await this.platformUsageRepository.getDailyPlatformUsage(userId, platform, scheduledTime)

        const currentUsage = dailyUsage?.scheduledCount || 0
        const availableSlots = dailyLimit - currentUsage

        if (postCount > availableSlots) {
            return {
                isValid: false,
                error: {
                    type: 'PLATFORM_DAILY_LIMIT_EXCEEDED',
                    platform,
                    current: currentUsage,
                    requested: postCount,
                    limit: dailyLimit,
                    availableSlots,
                },
            }
        }

        return { isValid: true, error: null }
    }

    async reservePlatformSlots(userId: string, posts: any[], scheduledTime: Date): Promise<void> {
        const postsByPlatform = this.groupPostsByPlatform(posts)

        for (const [platform, platformPosts] of postsByPlatform) {
            await this.platformUsageRepository.incrementScheduledCount(
                userId,
                platform,
                scheduledTime,
                platformPosts.length
            )
        }
    }

    async releasePlatformSlots(userId: string, posts: any[], scheduledTime: Date): Promise<void> {
        const postsByPlatform = this.groupPostsByPlatform(posts)

        for (const [platform, platformPosts] of postsByPlatform) {
            await this.platformUsageRepository.incrementScheduledCount(
                userId,
                platform,
                scheduledTime,
                -platformPosts.length // Negative count to release slots
            )
        }
    }

    async updatePlatformUsage(userId: string, platform: string, scheduledTime: Date, countDiff: number): Promise<void> {
        await this.platformUsageRepository.incrementScheduledCount(userId, platform, scheduledTime, countDiff)
    }

    private groupPostsByPlatform(posts: any[]): Map<string, any[]> {
        const grouped = new Map<string, any[]>()

        for (const post of posts) {
            if (!grouped.has(post.platform)) {
                grouped.set(post.platform, [])
            }
            grouped.get(post.platform)!.push(post)
        }

        return grouped
    }
}
