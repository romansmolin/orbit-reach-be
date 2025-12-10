import { SocilaMediaPlatform } from '@/schemas/posts.schemas'

export interface ISocialMediaPostSenderService {
    sendPost(userId: string, postId: string, platform: SocilaMediaPlatform, socialAccountId?: string): Promise<void>
    sendPostToAllPlatforms(userId: string, postId: string): Promise<void>
    setOnPostSuccessCallback(callback: (userId: string, postId: string) => Promise<void>): void
    setOnPostFailureCallback(callback: (userId: string, postId: string) => Promise<void>): void
}
