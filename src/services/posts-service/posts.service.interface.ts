import {
    CreatePostResponse,
    PostFilters,
    PostsByDateResponse,
    PostsListResponse,
    PostTargetResponse,
} from '../../types/posts.types'
import type { CreatePostsRequest } from '../../schemas/posts.schemas'
import { PostTargetEntity } from '../../entities/post-target'
import { ErrorCode } from '../../shared/consts/error-codes.const'

export interface PlatformLimitError {
    code: ErrorCode
    message: string
    platform: string
    current: number
    limit: number
    requested: number
}

export interface IPostsService {
    createPost(
        createPostsRequest: CreatePostsRequest,
        medias: { [fieldname: string]: Express.Multer.File[] } | undefined | Express.Multer.File[],
        userId: string,
        scheduledTimeInput?: string | null
    ): Promise<CreatePostResponse | PlatformLimitError>

    editPost(
        postId: string,
        updatePostRequest: CreatePostsRequest,
        file: Express.Multer.File | undefined,
        userId: string,
        scheduledTimeInput?: string | null
    ): Promise<void>

    hasExistingMedia(postId: string): Promise<boolean>

    getPostsByFilters(userId: string, filters: PostFilters): Promise<PostsListResponse>

    deletePost(postId: string, userId: string): Promise<void>
    deletePostsOrphanedByAccount(userId: string, accountId: string): Promise<void>

    getPostsByDate(tenantId: string, fromDate: Date, toDate: Date): Promise<PostsByDateResponse>

    getPostsFailedCount(userId: string): Promise<number>

    retryPostTarget(
        userId: string,
        postId: string,
        socialAccountId: string
    ): Promise<{ postTarget: PostTargetResponse; post: CreatePostResponse }>

    checkAndUpdateBasePostStatus(userId: string, postId: string): Promise<void>
    getFailedPostTargets(userId: string): Promise<PostTargetEntity[]>
    cancelPostTarget(userId: string, postId: string, socialAccountId: string): Promise<void>
}
