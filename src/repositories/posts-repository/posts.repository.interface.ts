import {
    PostStatus,
    PostTarget,
    CreatePostResponse,
    PostFilters,
    PostsListResponse,
    PostsByDateResponse,
    PostTargetResponse,
} from '@/types/posts.types'
import type { PostType } from '@/schemas/posts.schemas'
import { PostTargetEntity } from '../../entities/post-target'

export interface IPostsRepository {
    createBasePost(
        userId: string,
        status: PostStatus,
        postType: PostType,
        scheduledTime: Date | null,
        mainCaption?: string,
        coverTimestamp?: number,
        coverImageUrl?: string
    ): Promise<{ postId: string }>

    updateBasePost(
        postId: string,
        userId: string,
        status: PostStatus,
        scheduledTime: Date | null,
        mainCaption?: string
    ): Promise<void>

    savePostMediaAssets(data: { userId: string; url: string; type: string }): Promise<{ mediaId: string }>

    createPostMediaAssetRelation(postId: string, mediaId: string, order: number): Promise<void>

    getPostMediaAsset(postId: string): Promise<{ mediaId: string; url: string; type: string } | null>

    getPostMediaAssets(postId: string): Promise<{ mediaId: string; url: string; type: string; orderIndex: number }[]>

    getPostCoverImageUrl(postId: string): Promise<string | null>

    deletePostMediaAsset(mediaId: string): Promise<void>

    createPostTargets(targets: PostTarget[]): Promise<void>

    updatePostTargets(postId: string, targets: PostTarget[]): Promise<void>

    updatePostTarget(
        userId: string,
        postId: string,
        socialAccountId: string,
        status: PostStatus,
        errorMessage?: string
    ): Promise<void>

    getPostDetails(postId: string, userId: string): Promise<CreatePostResponse>

    getPosts(tenantId: string, filters: PostFilters): Promise<PostsListResponse>

    hasExistingMedia(postId: string): Promise<boolean>

    deletePost(postId: string, tenantId: string): Promise<{ mediaUrls: string[]; coverImageUrl?: string }>

    getPostsByDate(tenantId: string, fromDate: Date, toDate: Date): Promise<PostsByDateResponse>

    getPostsFailedCount(userId: string): Promise<number>

    getFailedPostTargets(userId: string): Promise<PostTargetEntity[]>

    retryPostTarget(
        userId: string,
        postId: string,
        socialAccountId: string
    ): Promise<{ postTarget: PostTargetResponse; post: CreatePostResponse }>

    getPostsTargetedOnlyByAccount(tenantId: string, accountId: string): Promise<string[]>
}
