import { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import {
    postsRequestSchema,
    getPostsByFiltersSchema,
    getPostsByDateSchema,
    retryPostTargetSchema,
} from '../schemas/posts.schemas'
import { ILogger } from '../shared/infra/logger/logger.interface'
import { BaseAppError } from '../shared/errors/base-error'
import { ErrorCode } from '../shared/consts/error-codes.const'
import { IPostsService } from '../services/posts-service'
import { PlatformRateLimiter } from '../shared/infra/queue/utils/rate-limiter'
import { redis } from '../shared/infra/queue/scheduler/redis'
import { PostPlatforms } from '../schemas/posts.schemas'
import { AccountRepository } from '../repositories/account-repository/account.repository'

function extractZodErrors(error: ZodError) {
    return error.issues.map((issue) => {
        const [index, property] = issue.path

        return {
            index: typeof index === 'number' ? index : -1,
            property: String(property),
            error: issue.message,
        }
    })
}
export class PostsController {
    private interactor: IPostsService
    private logger: ILogger
    private rateLimiter: PlatformRateLimiter
    private accountRepository: AccountRepository

    constructor(interactor: IPostsService, logger: ILogger) {
        this.interactor = interactor
        this.logger = logger
        this.rateLimiter = new PlatformRateLimiter(redis)
        this.accountRepository = new AccountRepository(logger)
    }

    private parseCreatePostRequest(req: Request) {
        const { postType, posts, postStatus, scheduledTime, mainCaption, coverTimestamp, copyDataUrls, postNow } =
            req.body

        return {
            postType,
            posts: [...JSON.parse(posts)],
            postStatus,
            scheduledTime,
            ...(postNow && { postNow: Boolean(postNow) }),
            ...(mainCaption && { mainCaption }),
            ...(coverTimestamp && { coverTimestamp: Number(coverTimestamp) }),
            ...(copyDataUrls && { copyDataUrls: [...JSON.parse(copyDataUrls)] }),
        }
    }

    private parseEditPostRequest(req: Request) {
        const { postType, posts, postStatus, scheduledTime, mainCaption, coverTimestamp, postNow } = req.body
        const { postId } = req.params

        return {
            postId,
            postType,
            posts: [...JSON.parse(posts)],
            postStatus,
            scheduledTime,
            ...(mainCaption && { mainCaption }),
            ...(coverTimestamp && { coverTimestamp: Number(coverTimestamp) }),
        }
    }

    async createPost(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id

            if (!userId) throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)

            const parsedReq = this.parseCreatePostRequest(req)

            const scheduledTimeInput = parsedReq.scheduledTime
            let validatedData = postsRequestSchema.parse(parsedReq)

            const medias = req.files

            if (validatedData.postType === 'media' && !medias)
                throw new BaseAppError('Media posts requires at least one media file', ErrorCode.BAD_REQUEST, 400)

            const result = await this.interactor.createPost(validatedData, medias, userId, scheduledTimeInput)

            if ('code' in result && 'platform' in result) {
                const platformError = result
                res.status(429).json({
                    code: platformError.code,
                    message: platformError.message,
                    platform: platformError.platform,
                    current: platformError.current,
                    limit: platformError.limit,
                    requested: platformError.requested,
                })
                return
            }

            res.status(200).json({
                message: 'Scheduled successfully!',
            })
        } catch (error: unknown) {
            if (error instanceof ZodError) {
                this.logger.error('Request validation error', { error })

                res.status(400).json({
                    message: 'Validation error',
                    errors: extractZodErrors(error),
                })
                return
            }

            next(error)
        }
    }

    async editPost(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id

            if (!userId) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const parsedReq = this.parseEditPostRequest(req)
            const scheduledTimeInput = parsedReq.scheduledTime
            const validatedData = postsRequestSchema.parse(parsedReq)

            const media = req.file

            if (
                validatedData.postType === 'media' &&
                !media &&
                !(await this.interactor.hasExistingMedia(parsedReq.postId))
            ) {
                throw new BaseAppError('Media posts require at least one media file', ErrorCode.BAD_REQUEST, 400)
            }

            await this.interactor.editPost(parsedReq.postId, validatedData, media, userId, scheduledTimeInput)

            res.status(200).json({
                message: 'Post updated successfully!',
            })
        } catch (error: unknown) {
            if (error instanceof ZodError) {
                this.logger.error('Request validation error', { error })

                res.status(400).json({
                    message: 'Validation error',
                    errors: extractZodErrors(error),
                })
                return
            }

            next(error)
        }
    }

    async deletePost(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id
            const { postId } = req.params

            if (!userId) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            if (!postId) {
                throw new BaseAppError('Post ID is required', ErrorCode.BAD_REQUEST, 400)
            }

            await this.interactor.deletePost(postId, userId)

            res.status(200).json({
                message: 'Post deleted successfully',
            })
        } catch (error: unknown) {
            next(error)
        }
    }

    async getPostsByFilters(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                throw new BaseAppError('Unauthorized', ErrorCode.UNAUTHORIZED, 401)
            }

            const validatedFilters = getPostsByFiltersSchema.parse({
                platform: req.query.platform,
                socialAccountId: req.query.socialAccountId,
                fromDate: req.query.fromDate,
                toDate: req.query.toDate,
                status: req.query.status, // Default status
                page: req.query.page ? parseInt(req.query.page as string) : 1,
                limit: req.query.limit ? parseInt(req.query.limit as string) : 9,
            })

            const result = await this.interactor.getPostsByFilters(req.user.id, validatedFilters)
            res.json(result)
        } catch (error: unknown) {
            if (error instanceof ZodError) {
                this.logger.error('Invalid filter parameters', {
                    operation: 'getPostsByFilters',
                    errors: extractZodErrors(error),
                })
                return next(new BaseAppError('Invalid filter parameters', ErrorCode.BAD_REQUEST, 400))
            }
            next(error)
        }
    }

    async getPostsByDate(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                throw new BaseAppError('Unauthorized', ErrorCode.UNAUTHORIZED, 401)
            }

            const validatedReq = getPostsByDateSchema.parse(req.query)

            const { fromDate, toDate } = validatedReq

            const { posts } = await this.interactor.getPostsByDate(req.user.id, fromDate, toDate)
            res.json({ posts })
        } catch (error: unknown) {
            if (error instanceof ZodError) {
                this.logger.error('Request validation error', { error })

                res.status(400).json({
                    message: 'Validation error',
                    errors: extractZodErrors(error),
                })
                return
            }

            next(error)
        }
    }

    async getPostsFailedCount(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                throw new BaseAppError('Unauthorized', ErrorCode.UNAUTHORIZED, 401)
            }

            const failedCount = await this.interactor.getPostsFailedCount(req.user.id)

            res.status(200).json({ failedCount })
        } catch (error: unknown) {
            next(error)
        }
    }

    async retryPostTarget(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id

            if (!userId) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const validatedData = retryPostTargetSchema.parse(req.body)

            const result = await this.interactor.retryPostTarget(
                userId,
                validatedData.postId,
                validatedData.socialAccountId
            )

            res.status(200).json({
                message: 'Post target retry scheduled successfully',
                data: {
                    postTarget: result.postTarget,
                    post: result.post,
                },
            })
        } catch (error: unknown) {
            if (error instanceof ZodError) {
                this.logger.error('Request validation error', { error })

                res.status(400).json({
                    message: 'Validation error',
                    errors: extractZodErrors(error),
                })
                return
            }

            next(error)
        }
    }

    async getFailedPostTargets(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id

            if (!userId) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const failedPostTargets = await this.interactor.getFailedPostTargets(userId)

            this.logger.debug('FAILED POST TARGETS: ', failedPostTargets)

            res.status(200).json({ failedPostTargets })
        } catch (err: unknown) {
            next(err)
        }
    }

    async getRateLimits(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.user?.id

            if (!userId) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const now = Date.now()
            const dayStart = new Date(now)
            dayStart.setHours(0, 0, 0, 0)
            const dayStartTimestamp = dayStart.getTime()

            const connectedAccounts = await this.accountRepository.findByUserId(userId)

            const accountsByPlatform: Record<string, any[]> = {}
            for (const account of connectedAccounts) {
                if (!accountsByPlatform[account.platform]) {
                    accountsByPlatform[account.platform] = []
                }
                accountsByPlatform[account.platform].push(account)
            }

            const rateLimits: any = {}

            for (const platform of PostPlatforms) {
                const platformAccounts = accountsByPlatform[platform] || []

                if (platformAccounts.length === 0) {
                    rateLimits[platform] = {
                        accounts: [],
                        message: 'No connected accounts for this platform',
                    }
                    continue
                }

                const platformConfig = await this.rateLimiter.getPlatformConfig(platform)
                const platformLimits = platformConfig.limits

                const accountLimits: any[] = []

                for (const account of platformAccounts) {
                    try {
                        const dailyKey = `rate_limit:${platform}:${account.id}:daily:${dayStartTimestamp}`
                        const quotaKey =
                            platform === 'youtube'
                                ? `rate_limit:${platform}:app:quota:${dayStartTimestamp}`
                                : `rate_limit:${platform}:${account.id}:quota:${dayStartTimestamp}`

                        const dailyCount = await redis.get(dailyKey)
                        const quotaUsed = await redis.get(quotaKey)

                        const limits = platformLimits

                        let remainingQuota = 0
                        if (limits.postsPerDay) {
                            const used = dailyCount ? parseInt(dailyCount) : 0
                            remainingQuota = Math.max(0, limits.postsPerDay - used)
                        }
                        const canPost = await this.rateLimiter.checkRateLimit(platform, userId, account.id)

                        accountLimits.push({
                            accountId: account.id,
                            username: account.username,
                            platform: account.platform,
                            connectedDate: account.connectedDate,
                            limits: {
                                dailyCount: dailyCount ? parseInt(dailyCount) : 0,
                                quotaUsed: quotaUsed ? parseInt(quotaUsed) : 0,
                                maxDailyLimit: limits.postsPerDay || 0,
                            },
                            canPost: canPost.allowed,
                            retryAfter: canPost.retryAfter,
                            remainingQuota: remainingQuota,
                            resetTime: canPost.resetTime,
                        })
                    } catch (error) {
                        accountLimits.push({
                            accountId: account.id,
                            username: account.username,
                            platform: account.platform,
                            error: error instanceof Error ? error.message : 'Unknown error',
                        })
                    }
                }

                const platformRateLimit: any = {
                    accounts: accountLimits,
                    totalAccounts: platformAccounts.length,
                }

                if (platformLimits.appDailyLimit) {
                    try {
                        const appDailyKey = `app_rate_limit:${platform}:daily:${dayStartTimestamp}`
                        const appQuotaKey = `app_rate_limit:${platform}:quota:${dayStartTimestamp}`
                        const usersKey = `app_rate_limit:${platform}:users:${dayStartTimestamp}`

                        const appDailyCount = await redis.get(appDailyKey)
                        const appQuotaUsed = await redis.get(appQuotaKey)
                        const isUserInSet = await redis.sismember(usersKey, userId)

                        // For TikTok, use user count instead of post count for app limits
                        let dailyCount: number
                        let remainingQuota: number

                        if (platform === 'tiktok') {
                            const userCount = await redis.scard(usersKey)
                            dailyCount = userCount
                            remainingQuota = Math.max(0, platformLimits.appDailyLimit - userCount)
                        } else {
                            dailyCount = appDailyCount ? parseInt(appDailyCount) : 0
                            remainingQuota = Math.max(0, platformLimits.appDailyLimit - dailyCount)
                        }

                        platformRateLimit.appLimits = {
                            dailyCount,
                            quotaUsed: appQuotaUsed ? parseInt(appQuotaUsed) : 0,
                            maxDailyLimit: platformLimits.appDailyLimit,
                            remainingQuota,
                            isUserInSet: !!isUserInSet,
                        }
                    } catch (error) {
                        platformRateLimit.appLimits = {
                            error: error instanceof Error ? error.message : 'Unknown error',
                        }
                    }
                }

                rateLimits[platform] = platformRateLimit
            }

            res.status(200).json({
                userId,
                dayStart: dayStart.toISOString(),
                dayStartTimestamp,
                totalConnectedAccounts: connectedAccounts.length,
                rateLimits,
            })
        } catch (err: unknown) {
            next(err)
        }
    }
}
