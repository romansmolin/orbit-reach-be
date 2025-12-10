import { SinglePost, PostPlatform, PostType, GetPostsByFiltersRequest } from '@/schemas/posts.schemas'

export interface MediaAsset {
    userId: string
    url: string
    type: string
}

export enum PostStatus {
    'PENDING' = 'PENDING',
    'DRAFT' = 'DRAFT',
    'DONE' = 'DONE',
    'FAILED' = 'FAILED',
    'POSTING' = 'POSTING',
    'PARTIALLY_DONE' = 'PARTIALLY_DONE',
}

// THREADS ENUMS START
export enum ThreadsMediaType {
    'TEXT' = 'TEXT',
    'IMAGE' = 'IMAGE',
    'VIDEO' = 'VIDEO',
    'CAROUSEL' = 'CAROUSEL',
}

export enum ThreadsPostStatus {
    'FINISHED' = 'FINISHED',
    'IN_PROGRESS' = 'IN_PROGRESS',
    'PUBLISHED' = 'PUBLISHED',
    'ERROR' = 'ERROR',
    'EXPIRED' = 'EXPIRED',
}

// THREADS ENUMS END

// INSTAGRAM ENUMS START

export enum InstagramMediaType {
    'IMAGE' = 'IMAGE',
    'VIDEO' = 'VIDEO',
    'REELS' = 'REELS',
    'STORIES' = 'STORIES',
}

export enum InstagramPostStatus {
    'FINISHED' = 'FINISHED',
    'IN_PROGRESS' = 'IN_PROGRESS',
    'PUBLISHED' = 'PUBLISHED',
    'ERROR' = 'ERROR',
    'EXPIRED' = 'EXPIRED',
}

// INSTAGRAM ENUMS END

// TIKTOK ENUMS START
export enum TikTokPrivacyLevel {
    'SELF_ONLY' = 'SELF_ONLY',
    'PUBLIC_TO_EVERYONE' = 'PUBLIC_TO_EVERYONE',
    'MUTUAL_FOLLOW_FRIENDS' = 'MUTUAL_FOLLOW_FRIENDS',
    'FOLLOWER_OF_CREATOR' = 'FOLLOWER_OF_CREATOR',
}

export enum TikTokMediaAssestSourceType {
    'FILE_UPLOAD' = 'FILE_UPLOAD',
    'PULL_FROM_URL' = 'PULL_FROM_URL',
}

export enum TikTokPostMode {
    'DIRECT_POST' = 'DIRECT_POST',
    'MEDIA_UPLOAD' = 'MEDIA_UPLOAD',
}
// TIKTOK ENUMS END

export interface PostTarget extends SinglePost {
    postId: string
    socialAccountId: string
    instagramLocationId?: string
    tikTokPostPrivacyLevel: TikTokPrivacyLevel | undefined
}

export type { SinglePost, PostPlatform, PostType }

export interface CreatePostRequest {
    targets: SinglePost[]
    mediaFiles?: Express.Multer.File[]
}

export interface PostTargetResponse {
    platform: PostPlatform
    status: PostStatus
    socialAccountId: string
    title?: string
    text: string
    pinterestBoardId: string | null
    tags?: string[]
    links?: string[]
    isAutoMusicEnabled?: boolean
    instagramLocationId?: string
    instagramFacebookPageId?: string
    threadsReplies?: string[]
    tikTokPostPrivacyLevel: TikTokPrivacyLevel | undefined
}

export interface CreatePostResponse {
    postId: string
    type: PostType
    status: PostStatus
    createdAt: Date
    scheduledTime: Date | null
    mainCaption: string
    coverTimestamp?: number
    coverImageUrl?: string
    targets: PostTargetResponse[]
    media?: {
        url: string
        type: string
    }
    success?: boolean
    errors?: any[]
    suggestions?: any[]
}

export interface IPost {
    postId: string
    type: PostType
    status: PostStatus
    createdAt: Date
    scheduledTime: Date | null
    mainCaption: string
    coverTimestamp?: number
    coverImageUrl?: string
    targets: PostTargetResponse[]
    media?: {
        url: string
        type: string
    }
}

export type PostFilters = GetPostsByFiltersRequest

export interface PostsListResponse {
    posts: CreatePostResponse[]
    total: number
    page: number
    limit: number
    hasMore: boolean
}

export interface PostsByDateResponse {
    posts: CreatePostResponse[]
}

export { TimeRange } from '@/schemas/posts.schemas'
