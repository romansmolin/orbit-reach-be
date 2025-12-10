export interface IPlatformUsageRepository {
    getDailyPlatformUsage(userId: string, platform: string, date: Date): Promise<PlatformDailyUsage | null>
    incrementScheduledCount(userId: string, platform: string, date: Date, count: number): Promise<void>
}

export interface PlatformDailyUsage {
    id: string
    userId: string
    platform: string
    usageDate: Date
    scheduledCount: number
    createdAt: Date
    updatedAt: Date
}
