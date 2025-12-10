import { PostPlatform } from '@/schemas/posts.schemas'

export interface PlatformQuotaError {
    type: 'PLATFORM_DAILY_LIMIT_EXCEEDED'
    platform: string
    current: number
    requested: number
    limit: number
    availableSlots: number
}

export interface PlatformQuotaValidationResult {
    isValid: boolean
    errors: PlatformQuotaError[]
}

export interface IPlatformQuotaService {
    /**
     * Validates platform quotas for a set of posts
     * @param userId - The user ID
     * @param posts - Array of posts to validate
     * @param scheduledTime - The scheduled time for the posts
     * @returns Validation result with errors and suggestions
     */
    validatePlatformQuotas(userId: string, posts: any[], scheduledTime: Date): Promise<PlatformQuotaValidationResult>

    /**
     * Reserves platform slots for a set of posts
     * @param userId - The user ID
     * @param posts - Array of posts to reserve slots for
     * @param scheduledTime - The scheduled time for the posts
     */
    reservePlatformSlots(userId: string, posts: any[], scheduledTime: Date): Promise<void>

    /**
     * Releases platform slots for a set of posts (used when deleting or editing)
     * @param userId - The user ID
     * @param posts - Array of posts to release slots for
     * @param scheduledTime - The scheduled time for the posts
     */
    releasePlatformSlots(userId: string, posts: any[], scheduledTime: Date): Promise<void>

    /**
     * Updates platform usage for a specific platform and date
     * @param userId - The user ID
     * @param platform - The platform name
     * @param scheduledTime - The scheduled time
     * @param countDiff - The difference in count (positive to add, negative to subtract)
     */
    updatePlatformUsage(userId: string, platform: string, scheduledTime: Date, countDiff: number): Promise<void>
}
