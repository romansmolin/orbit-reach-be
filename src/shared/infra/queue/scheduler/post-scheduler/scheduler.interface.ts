import { PostPlatform } from '@/schemas/posts.schemas'

export interface IPostScheduler {
    schedulePost(
        platform: PostPlatform,
        postId: string,
        userId: string,
        scheduledDate: Date,
        socialAccountId?: string
    ): Promise<void>
    cancelScheduledPost(platform: PostPlatform, postId: string): Promise<void>
    reschedulePost(platform: PostPlatform, postId: string, userId: string, newDate: Date): Promise<void>
    getQueueStatus(platform: PostPlatform): Promise<{
        waiting: number
        delayed: number
        active: number
        completed: number
        failed: number
    }>
    getAllQueuesStatus(): Promise<
        Record<
            PostPlatform,
            {
                waiting: number
                delayed: number
                active: number
                completed: number
                failed: number
            }
        >
    >
    cleanupJobsForDeletedPost(platform: PostPlatform, postId: string): Promise<void>
}
