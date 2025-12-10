import { IPostsRepository } from '@/repositories/posts-repository'
import { BaseAppError } from '@/shared/errors/base-error'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { ISocialMediaPostSenderService } from './social-media-post-sender.interface'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { SocialMediaPublisherFactory } from '@/services/social-media/factories/socia-media-publisher.factory'
import { SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { PostStatus } from '@/types/posts.types'
import { SocialMediaErrorHandler } from '@/shared/infra/social-media-errors/social-media-error-handler'

export class SocialMediaPostSenderService implements ISocialMediaPostSenderService {
    private postRepository: IPostsRepository
    private logger: ILogger
    private errorHandler: SocialMediaErrorHandler
    private socialMediaPublisherFactory: SocialMediaPublisherFactory
    private onPostSuccessCallback?: (userId: string, postId: string) => Promise<void>
    private onPostFailureCallback?: (userId: string, postId: string) => Promise<void>

    constructor(
        postRepository: IPostsRepository,
        logger: ILogger,
        errorHandler: SocialMediaErrorHandler,
        socialMediaPublisherFactory: SocialMediaPublisherFactory
    ) {
        this.postRepository = postRepository
        this.logger = logger
        this.errorHandler = errorHandler
        this.socialMediaPublisherFactory = socialMediaPublisherFactory
    }

    setOnPostSuccessCallback(callback: (userId: string, postId: string) => Promise<void>): void {
        this.onPostSuccessCallback = callback
    }

    setOnPostFailureCallback(callback: (userId: string, postId: string) => Promise<void>): void {
        this.onPostFailureCallback = callback
    }

    async sendPost(
        userId: string,
        postId: string,
        platform: SocilaMediaPlatform,
        socialAccountId?: string
    ): Promise<void> {
        try {
            const post = await this.postRepository.getPostDetails(postId, userId)

            const targetForPlatform = socialAccountId
                ? post.targets.find(
                      (target) => target.platform === platform && target.socialAccountId === socialAccountId
                  )
                : post.targets.find((target) => target.platform === platform)

            if (!targetForPlatform) {
                throw new BaseAppError(
                    `No target found for platform: ${platform}${
                        socialAccountId ? ` and socialAccountId: ${socialAccountId}` : ''
                    }`,
                    ErrorCode.NOT_FOUND,
                    404
                )
            }

            if (post.status === PostStatus.DRAFT) {
                this.logger.info('Skipping draft post', {
                    operation: 'sendPost',
                    userId,
                    postId,
                    platform,
                    status: post.status,
                })
                return
            }

            if (post.status !== PostStatus.POSTING) {
                await this.postRepository.updateBasePost(postId, userId, PostStatus.POSTING, new Date(), undefined)
            }

            await this.socialMediaPublisherFactory.publish(platform, targetForPlatform, userId, postId, {
                mainCaption: post.mainCaption,
                post,
            })

            if (this.onPostSuccessCallback) {
                await this.onPostSuccessCallback(userId, postId)
            }

            this.logger.info('Successfully sent post to platform', {
                operation: 'sendPost',
                userId,
                postId,
                platform,
            })
        } catch (error: unknown) {
            if (this.onPostFailureCallback) {
                await this.onPostFailureCallback(userId, postId)
            }

            const errorResult = await this.errorHandler.handleSocialMediaError(
                error,
                platform,
                userId,
                postId,
                socialAccountId || ''
            )

            throw errorResult.error
        }
    }

    async sendPostToAllPlatforms(userId: string, postId: string): Promise<void> {
        try {
            const post = await this.postRepository.getPostDetails(postId, userId)

            this.logger.info('Starting to send post to all platforms', {
                operation: 'sendPostToAllPlatforms',
                userId,
                postId,
                platforms: post.targets.map((t) => t.platform),
                targetCount: post.targets.length,
            })

            await this.postRepository.updateBasePost(postId, userId, PostStatus.POSTING, new Date(), undefined)

            const results = await Promise.allSettled(
                post.targets.map((target) => this.sendPost(userId, postId, target.platform, target.socialAccountId))
            )

            const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
            const successes = results.filter(
                (result): result is PromiseFulfilledResult<void> => result.status === 'fulfilled'
            )

            if (failures.length === results.length) {
                await this.postRepository.updateBasePost(postId, userId, PostStatus.FAILED, new Date(), undefined)

                this.logger.error('All platforms failed for post', {
                    operation: 'sendPostToAllPlatforms',
                    userId,
                    postId,
                    totalPlatforms: results.length,
                    failureCount: failures.length,
                })

                throw new BaseAppError(
                    `Failed to send post to all ${failures.length} platform(s)`,
                    ErrorCode.UNKNOWN_ERROR,
                    500
                )
            } else if (successes.length === results.length) {
                await this.postRepository.updateBasePost(postId, userId, PostStatus.DONE, new Date(), undefined)
            } else if (successes.length !== results.length && failures.length !== results.length) {
                await this.postRepository.updateBasePost(
                    postId,
                    userId,
                    PostStatus.PARTIALLY_DONE,
                    new Date(),
                    undefined
                )
            }

            this.logger.info('Post sending completed', {
                operation: 'sendPostToAllPlatforms',
                userId,
                postId,
                totalPlatforms: results.length,
                successCount: successes.length,
                failureCount: failures.length,
                status: successes.length > 0 ? 'partial_success' : 'all_failed',
            })

            if (failures.length > 0 && successes.length > 0) {
                this.logger.warn('Some platforms failed during post sending', {
                    operation: 'sendPostToAllPlatforms',
                    userId,
                    postId,
                    failureCount: failures.length,
                    successCount: successes.length,
                })
            }
        } catch (error: unknown) {
            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError('Failed to send post to all platforms', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
