import { PostStatus } from '@/types/posts.types'

export interface ErrorHandlingResult {
    shouldUpdateTargetStatus: boolean
    targetStatus: PostStatus
    errorMessage: string
    error: import('../../errors/base-error').BaseAppError
}

export interface ISocialMediaErrorHandler {
    handleSocialMediaError(
        error: unknown,
        platform: string,
        userId: string,
        postId: string,
        socialAccountId: string
    ): Promise<ErrorHandlingResult>
}
