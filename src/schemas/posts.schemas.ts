import { PostStatus, TikTokPrivacyLevel } from '@/types/posts.types'
import z from 'zod'

export enum SocilaMediaPlatform {
    FACEBOOK = 'facebook',
    INSTAGRAM = 'instagram',
    LINKEDIN = 'linkedin',
    GOOGLE = 'google',
    PINTEREST = 'pinterest',
    TIKTOK = 'tiktok',
    YOUTUBE = 'youtube',
    THREADS = 'threads',
    BLUESKY = 'bluesky',
    X = 'x',
}

export const PostPlatforms = [
    SocilaMediaPlatform.TIKTOK,
    SocilaMediaPlatform.THREADS,
    SocilaMediaPlatform.X,
    SocilaMediaPlatform.INSTAGRAM,
    SocilaMediaPlatform.FACEBOOK,
    SocilaMediaPlatform.BLUESKY,
    SocilaMediaPlatform.YOUTUBE,
    SocilaMediaPlatform.PINTEREST,
    SocilaMediaPlatform.LINKEDIN,
] as const

export const PostPlatformsWithoutX = PostPlatforms.filter((platform) => platform !== SocilaMediaPlatform.X)

export type PostPlatform = (typeof PostPlatforms)[number]

const postTypes = ['text', 'media'] as const

export type PostType = (typeof postTypes)[number]

export enum TimeRange {
    'WEEK' = 'WEEK',
    'MONTH' = 'MONTH',
    'ALL' = 'ALL',
}

const singlePost = z
    .object({
        account: z.uuid('Invalid UUID format for account'),
        platform: z.enum(
            PostPlatforms,
            'We can except only tiktok,threads, x, instagram, facebook, pinterest, bluesky, youtube'
        ),
        text: z
            .string()
            .trim()
            .min(1, 'Minimal text length is 1 character')
            .max(63206, 'The maximal text we can receive is 63206 characters'),
        title: z
            .string()
            .trim()
            .min(1, 'Minimal title length is 1 character')
            .max(100, 'The maximal title we can receive is 100 characters')
            .optional(),
        pinterestBoardId: z.string().optional(),
        tags: z
            .array(z.string().trim().min(1, 'Tag cannot be empty').max(100, 'Tag cannot exceed 100 characters'))
            .max(30, 'Maximum 30 tags allowed per post')
            .optional()
            .transform((tags) => tags?.filter(Boolean) || []), // Remove empty tags
        links: z
            .array(z.string().trim().min(1, 'Tag cannot be empty').max(100, 'Tag cannot exceed 100 characters'))
            .max(30, 'Maximum 30 links allowed per post')
            .optional()
            .transform((links) => links?.filter(Boolean) || []), // Remove empty links
        isAutoMusicEnabled: z.boolean().optional(),
        instagramFacebookPageId: z
            .string()
            .trim()
            .min(1, 'Facebook page ID must contain at least one character')
            .max(100, 'Facebook page ID cannot exceed 100 characters')
            .optional(),
        tikTokPostPrivacyLevel: z.enum(TikTokPrivacyLevel).optional(),
        threadsReplies: z
            .array(z.string().trim().min(1, 'Reply text cannot be empty').max(5000, 'Reply text too long'))
            .max(10, 'Threads supports up to 10 replies per thread')
            .optional()
            .transform((replies) => replies?.filter(Boolean) || []),
    })
    .transform((post) => ({
        ...post,
        threadsReplies: post.platform === SocilaMediaPlatform.THREADS ? post.threadsReplies : undefined,
        tikTokPostPrivacyLevel: post.platform === SocilaMediaPlatform.TIKTOK ? post.tikTokPostPrivacyLevel : undefined,
    }))

const scheduledTimeSchema = z
    .preprocess((value) => {
        if (value === null || value === undefined || value === '') {
            return null
        }
        return value
    }, z.coerce.date())
    .nullable()

const postsRequestSchema = z
    .object({
        posts: z
            .array(singlePost)
            .nonempty('At least one post is required')
            .max(50, 'You can send up to 50 posts at once')
            .refine(
                (posts) => {
                    const accountIds = posts.map((p) => p.account)
                    const duplicates = accountIds.filter((id, i) => accountIds.indexOf(id) !== i)
                    return duplicates.length === 0
                },
                { message: 'Each post must target a unique social account' }
            ),
        postType: z.enum(postTypes),
        postStatus: z.nativeEnum(PostStatus),
        scheduledTime: scheduledTimeSchema,
        mainCaption: z
            .string()
            .min(1, 'At leas one cahracter is required')
            .max(1000, 'The maximal length of mainCaption is 1000')
            .optional(),
        coverTimestamp: z
            .number()
            .min(0, 'Cover timestamp must be non-negative')
            .max(3600000, 'Cover timestamp must be less than 1 hour (3600000ms)')
            .optional(),
        copyDataUrls: z.array(z.string()).optional(),
        postNow: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
        const requiresScheduledTime = data.postStatus !== PostStatus.DRAFT && !data.postNow
        if (requiresScheduledTime && !data.scheduledTime) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['scheduledTime'],
                message: 'Scheduled time is required unless saving as draft or posting now',
            })
        }

    })

export const getPostsByFiltersSchema = z.object({
    platform: z.enum(PostPlatforms).optional(),
    socialAccountId: z.string().uuid('Invalid UUID format for social account').optional(),
    fromDate: z.coerce.date().optional(),
    toDate: z.coerce.date().optional(),
    status: z.nativeEnum(PostStatus).optional(),
    page: z.number().min(1, 'Page must be greater than 0').default(1),
    limit: z.number().min(1, 'Limit must be greater than 0').max(100, 'Maximum limit is 100').default(10),
})

export const getPostsByDateSchema = z.object({
    fromDate: z
        .string()
        .transform((val) => new Date(Number(val)))
        .refine((date) => !isNaN(date.getTime()), { message: 'Invalid fromDate' }),

    toDate: z
        .string()
        .transform((val) => new Date(Number(val)))
        .refine((date) => !isNaN(date.getTime()), { message: 'Invalid toDate' }),
})

const retryPostTargetSchema = z.object({
    postId: z.string().uuid('Invalid UUID format for post ID'),
    socialAccountId: z.string().uuid('Invalid UUID format for social account ID'),
})

export type SinglePost = z.infer<typeof singlePost>
export type CreatePostsRequest = z.infer<typeof postsRequestSchema>
export type GetPostsByFiltersRequest = z.infer<typeof getPostsByFiltersSchema>
export type RetryPostTargetRequest = z.infer<typeof retryPostTargetSchema>

export { postsRequestSchema, singlePost, retryPostTargetSchema }
