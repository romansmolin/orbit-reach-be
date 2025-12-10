import { PostTargetEntity } from '@/entities/post-target'

import { IPostsRepository } from '@/repositories/posts-repository'
import { CreatePostsRequest, SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { BaseAppError } from '@/shared/errors/base-error'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { IMediaUploader } from '@/shared/infra/media/media-uploader.interface'
import { SocialMediaErrorHandler } from '@/shared/infra/social-media-errors/social-media-error-handler'
import { ISocialMediaPostSenderService } from '../social-media-post-sender-service'
import { IPostsService, PlatformLimitError } from './posts.service.interface'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { IPostScheduler } from '@/shared/infra/queue'
import {
    CreatePostResponse,
    PostStatus,
    PostTarget,
    PostFilters,
    PostsListResponse,
    PostsByDateResponse,
    PostTargetResponse,
} from '@/types/posts.types'
import { IUserRepository } from '@/repositories/user-repository'
import { IPlatformQuotaService } from '../platform-quota-service/platform-quota.service.interface'
import { PlatformRateLimiter } from '@/shared/infra/queue/utils/rate-limiter'
import { redis } from '@/shared/infra/queue/scheduler/redis'
import { VideoConverter } from '@/shared/infra/video-processor/video-converter'
import * as path from 'path'
import { mkdir, writeFile, unlink, rmdir } from 'fs/promises'
import * as ffmpeg from 'fluent-ffmpeg'
import { ITenantSettingsService } from '../tenant-settings-service/tenant-settings.service.interface'
import { isFutureDateWithTimezone, normalizeDateWithTimezone } from '@/shared/infra/timezone/timezone.utils'
import axios from 'axios'

export class PostService implements IPostsService {
    private postRepository: IPostsRepository
    private mediaUploader: IMediaUploader
    private logger: ILogger
    private postScheduler: IPostScheduler
    private socialMediaPostSender: ISocialMediaPostSenderService
    private userRepository: IUserRepository
    private platformUsageService: IPlatformQuotaService
    private tenantSettingsService: ITenantSettingsService
    private rateLimiter: PlatformRateLimiter
    private videoConverter: VideoConverter

    private errorHandler: SocialMediaErrorHandler

    constructor(
        postRepository: IPostsRepository,
        mediaUploader: IMediaUploader,
        logger: ILogger,
        postScheduler: IPostScheduler,
        socialMediaPostSender: ISocialMediaPostSenderService,
        userRepository: IUserRepository,
        platformUsageService: IPlatformQuotaService,
        tenantSettingsService: ITenantSettingsService,
        errorHandler: SocialMediaErrorHandler
    ) {
        this.postRepository = postRepository
        this.logger = logger
        this.mediaUploader = mediaUploader
        this.postScheduler = postScheduler
        this.socialMediaPostSender = socialMediaPostSender
        this.userRepository = userRepository
        this.platformUsageService = platformUsageService
        this.tenantSettingsService = tenantSettingsService
        this.rateLimiter = new PlatformRateLimiter(redis)
        this.videoConverter = new VideoConverter(logger)
        this.errorHandler = errorHandler

        // Set callbacks to avoid circular dependency
        this.socialMediaPostSender.setOnPostSuccessCallback(this.checkAndUpdateBasePostStatus.bind(this))
        this.socialMediaPostSender.setOnPostFailureCallback(this.checkAndUpdateBasePostStatus.bind(this))
    }

    private async uploadCoverImage(coverImageFile: Express.Multer.File, userId: string): Promise<string> {
        try {
            const coverImageUrl = await this.mediaUploader.upload({
                key: `${userId}/covers/${Date.now()}-${coverImageFile.originalname}`,
                body: coverImageFile.buffer,
                contentType: coverImageFile.mimetype,
            })

            return coverImageUrl
        } catch (error: unknown) {
            throw error
        }
    }

    private async validateVideoDuration(
        file: Express.Multer.File,
        createPostsRequest: CreatePostsRequest
    ): Promise<void> {
        // Check if any post targets Instagram
        const hasInstagramTarget = createPostsRequest.posts.some((post) => post.platform === 'instagram')

        if (!hasInstagramTarget) {
            return // No Instagram targets, no need to validate duration
        }

        try {
            // Create a temporary file to get video duration
            const tempDir = await this.createTempDir()
            const tempFilePath = path.join(tempDir, `temp-${Date.now()}.${file.originalname.split('.').pop()}`)

            await this.writeBufferToFile(file.buffer, tempFilePath)

            const videoInfo = await this.getVideoDuration(tempFilePath)

            // Clean up temp file
            await this.cleanupTempFiles([tempFilePath], tempDir)

            if (videoInfo.duration < 3) {
                throw new BaseAppError(
                    `Video duration is too short for Instagram Reels. Minimum duration is 3 seconds, but your video is ${videoInfo.duration.toFixed(2)} seconds.`,
                    ErrorCode.BAD_REQUEST,
                    400
                )
            }

            this.logger.info('Video duration validation passed', {
                operation: 'validateVideoDuration',
                duration: videoInfo.duration,
                fileName: file.originalname,
                platform: 'instagram',
            })
        } catch (error) {
            if (error instanceof BaseAppError) {
                throw error // Re-throw validation errors
            }

            this.logger.warn('Video duration validation failed, allowing upload', {
                operation: 'validateVideoDuration',
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    code: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                },
                fileName: file.originalname,
            })
            // Don't throw error for validation failures, just log and continue
        }
    }

    private async getVideoDuration(videoPath: string): Promise<{ duration: number }> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    reject(err)
                    return
                }

                const duration = metadata.format.duration || 0
                resolve({ duration })
            })
        })
    }

    private async createTempDir(): Promise<string> {
        const tempDir = path.join(process.cwd(), 'temp', 'video-validation', `validation-${Date.now()}`)
        await mkdir(tempDir, { recursive: true })
        return tempDir
    }

    private async writeBufferToFile(buffer: Buffer, filePath: string): Promise<void> {
        await writeFile(filePath, buffer)
    }

    private async cleanupTempFiles(filePaths: string[], dir?: string): Promise<void> {
        for (const filePath of filePaths) {
            try {
                await unlink(filePath)
            } catch (error) {
                this.logger.warn('Failed to cleanup temporary file', {
                    filePath,
                    error: {
                        name: error instanceof Error ? error.name : 'UnknownError',
                        code: error instanceof Error ? error.message : 'Unknown error',
                        stack: error instanceof Error ? error.stack : undefined,
                    },
                })
            }
        }

        if (dir) {
            try {
                await rmdir(dir)
            } catch (error) {
                this.logger.warn('Failed to cleanup temporary directory', {
                    dir,
                    error: {
                        name: error instanceof Error ? error.name : 'UnknownError',
                        code: error instanceof Error ? error.message : 'Unknown error',
                        stack: error instanceof Error ? error.stack : undefined,
                    },
                })
            }
        }
    }

    private getFileMimeTypeFromURL(url: string, returnMimeType = false): string | null {
        const pathname = new URL(url).pathname
        const ext = pathname.split('.').pop()?.toLowerCase()

        if (!ext) return null

        if (!returnMimeType) {
            return ext
        }

        const mimeTypes: Record<string, string> = {
            mp4: 'video/mp4',
            webm: 'video/webm',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
            svg: 'image/svg+xml',
        }

        return mimeTypes[ext] || `application/octet-stream` // fallback
    }

    private buildSafeFilenameFromUrl(url: string, index: number): string {
        try {
            const pathname = new URL(url).pathname
            const decoded = decodeURIComponent(pathname.split('/').pop() || '')
            const base = decoded.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
            if (base) return `${Date.now()}-${index}-${base}`
        } catch (_) {
            // fallback handled below
        }
        return `${Date.now()}-${index}-media`
    }

    private buildSafeFilename(originalName: string, index: number, fallbackExt?: string): string {
        const name = decodeURIComponent(originalName || '').trim()
        const hasExt = name.includes('.')
        const safe = name
            .replace(/[^a-zA-Z0-9._-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
        const ext = hasExt ? '' : fallbackExt ? `.${fallbackExt}` : ''
        const base = safe || `media${ext}`
        return `${Date.now()}-${index}-${base}`
    }

    private async uploadAndSaveMediaFiles(
        medias: Express.Multer.File[] | { [fieldname: string]: Express.Multer.File[] } | undefined,
        userId: string,
        postId: string,
        createPostsRequest: CreatePostsRequest,
        copyDataUrls?: string[]
    ): Promise<void> {
        let mediaFiles: Express.Multer.File[] = []
        let orderCounter = 1

        if (copyDataUrls && copyDataUrls.length > 0) {
            const copyTasks = copyDataUrls.map(async (copyUrl, idx) => {
                const safeName = this.buildSafeFilenameFromUrl(copyUrl, idx)
                try {
                    const response = await axios.get<ArrayBuffer>(copyUrl, { responseType: 'arraybuffer' })
                    const buffer = Buffer.from(response.data)
                    const mimeType =
                        response.headers['content-type'] || this.getFileMimeTypeFromURL(copyUrl, true) || `application/octet-stream`

                    const mediaUrl = await this.mediaUploader.upload({
                        key: `${userId}/posts/${safeName}`,
                        body: buffer,
                        contentType: mimeType,
                    })

                    const { mediaId } = await this.postRepository.savePostMediaAssets({
                        userId,
                        url: mediaUrl,
                        type: mimeType,
                    })

                    await this.postRepository.createPostMediaAssetRelation(postId, mediaId, orderCounter++)

                    this.logger.info('Attached copied media asset to post', {
                        operation: 'uploadAndSaveMediaFiles',
                        userId,
                        postId,
                        mediaId,
                        sourceIndex: idx,
                        mimeType,
                        order: orderCounter - 1,
                    })
                } catch (error) {
                    this.logger.warn('Failed to re-upload copied media, falling back to source URL', {
                        operation: 'uploadAndSaveMediaFiles',
                        userId,
                        postId,
                        copyUrl,
                        error:
                            error instanceof Error
                                ? { name: error.name, code: 'COPY_UPLOAD_FAILED', stack: error.message }
                                : { name: 'UnknownError', code: 'COPY_UPLOAD_FAILED' },
                    })

                    const mimeType = this.getFileMimeTypeFromURL(copyUrl, true) || `application/octet-stream`
                    const { mediaId } = await this.postRepository.savePostMediaAssets({
                        userId,
                        url: copyUrl,
                        type: mimeType,
                    })
                    await this.postRepository.createPostMediaAssetRelation(postId, mediaId, orderCounter++)
                }
            })

            await Promise.all(copyTasks)
        }

        if (Array.isArray(medias)) {
            mediaFiles = medias
        } else if (medias && typeof medias === 'object') {
            delete medias['coverImage']
            mediaFiles = Object.values(medias).flat()
        }

        if (mediaFiles.length > 0) {
            for (let index = 0; index < mediaFiles.length; index++) {
                const file = mediaFiles[index]
                let processedBuffer = file.buffer
                let contentType = file.mimetype
                let originalName = this.buildSafeFilename(file.originalname, orderCounter, file.mimetype.split('/')[1])

                // Validate video duration for Instagram requirements
                if (file.mimetype.includes('video')) {
                    await this.validateVideoDuration(file, createPostsRequest)
                }

                // Check if video needs conversion
                if (file.mimetype.includes('video') && this.videoConverter.needsConversion(file.mimetype, 'mp4')) {
                    this.logger.info('Converting video to MP4', {
                        operation: 'uploadAndSaveMediaFiles',
                        originalMimeType: file.mimetype,
                        originalName: file.originalname,
                    })

                    try {
                        processedBuffer = await this.videoConverter.convertVideo(file.buffer, {
                            targetFormat: 'mp4',
                            quality: 'medium',
                            maxFileSize: 50 * 1024 * 1024, // 50MB limit
                        })
                        contentType = this.videoConverter.getMimeTypeForFormat('mp4')

                        // Update filename extension
                        originalName = originalName.replace(/\.(mov|MOV|webm|WEBM)$/, '.mp4')

                        this.logger.info('Video conversion completed', {
                            operation: 'uploadAndSaveMediaFiles',
                            originalSize: file.buffer.length,
                            convertedSize: processedBuffer.length,
                            newMimeType: contentType,
                            newName: originalName,
                        })
                    } catch (error) {
                        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
                        this.logger.error('Video conversion failed, using original file', {
                            operation: 'uploadAndSaveMediaFiles',
                            error: { name: 'VideoConversionError', stack: errorMessage },
                            originalMimeType: file.mimetype,
                        })
                        // Fallback to original file if conversion fails
                        processedBuffer = file.buffer
                        contentType = file.mimetype
                    }
                }

                // Upload processed media
                const mediaUrl = await this.mediaUploader.upload({
                    key: `${userId}/posts/${originalName}`,
                    body: processedBuffer,
                    contentType: contentType,
                })

                const { mediaId } = await this.postRepository.savePostMediaAssets({
                    userId,
                    url: mediaUrl,
                    type: contentType,
                })

                await this.postRepository.createPostMediaAssetRelation(postId, mediaId, orderCounter++)

                this.logger.info('Successfully uploaded media', {
                    operation: 'createPost',
                    userId,
                    postId,
                    mediaId,
                    index: orderCounter - 1,
                    totalFiles: mediaFiles.length + (copyDataUrls?.length ?? 0),
                    contentType,
                    originalName,
                })
            }
        }
    }

    private async handlePostLimitChanges(
        userId: string,
        oldPost: any,
        newPostRequest: CreatePostsRequest
    ): Promise<void> {
        if (newPostRequest.postStatus === PostStatus.DRAFT) {
            return
        }
        try {
            const startOfMonth = new Date()
            startOfMonth.setDate(1)
            startOfMonth.setHours(0, 0, 0, 0)

            // End of current month
            const endOfMonth = new Date(startOfMonth)
            endOfMonth.setMonth(endOfMonth.getMonth() + 1)
            endOfMonth.setDate(0)
            endOfMonth.setHours(23, 59, 59, 999)

            const oldWasScheduled = !!oldPost.scheduledTime
            const newIsScheduled = !!newPostRequest.scheduledTime
            const oldTargetsCount = oldPost.targets ? oldPost.targets.length : 0
            const newTargetsCount = newPostRequest.posts ? newPostRequest.posts.length : 0

            // Case 1: Old post was scheduled, new post is scheduled
            if (oldWasScheduled && newIsScheduled) {
                // No change in scheduled limit (still 1), but check if target count changed
                if (oldTargetsCount !== newTargetsCount) {
                    // Validate new limits
                    await this.checkIfUserLimitsReached(newPostRequest, userId)
                }
            }
            // Case 2: Old post was scheduled, new post is immediate
            else if (oldWasScheduled && !newIsScheduled) {
                // Decrement scheduled by 1, increment sent by new target count
                await this.userRepository.updateUserPlanUsage(userId, 'scheduled', -1, startOfMonth, endOfMonth)

                if (newTargetsCount > 0) {
                    await this.userRepository.updateUserPlanUsage(
                        userId,
                        'sent',
                        newTargetsCount,
                        startOfMonth,
                        endOfMonth
                    )
                }

                this.logger.info('Updated limits: scheduled -> immediate', {
                    operation: 'handlePostLimitChanges',
                    userId,
                    scheduledDecremented: 1,
                    sentIncremented: newTargetsCount,
                })
            }
            // Case 3: Old post was immediate, new post is scheduled
            else if (!oldWasScheduled && newIsScheduled) {
                // Decrement sent by old target count, increment scheduled by 1
                if (oldTargetsCount > 0) {
                    await this.userRepository.updateUserPlanUsage(
                        userId,
                        'sent',
                        -oldTargetsCount,
                        startOfMonth,
                        endOfMonth
                    )
                }

                await this.userRepository.updateUserPlanUsage(userId, 'scheduled', 1, startOfMonth, endOfMonth)

                this.logger.info('Updated limits: immediate -> scheduled', {
                    operation: 'handlePostLimitChanges',
                    userId,
                    sentDecremented: oldTargetsCount,
                    scheduledIncremented: 1,
                })
            }
            // Case 4: Old post was immediate, new post is immediate
            else if (!oldWasScheduled && !newIsScheduled) {
                // Check if target count changed
                if (oldTargetsCount !== newTargetsCount) {
                    const diff = newTargetsCount - oldTargetsCount
                    if (diff > 0) {
                        // Validate new limits
                        await this.checkIfUserLimitsReached(newPostRequest, userId)
                    }

                    await this.userRepository.updateUserPlanUsage(userId, 'sent', diff, startOfMonth, endOfMonth)

                    this.logger.info('Updated limits: immediate target count change', {
                        operation: 'handlePostLimitChanges',
                        userId,
                        oldTargetsCount,
                        newTargetsCount,
                        diff,
                    })
                }
            }
        } catch (error: unknown) {
            this.logger.error('Failed to handle post limit changes', {
                operation: 'handlePostLimitChanges',
                userId,
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw error
        }
    }

    private async handlePlatformUsageUpdate(
        userId: string,
        oldPost: any,
        newPostRequest: CreatePostsRequest | null,
        operation: 'edit' | 'delete',
        postId: string
    ): Promise<void> {
        if (newPostRequest?.postStatus === PostStatus.DRAFT) {
            return
        }
        try {
            const oldScheduledTime = oldPost.scheduledTime ? new Date(oldPost.scheduledTime) : null
            const oldPosts = oldPost.targets || []

            if (operation === 'delete') {
                // Release platform slots for deleted post if it was scheduled
                if (oldScheduledTime) {
                    await this.platformUsageService.releasePlatformSlots(userId, oldPosts, oldScheduledTime)
                }

                // Decrement Redis rate limits for each platform target
                for (const post of oldPosts) {
                    try {
                        // Decrement per-account limits (use socialAccountId)
                        await this.rateLimiter.decrementUsage(post.platform, userId, post.socialAccountId)
                        // Decrement app limits (use userId)
                        await this.rateLimiter.decrementAppUsage(post.platform, userId)

                        this.logger.info('Decremented Redis rate limit for deleted post', {
                            operation: 'handlePlatformUsageUpdate',
                            userId,
                            postId,
                            platform: post.platform,
                            socialAccountId: post.socialAccountId,
                        })
                    } catch (error) {
                        this.logger.warn('Failed to decrement Redis rate limit', {
                            operation: 'handlePlatformUsageUpdate',
                            userId,
                            postId,
                            platform: post.platform,
                            socialAccountId: post.socialAccountId,
                            error: {
                                name: error instanceof Error ? error.name : 'UnknownError',
                                stack: error instanceof Error ? error.stack : undefined,
                            },
                        })
                    }
                }

                // Cancel all scheduled jobs for this post
                for (const post of oldPosts) {
                    try {
                        await this.postScheduler.cancelScheduledPost(post.platform, postId)

                        // Update post target status to CANCELLED
                        await this.cancelPostTarget(userId, postId, post.socialAccountId)

                        this.logger.info('Cancelled scheduled job for deleted post', {
                            operation: 'handlePlatformUsageUpdate',
                            userId,
                            postId,
                            platform: post.platform,
                            socialAccountId: post.socialAccountId,
                        })
                    } catch (error) {
                        // Fallback: try to cleanup any remaining jobs
                        this.logger.warn('Failed to cancel scheduled job, attempting cleanup', {
                            operation: 'handlePlatformUsageUpdate',
                            userId,
                            postId,
                            platform: post.platform,
                            socialAccountId: post.socialAccountId,
                            error: {
                                name: error instanceof Error ? error.name : 'UnknownError',
                                stack: error instanceof Error ? error.stack : undefined,
                            },
                        })

                        try {
                            await this.postScheduler.cleanupJobsForDeletedPost(post.platform, postId)

                            // Update post target status to CANCELLED even if cleanup succeeded
                            await this.cancelPostTarget(userId, postId, post.socialAccountId)

                            this.logger.info('Successfully cleaned up jobs for deleted post', {
                                operation: 'handlePlatformUsageUpdate',
                                userId,
                                postId,
                                platform: post.platform,
                                socialAccountId: post.socialAccountId,
                            })
                        } catch (cleanupError) {
                            this.logger.error('Failed to cleanup jobs for deleted post', {
                                operation: 'handlePlatformUsageUpdate',
                                userId,
                                postId,
                                platform: post.platform,
                                socialAccountId: post.socialAccountId,
                                error: {
                                    name: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
                                    stack: cleanupError instanceof Error ? cleanupError.stack : undefined,
                                },
                            })
                        }
                    }
                }
                return
            }

            if (operation === 'edit' && newPostRequest) {
                const newScheduledTime = newPostRequest.scheduledTime
                const newPosts = newPostRequest.posts || []

                // Case 1: Post was scheduled and new time is different
                if (oldScheduledTime && newScheduledTime && oldScheduledTime.getTime() !== newScheduledTime.getTime()) {
                    // Release old slots
                    await this.platformUsageService.releasePlatformSlots(userId, oldPosts, oldScheduledTime)

                    // Validate new platform quotas
                    const platformValidation = await this.platformUsageService.validatePlatformQuotas(
                        userId,
                        newPosts,
                        newScheduledTime
                    )

                    if (!platformValidation.isValid) {
                        const firstError = platformValidation.errors[0]
                        const platformErrorCode = this.getPlatformErrorCode(firstError.platform)
                        throw new BaseAppError(
                            `${firstError.platform} daily limit exceeded: ${firstError.current}/${firstError.limit} used, requested ${firstError.requested} posts`,
                            platformErrorCode,
                            429
                        )
                    }

                    // Reserve new slots
                    await this.platformUsageService.reservePlatformSlots(userId, newPosts, newScheduledTime)

                    // Reschedule the jobs in the queue for the new time
                    for (const post of newPosts) {
                        await this.postScheduler.reschedulePost(post.platform, postId, userId, newScheduledTime)
                    }
                }
                // Case 2: Post was scheduled and new time is the same
                else if (
                    oldScheduledTime &&
                    newScheduledTime &&
                    oldScheduledTime.getTime() === newScheduledTime.getTime()
                ) {
                    // Same date, check if post count changed
                    const oldPostCount = this.groupPostsByPlatform(oldPosts)
                    const newPostCount = this.groupPostsByPlatform(newPosts)

                    for (const [platform, oldPlatformPosts] of oldPostCount) {
                        const newPlatformPosts = newPostCount.get(platform) || []
                        const countDiff = newPlatformPosts.length - oldPlatformPosts.length

                        if (countDiff !== 0) {
                            // Validate new total count
                            const platformValidation = await this.platformUsageService.validatePlatformQuotas(
                                userId,
                                newPosts,
                                newScheduledTime
                            )

                            if (!platformValidation.isValid) {
                                const firstError = platformValidation.errors[0]
                                const platformErrorCode = this.getPlatformErrorCode(firstError.platform)
                                throw new BaseAppError(
                                    `${firstError.platform} daily limit exceeded: ${firstError.current}/${firstError.limit} used, requested ${firstError.requested} posts`,
                                    platformErrorCode,
                                    429
                                )
                            }

                            // Update platform usage
                            await this.platformUsageService.updatePlatformUsage(
                                userId,
                                platform,
                                newScheduledTime,
                                countDiff
                            )
                        }
                    }
                }
                // Case 3: Post was scheduled and is now immediate
                else if (oldScheduledTime && !newScheduledTime) {
                    // Post changed from scheduled to immediate, release slots and cancel scheduled jobs
                    await this.platformUsageService.releasePlatformSlots(userId, oldPosts, oldScheduledTime)

                    // Cancel all scheduled jobs for this post
                    for (const post of oldPosts) {
                        await this.postScheduler.cancelScheduledPost(post.platform, postId)
                    }
                }
                // Case 4: Post was immediate and is now scheduled
                else if (!oldScheduledTime && newScheduledTime) {
                    // Validate new platform quotas
                    const platformValidation = await this.platformUsageService.validatePlatformQuotas(
                        userId,
                        newPosts,
                        newScheduledTime
                    )

                    if (!platformValidation.isValid) {
                        const firstError = platformValidation.errors[0]
                        const platformErrorCode = this.getPlatformErrorCode(firstError.platform)
                        throw new BaseAppError(
                            `${firstError.platform} daily limit exceeded: ${firstError.current}/${firstError.limit} used, requested ${firstError.requested} posts`,
                            platformErrorCode,
                            429
                        )
                    }

                    // Reserve new slots
                    await this.platformUsageService.reservePlatformSlots(userId, newPosts, newScheduledTime)

                    // Schedule new jobs
                    for (const post of newPosts) {
                        await this.postScheduler.schedulePost(post.platform, postId, userId, newScheduledTime)
                    }
                }
            }
        } catch (error: unknown) {
            this.logger.error('Failed to handle platform usage update', {
                operation: 'handlePlatformUsageUpdate',
                userId,
                postId,
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    code: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw error
        }
    }

    private groupPostsByPlatform(posts: any[]): Map<string, any[]> {
        const grouped = new Map<string, any[]>()

        for (const post of posts) {
            if (!grouped.has(post.platform)) {
                grouped.set(post.platform, [])
            }
            grouped.get(post.platform)!.push(post)
        }

        return grouped
    }

    private async incrementSentPostsLimit(userId: string, count: number): Promise<void> {
        try {
            let temp = 0
            const startOfMonth = new Date()
            startOfMonth.setDate(1)
            startOfMonth.setHours(0, 0, 0, 0)

            const endOfMonth = new Date(startOfMonth)
            endOfMonth.setMonth(endOfMonth.getMonth() + 1)
            endOfMonth.setDate(0)
            endOfMonth.setHours(23, 59, 59, 999)

            temp += 1

            this.logger.debug('THE METHODS WORKS TWO TIMES: ', { temp })
            await this.userRepository.updateUserPlanUsage(userId, 'sent', count, startOfMonth, endOfMonth)
        } catch (error: unknown) {
            this.logger.error('Failed to increment sent posts limit', {
                operation: 'incrementSentPostsLimit',
                userId,
                count,
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    code: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
        }
    }

    private getPlatformErrorCode(platform: string): ErrorCode {
        const platformUpper = platform.toUpperCase()
        switch (platformUpper) {
            case 'TIKTOK':
                return ErrorCode.TIKTOK_DAILY_LIMIT
            case 'YOUTUBE':
                return ErrorCode.YOUTUBE_DAILY_LIMIT
            case 'PINTEREST':
                return ErrorCode.PINTEREST_DAILY_LIMIT
            case 'INSTAGRAM':
                return ErrorCode.INSTAGRAM_DAILY_LIMIT
            case 'THREADS':
                return ErrorCode.THREADS_DAILY_LIMIT
            case 'FACEBOOK':
                return ErrorCode.FACEBOOK_DAILY_LIMIT
            case 'BLUESKY':
                return ErrorCode.BLUESKY_DAILY_LIMIT
            case 'LINKEDIN':
                return ErrorCode.LINKEDIN_DAILY_LIMIT
            case 'GOOGLE':
                return ErrorCode.GOOGLE_DAILY_LIMIT
            case 'X':
                return ErrorCode.X_DAILY_LIMIT
            default:
                return ErrorCode.RATE_LIMIT_EXCEEDED
        }
    }

    private async checkIfUserLimitsReached(postRequest: CreatePostsRequest, userId: string): Promise<void> {
        try {
            const startOfMonth = new Date()
            startOfMonth.setDate(1)
            startOfMonth.setHours(0, 0, 0, 0)

            // End of current month
            const endOfMonth = new Date(startOfMonth)
            endOfMonth.setMonth(endOfMonth.getMonth() + 1)
            endOfMonth.setDate(0)
            endOfMonth.setHours(23, 59, 59, 999)

            const userQuotaUsage = await this.userRepository.getCurrentUsageQuota(userId, startOfMonth, endOfMonth)

            const isScheduled = postRequest.scheduledTime && !postRequest.postNow

            if (isScheduled) {
                // For scheduled posts: count 1 per post (regardless of targets)
                const newScheduledCount = userQuotaUsage.scheduledPosts.used + 1
                if (newScheduledCount > userQuotaUsage.scheduledPosts.limit) {
                    throw new BaseAppError(
                        `The user would exceed the monthly usage for scheduling posts. Current: ${userQuotaUsage.scheduledPosts.used}/${userQuotaUsage.scheduledPosts.limit}, Requested: 1`,
                        ErrorCode.PLAN_LIMIT_REACHED,
                        400
                    )
                }
            }

            if (!isScheduled) {
                // For immediate posts: count each post target as a sent post
                const postTargetsCount = postRequest.posts ? postRequest.posts.length : 0
                const newSentCount = userQuotaUsage.sentPosts.used + postTargetsCount
                if (newSentCount > userQuotaUsage.sentPosts.limit) {
                    throw new BaseAppError(
                        `The user would exceed the monthly usage for sending posts. Current: ${userQuotaUsage.sentPosts.used}/${userQuotaUsage.sentPosts.limit}, Requested: ${postTargetsCount}`,
                        ErrorCode.PLAN_LIMIT_REACHED,
                        400
                    )
                }
            }
        } catch (error: unknown) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to check user limits', ErrorCode.BAD_REQUEST, 500)
        }
    }

    private async normalizeScheduledTime(
        tenantId: string,
        scheduledTime: Date | null | undefined,
        scheduledTimeInput?: string | null
    ): Promise<{ scheduledTime: Date | null; tenantTimezone: string | null }> {
        if (!scheduledTime) {
            return { scheduledTime: null, tenantTimezone: null }
        }

        try {
            const timezone = await this.tenantSettingsService.getTimezone(tenantId)

            if (!timezone) {
                return { scheduledTime, tenantTimezone: null }
            }

            if (!scheduledTimeInput) {
                return { scheduledTime, tenantTimezone: timezone }
            }

            const normalized = normalizeDateWithTimezone(scheduledTime, {
                timeZone: timezone,
                originalInput: scheduledTimeInput,
            })

            return {
                scheduledTime: normalized,
                tenantTimezone: timezone,
            }
        } catch (error) {
            this.logger.warn('Failed to normalize scheduled time with tenant timezone', {
                operation: 'normalizeScheduledTime',
                tenantId,
                error: error instanceof Error ? { name: error.name } : { name: 'UnknownError' },
            })
            return { scheduledTime, tenantTimezone: null }
        }
    }

    async createPost(
        createPostsRequest: CreatePostsRequest,
        medias: { [fieldname: string]: Express.Multer.File[] } | undefined | Express.Multer.File[],
        userId: string,
        scheduledTimeInput?: string | null
    ): Promise<CreatePostResponse | PlatformLimitError> {
        try {
            const originalScheduledTime = createPostsRequest.scheduledTime

            const { scheduledTime: normalizedScheduledTime, tenantTimezone } = await this.normalizeScheduledTime(
                userId,
                originalScheduledTime,
                scheduledTimeInput
            )

            const requestWithTimezone: CreatePostsRequest = {
                ...createPostsRequest,
                scheduledTime: normalizedScheduledTime ?? originalScheduledTime,
            }

            const isDraft = requestWithTimezone.postStatus === PostStatus.DRAFT

            const shouldValidateScheduledTime = !isDraft && !requestWithTimezone.postNow

            if (shouldValidateScheduledTime) {
                const isFuture = isFutureDateWithTimezone(originalScheduledTime, {
                    timeZone: tenantTimezone,
                    scheduledTimeInput,
                })
                if (!isFuture) {
                    throw new BaseAppError('Scheduled time must be in the future', ErrorCode.BAD_REQUEST, 400)
                }
            }

            if (!isDraft) {
                await this.checkIfUserLimitsReached(requestWithTimezone, userId)
            }

            if (!isDraft && requestWithTimezone.scheduledTime) {
                const platformValidation = await this.platformUsageService.validatePlatformQuotas(
                    userId,
                    requestWithTimezone.posts,
                    requestWithTimezone.scheduledTime
                )

                if (!platformValidation.isValid) {
                    const firstError = platformValidation.errors[0]
                    const platformErrorCode = this.getPlatformErrorCode(firstError.platform)
                    return {
                        code: platformErrorCode,
                        message: `${firstError.platform} daily limit exceeded: ${firstError.current}/${firstError.limit} used, requested ${firstError.requested} posts`,
                        platform: firstError.platform,
                        current: firstError.current,
                        limit: firstError.limit,
                        requested: firstError.requested,
                    }
                }
            }

            let initialStatus = requestWithTimezone.postStatus

            if (!isDraft && requestWithTimezone.scheduledTime && !requestWithTimezone.postNow) {
                initialStatus = PostStatus.PENDING
            }

            let coverImageUrl: string | undefined

            if (medias && typeof medias === 'object' && !Array.isArray(medias)) {
                const coverImageFiles = medias['coverImage']

                if (Array.isArray(coverImageFiles) && coverImageFiles.length > 0) {
                    coverImageUrl = await this.uploadCoverImage(coverImageFiles[0], userId)
                }
            }

            const { postId } = await this.postRepository.createBasePost(
                userId,
                initialStatus,
                requestWithTimezone.postType,
                requestWithTimezone.scheduledTime,
                requestWithTimezone.mainCaption,
                requestWithTimezone.coverTimestamp,
                coverImageUrl
            )

            if (requestWithTimezone.postType === 'media' && (medias || requestWithTimezone.copyDataUrls))
                await this.uploadAndSaveMediaFiles(
                    medias,
                    userId,
                    postId,
                    requestWithTimezone,
                    requestWithTimezone.copyDataUrls
                )

            const postTargets: PostTarget[] = requestWithTimezone.posts.map((post) => ({
                ...post,
                postId,
                socialAccountId: post.account,
            }))

            if (!isDraft && requestWithTimezone.scheduledTime && !requestWithTimezone.postNow && postId && requestWithTimezone.posts.length > 0) {
                const scheduledTime = requestWithTimezone.scheduledTime
                requestWithTimezone.posts.forEach((post) => {
                    this.postScheduler.schedulePost(
                        post.platform,
                        postId,
                        userId,
                        scheduledTime,
                        post.account
                    )
                })
            }

            await this.postRepository.createPostTargets(postTargets)

            if (!isDraft && requestWithTimezone.scheduledTime && !requestWithTimezone.postNow) {
                await this.platformUsageService.reservePlatformSlots(
                    userId,
                    requestWithTimezone.posts,
                    requestWithTimezone.scheduledTime
                )
            }
            if (!isDraft && requestWithTimezone.postNow) {
                const rateLimitPromises = requestWithTimezone.posts.map(async (postTarget) => {

                    const rateLimitResult = await this.rateLimiter.checkRateLimit(
                        postTarget.platform,
                        userId,
                        postTarget.account
                    )
					
                    if (!rateLimitResult.allowed) {
                        throw new BaseAppError(
                            `Rate limit exceeded for ${postTarget.platform}. Retry after ${rateLimitResult.retryAfter}ms`,
                            ErrorCode.RATE_LIMIT_EXCEEDED,
                            429
                        )
                    }
                })

                try {
                    await Promise.all(rateLimitPromises)
                } catch (error) {
                    this.logger.warn('Rate limit check failed for immediate post', {
                        operation: 'createPost',
                        userId,
                        postId,
                        error: {
                            name: error instanceof Error ? error.name : 'Unknown Error',
                            stack: error instanceof Error ? error.stack : undefined,
                        },
                    })
                    throw error
                }
				
                await this.platformUsageService.reservePlatformSlots(userId, requestWithTimezone.posts, new Date())

                this.logger.info('Starting immediate post sending', {
                    operation: 'createPost',
                    userId,
                    postId,
                    postCount: requestWithTimezone.posts.length,
                    platforms: requestWithTimezone.posts.map((p) => p.platform),
                })

                const targetsByPlatform = requestWithTimezone.posts.reduce(
                    (acc, target) => {
                        if (!acc[target.platform]) {
                            acc[target.platform] = []
                        }
                        acc[target.platform].push(target)
                        return acc
                    },
                    {} as Record<string, any[]>
                )

                const sendingPromises = Object.entries(targetsByPlatform).map(([platform, targets]) => {
                    return Promise.all(
                        targets.map(async (target) => {
                            try {
                                await this.socialMediaPostSender.sendPost(userId, postId, platform as SocilaMediaPlatform, target.account)
                                return { success: true, target }
                            } catch (error) {
                                return { success: false, target, error }
                            }
                        })
                    )
                })

                const results = await Promise.allSettled(sendingPromises)

                const allTargetResults: Array<{ target: any; success: boolean; error?: any }> = []

                results.forEach((platformResult, platformIndex) => {
                    if (platformResult.status === 'fulfilled') {
                        const targetResults = platformResult.value

                        targetResults.forEach((targetResult) => {
                            allTargetResults.push({
                                target: targetResult.target,
                                success: targetResult.success,
                                error: targetResult.error,
                            })
                        })
                    } else {
                        const platformTargets = Object.values(targetsByPlatform)[platformIndex]
                        platformTargets.forEach((target) => {
                            allTargetResults.push({
                                target,
                                success: false,
                                error: platformResult.reason,
                            })
                        })
                    }
                })

                const failures = allTargetResults.filter((item) => !item.success)
                const successes = allTargetResults.filter((item) => item.success)

                if (failures.length > 0) {
                    await Promise.all(
                        failures.map(async ({ target, error }) => {
                            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

                            await this.postRepository.updatePostTarget(
                                userId,
                                postId,
                                target.account,
                                PostStatus.FAILED,
                                errorMessage
                            )
                        })
                    )
                }

                if (successes.length > 0) {
                    await Promise.all(
                        successes.map(async ({ target }) => {
                            await this.postRepository.updatePostTarget(userId, postId, target.account, PostStatus.DONE)
                        })
                    )
                }

                if (failures.length === requestWithTimezone.posts.length) {
                    await this.postRepository.updateBasePost(
                        postId,
                        userId,
                        PostStatus.FAILED,
                        requestWithTimezone.scheduledTime || new Date(),
                        requestWithTimezone.mainCaption
                    )

                    this.logger.error('All immediate posts failed to send', {
                        operation: 'createPost',
                        postId,
                        userId,
                        failureCount: failures.length,
                        totalPosts: requestWithTimezone.posts.length,
                        errors: failures.map((f) => (f.error instanceof Error ? f.error.message : 'Unknown error')),
                    })
                } else if (successes.length === requestWithTimezone.posts.length) {
                    await this.postRepository.updateBasePost(
                        postId,
                        userId,
                        PostStatus.DONE,
                        requestWithTimezone.scheduledTime || new Date(),
                        requestWithTimezone.mainCaption
                    )

                    this.logger.info('All immediate posts sent successfully', {
                        operation: 'createPost',
                        postId,
                        userId,
                        successCount: successes.length,
                        totalPosts: requestWithTimezone.posts.length,
                    })
                } else {
                    await this.postRepository.updateBasePost(
                        postId,
                        userId,
                        PostStatus.PARTIALLY_DONE,
                        requestWithTimezone.scheduledTime || new Date(),
                        requestWithTimezone.mainCaption
                    )

                    this.logger.warn('Some immediate posts failed to send', {
                        operation: 'createPost',
                        postId,
                        userId,
                        successCount: successes.length,
                        failureCount: failures.length,
                        totalPosts: requestWithTimezone.posts.length,
                        errors: failures.map((f) => (f.error instanceof Error ? f.error.message : 'Unknown error')),
                    })
                }

                const successfulTargets = successes.map(({ target }) => target)
                const successfulCount = successfulTargets.length

                if (successfulCount > 0) {
                    await this.incrementSentPostsLimit(userId, successfulCount)

                    for (const target of successfulTargets) {
                        try {
                            await this.rateLimiter.incrementUsage(target.platform, userId, target.account)
                            await this.rateLimiter.incrementAppUsage(target.platform, userId)

                            this.logger.debug('Incremented rate limits for immediate post target', {
                                operation: 'createPost',
                                userId,
                                postId,
                                platform: target.platform,
                                socialAccountId: target.account,
                            })
                        } catch (error) {
                            this.logger.warn('Failed to increment rate limits for immediate post target', {
                                operation: 'createPost',
                                userId,
                                postId,
                                platform: target.platform,
                                socialAccountId: target.account,
                                error: {
                                    name: error instanceof Error ? error.name : 'UnknownError',
                                    code: error instanceof Error ? error.message : 'Unknown error',
                                    stack: error instanceof Error ? error.stack : undefined,
                                },
                            })
                        }
                    }

                    this.logger.info('Incremented sent posts usage for immediate posts', {
                        operation: 'createPost',
                        userId,
                        postId,
                        incrementCount: successfulCount,
                    })
                }
            }

            const startOfMonth = new Date()
            startOfMonth.setDate(1)
            startOfMonth.setHours(0, 0, 0, 0)

            // End of current month
            const endOfMonth = new Date(startOfMonth)
            endOfMonth.setMonth(endOfMonth.getMonth() + 1)
            endOfMonth.setDate(0)
            endOfMonth.setHours(23, 59, 59, 999)

            const isScheduled = requestWithTimezone.scheduledTime && !requestWithTimezone.postNow && !isDraft

            if (isScheduled) {
                await this.userRepository.updateUserPlanUsage(userId, 'scheduled', 1, startOfMonth, endOfMonth)
            }

            return await this.postRepository.getPostDetails(postId, userId)
        } catch (error: unknown) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to create post', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async editPost(
        postId: string,
        updatePostRequest: CreatePostsRequest,
        file: Express.Multer.File | undefined,
        userId: string,
        scheduledTimeInput?: string | null
    ): Promise<void> {
        try {
            const oldPost = await this.postRepository.getPostDetails(postId, userId)

            if (oldPost.status === PostStatus.DONE) {
                throw new BaseAppError(
                    'Post cannot be changed, it has been alreary got published!',
                    ErrorCode.BAD_REQUEST,
                    400
                )
            }

            const originalScheduledTime = updatePostRequest.scheduledTime
            const { scheduledTime: normalizedScheduledTime, tenantTimezone } = await this.normalizeScheduledTime(
                userId,
                originalScheduledTime,
                scheduledTimeInput
            )
            const requestWithTimezone: CreatePostsRequest = {
                ...updatePostRequest,
                scheduledTime: normalizedScheduledTime ?? originalScheduledTime,
            }

            const shouldValidateScheduledTime =
                requestWithTimezone.postStatus !== PostStatus.DRAFT && !requestWithTimezone.postNow

            if (shouldValidateScheduledTime) {
                const isFuture = isFutureDateWithTimezone(originalScheduledTime, {
                    timeZone: tenantTimezone,
                    scheduledTimeInput,
                })
                if (!isFuture) {
                    throw new BaseAppError('Scheduled time must be in the future', ErrorCode.BAD_REQUEST, 400)
                }
            }

            // Handle limit changes for post edits
            await this.handlePostLimitChanges(userId, oldPost, requestWithTimezone)

            // Handle platform usage updates for scheduled posts
            await this.handlePlatformUsageUpdate(userId, oldPost, requestWithTimezone, 'edit', postId)

            await this.postRepository.updateBasePost(
                postId,
                userId,
                requestWithTimezone.postStatus as PostStatus,
                requestWithTimezone.scheduledTime,
                requestWithTimezone.mainCaption
            )

            if (requestWithTimezone.postType === 'media') {
                if (file) {
                    const existingMedia = await this.postRepository.getPostMediaAsset(postId)

                    const mediaUrl = await this.mediaUploader.upload({
                        key: `${userId}/posts/${Date.now()}-${file.originalname}`,
                        body: file.buffer,
                        contentType: file.mimetype,
                    })

                    const { mediaId } = await this.postRepository.savePostMediaAssets({
                        userId,
                        url: mediaUrl,
                        type: file.mimetype,
                    })

                    await this.postRepository.createPostMediaAssetRelation(postId, mediaId, 1)

                    if (existingMedia) {
                        await this.mediaUploader.delete(existingMedia.url)
                        await this.postRepository.deletePostMediaAsset(existingMedia.mediaId)
                    }

                    this.logger.info('Successfully updated media', {
                        operation: 'editPost',
                        userId,
                        postId,
                        mediaId,
                    })
                }
            }

            const postTargets: PostTarget[] = requestWithTimezone.posts.map((post) => ({
                ...post,
                postId,
                socialAccountId: post.account,
            }))

            await this.postRepository.updatePostTargets(postId, postTargets)

            this.logger.info(`Successfully updated ${requestWithTimezone.postType} post`, {
                operation: 'editPost',
                userId,
                postId,
                postType: requestWithTimezone.postType,
                targetCount: postTargets.length,
            })
        } catch (error: unknown) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to update post', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async hasExistingMedia(postId: string): Promise<boolean> {
        try {
            const mediaAsset = await this.postRepository.getPostMediaAsset(postId)
            return !!mediaAsset
        } catch (error) {
            this.logger.error('Failed to check existing media', {
                operation: 'hasExistingMedia',
                postId,
            })
            return false
        }
    }

    async getPostsByFilters(userId: string, filters: PostFilters): Promise<PostsListResponse> {
        try {
            const response = await this.postRepository.getPosts(userId, filters)
            return response
        } catch (error) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to get posts', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async deletePostsOrphanedByAccount(userId: string, accountId: string): Promise<void> {
        try {
            const orphanedPostIds = await this.postRepository.getPostsTargetedOnlyByAccount(userId, accountId)

            if (orphanedPostIds.length === 0) return

            const deletionResults = await Promise.allSettled(
                orphanedPostIds.map(async (postId) => {
                    await this.deletePost(postId, userId)
                    this.logger.info('Deleted post with no remaining targets after account removal', {
                        operation: 'deletePost',
                        userId,
                        postId,
                        removedAccountId: accountId,
                    })
                })
            )

            const failedDeletions = deletionResults.filter(
                (result): result is PromiseRejectedResult => result.status === 'rejected'
            )

            if (failedDeletions.length > 0) {
                this.logger.error('Failed to delete one or more orphaned posts for account removal', {
                    operation: 'deletePost',
                    userId,
                    removedAccountId: accountId,
                    failedCount: failedDeletions.length,
                })

                const firstError = failedDeletions[0].reason
                if (firstError instanceof BaseAppError) throw firstError
                throw new BaseAppError(
                    'Failed to delete orphaned post for account removal',
                    ErrorCode.UNKNOWN_ERROR,
                    500
                )
            }
        } catch (error) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to delete orphaned posts for account removal', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async deletePost(postId: string, userId: string): Promise<void> {
        try {
            // Get post details before deletion to handle platform usage
            const postDetails = await this.postRepository.getPostDetails(postId, userId)

            // Handle platform usage updates for scheduled posts
            if (postDetails.scheduledTime) {
                await this.handlePlatformUsageUpdate(userId, postDetails, null, 'delete', postId)
            }

            // Update user account limit for deleted posts
            if (postDetails.status !== PostStatus.DONE) {
                const startOfMonth = new Date()
                startOfMonth.setDate(1)
                startOfMonth.setHours(0, 0, 0, 0)

                // End of current month
                const endOfMonth = new Date(startOfMonth)
                endOfMonth.setMonth(endOfMonth.getMonth() + 1)
                endOfMonth.setDate(0)
                endOfMonth.setHours(23, 59, 59, 999)

                if (postDetails.scheduledTime) {
                    // For scheduled posts: decrement by 1 (regardless of targets)
                    await this.userRepository.updateUserPlanUsage(userId, 'scheduled', -1, startOfMonth, endOfMonth)

                    // Also decrement Redis rate limit counters for each target
                    if (postDetails.targets && postDetails.targets.length > 0) {
                        for (const target of postDetails.targets) {
                            try {
                                await this.rateLimiter.decrementUsage(target.platform, userId, target.socialAccountId)
                                this.logger.info('Decremented Redis rate limit for deleted scheduled post', {
                                    operation: 'deletePost',
                                    userId,
                                    postId,
                                    platform: target.platform,
                                    socialAccountId: target.socialAccountId,
                                })
                            } catch (error) {
                                this.logger.warn('Failed to decrement Redis rate limit for deleted scheduled post', {
                                    operation: 'deletePost',
                                    userId,
                                    postId,
                                    platform: target.platform,
                                })
                            }
                        }
                    }

                    this.logger.info('Decremented user scheduled posts usage', {
                        operation: 'deletePost',
                        userId,
                        postId,
                        postStatus: postDetails.status,
                        scheduledTime: postDetails.scheduledTime,
                        decremented: 1,
                    })
                } else {
                    // For immediate posts: decrement by the number of targets that were counted as sent
                    const postTargetsCount = postDetails.targets ? postDetails.targets.length : 0
                    if (postTargetsCount > 0) {
                        await this.userRepository.updateUserPlanUsage(
                            userId,
                            'sent',
                            -postTargetsCount,
                            startOfMonth,
                            endOfMonth
                        )

                        // Also decrement Redis rate limit counters for each target
                        for (const target of postDetails.targets) {
                            try {
                                await this.rateLimiter.decrementUsage(target.platform, userId, target.socialAccountId)
                                this.logger.info('Decremented Redis rate limit for deleted immediate post', {
                                    operation: 'deletePost',
                                    userId,
                                    postId,
                                    platform: target.platform,
                                    socialAccountId: target.socialAccountId,
                                })
                            } catch (error) {
                                this.logger.warn('Failed to decrement Redis rate limit for deleted immediate post', {
                                    operation: 'deletePost',
                                    userId,
                                    postId,
                                    platform: target.platform,
                                })
                            }
                        }

                        this.logger.info('Decremented user sent posts usage', {
                            operation: 'deletePost',
                            userId,
                            postId,
                            postStatus: postDetails.status,
                            decremented: postTargetsCount,
                        })
                    }
                }
            }

            const { mediaUrls, coverImageUrl } = await this.postRepository.deletePost(postId, userId)

            // Delete media files from S3
            if (mediaUrls.length > 0) {
                await Promise.all(
                    mediaUrls.map(async (url) => {
                        try {
                            await this.mediaUploader.delete(url)
                        } catch (error) {
                            this.logger.error('Failed to delete media from S3', {
                                operation: 'deletePost',
                                postId,
                                userId,
                                url,
                                error:
                                    error instanceof Error
                                        ? {
                                              name: error.name,
                                              stack: error.stack,
                                          }
                                        : undefined,
                            })
                        }
                    })
                )
            }

            // Delete cover image from S3
            if (coverImageUrl) {
                try {
                    await this.mediaUploader.delete(coverImageUrl)
                } catch (error) {
                    this.logger.error('Failed to delete cover image from S3', {
                        operation: 'deletePost',
                        postId,
                        userId,
                        coverImageUrl,
                        error:
                            error instanceof Error
                                ? {
                                      name: error.name,
                                      stack: error.stack,
                                  }
                                : undefined,
                    })
                }
            }

            this.logger.info('Successfully deleted post', {
                operation: 'deletePost',
                userId,
                postId,
                mediaCount: mediaUrls.length,
                hasCoverImage: !!coverImageUrl,
            })
        } catch (error) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to delete post', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async getPostsByDate(tenantId: string, fromDate: Date, toDate: Date): Promise<PostsByDateResponse> {
        try {
            const { posts } = await this.postRepository.getPostsByDate(tenantId, fromDate, toDate)

            return { posts }
        } catch (error: unknown) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to get posts by from date and to date', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async getPostsFailedCount(userId: string): Promise<number> {
        try {
            const failedCount = await this.postRepository.getPostsFailedCount(userId)

            return failedCount
        } catch (error: unknown) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to get failed posts count', ErrorCode.BAD_REQUEST, 500)
        }
    }

    async retryPostTarget(
        userId: string,
        postId: string,
        socialAccountId: string
    ): Promise<{ postTarget: PostTargetResponse; post: CreatePostResponse }> {
        try {
            const result = await this.postRepository.retryPostTarget(userId, postId, socialAccountId)

            try {
                // Send the post to the platform
                await this.socialMediaPostSender.sendPost(
                    userId,
                    postId,
                    result.postTarget.platform,
                    result.postTarget.socialAccountId
                )

                const postDetails = await this.postRepository.getPostDetails(postId, userId)
                const retriedTarget = postDetails.targets.find((t) => t.socialAccountId === socialAccountId)

                if (retriedTarget && retriedTarget.status === PostStatus.DONE) {
                    await this.incrementSentPostsLimit(userId, 1)

                    await this.rateLimiter.incrementUsage(retriedTarget.platform, userId, retriedTarget.socialAccountId)
                    await this.rateLimiter.incrementAppUsage(retriedTarget.platform, userId)

                    this.logger.info('Incremented sent posts limit and rate limits for retried target', {
                        operation: 'retryPostTarget',
                        userId,
                        postId,
                        socialAccountId,
                        platform: retriedTarget.platform,
                        incrementCount: 1,
                    })
                } else {
                    this.logger.info('Retry target not successful - no counter increment', {
                        operation: 'retryPostTarget',
                        userId,
                        postId,
                        socialAccountId,
                        targetStatus: retriedTarget?.status || 'not found',
                    })
                }

                await this.checkAndUpdateBasePostStatusWithoutCounters(userId, postId)

                this.logger.info('Post target retry completed successfully', {
                    operation: 'retryPostTarget',
                    userId,
                    postId,
                    socialAccountId,
                    platform: result.postTarget.platform,
                })

                return result
            } finally {
                // Restore original callbacks
                this.socialMediaPostSender.setOnPostSuccessCallback(this.checkAndUpdateBasePostStatus.bind(this))
                this.socialMediaPostSender.setOnPostFailureCallback(this.checkAndUpdateBasePostStatus.bind(this))
            }
        } catch (error: unknown) {
            // Restore original callbacks in case of error
            this.socialMediaPostSender.setOnPostSuccessCallback(this.checkAndUpdateBasePostStatus.bind(this))
            this.socialMediaPostSender.setOnPostFailureCallback(this.checkAndUpdateBasePostStatus.bind(this))

            // For retry failures, we need to update the post status but not increment counters
            // The post should remain PARTIALLY_DONE if some targets are successful and some failed
            try {
                await this.checkAndUpdateBasePostStatusWithoutCounters(userId, postId)
            } catch (statusError) {
                this.logger.error('Failed to update post status after retry failure', {
                    operation: 'retryPostTarget',
                    userId,
                    postId,
                    socialAccountId,
                    error:
                        statusError instanceof Error
                            ? {
                                  name: statusError.name,
                                  code: (statusError as any).code,
                                  stack: statusError.stack,
                              }
                            : undefined,
                })
            }

            // Use centralized error handling for retry failures
            const errorResult = await this.errorHandler.handleSocialMediaError(
                error,
                'unknown',
                userId,
                postId,
                socialAccountId
            )

            // Always throw the error from the error handler
            throw errorResult.error
        }
    }

    async cancelPostTarget(userId: string, postId: string, socialAccountId: string): Promise<void> {
        try {
            await this.postRepository.updatePostTarget(
                userId,
                postId,
                socialAccountId,
                PostStatus.FAILED,
                'Job cancelled'
            )

            this.logger.info('Cancelled post target', {
                operation: 'cancelPostTarget',
                userId,
                postId,
                socialAccountId,
            })
        } catch (error: unknown) {
            this.logger.error('Failed to cancel post target', {
                operation: 'cancelPostTarget',
                userId,
                postId,
                socialAccountId,
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw error
        }
    }

    async checkAndUpdateBasePostStatusWithoutCounters(userId: string, postId: string): Promise<void> {
        try {
            const postDetails = await this.postRepository.getPostDetails(postId, userId)

            const allTargetsDone = postDetails.targets.every((target) => target.status === PostStatus.DONE)
            const someTargetsDone = postDetails.targets.some((target) => target.status === PostStatus.DONE)
            const someTargetsFailed = postDetails.targets.some((target) => target.status === PostStatus.FAILED)
            const allTargetsFailed = postDetails.targets.every((target) => target.status === PostStatus.FAILED)

            // Update to DONE if all targets are successful
            if (allTargetsDone && postDetails.status !== PostStatus.DONE) {
                await this.postRepository.updateBasePost(postId, userId, PostStatus.DONE, new Date(), undefined)

                this.logger.info('Base post status updated to DONE', {
                    operation: 'checkAndUpdateBasePostStatusWithoutCounters',
                    userId,
                    postId,
                    targetCount: postDetails.targets.length,
                    doneCount: postDetails.targets.filter((t) => t.status === PostStatus.DONE).length,
                })
            }
            // Update to PARTIALLY_DONE if some targets succeeded and some failed
            else if (someTargetsDone && someTargetsFailed && postDetails.status !== PostStatus.PARTIALLY_DONE) {
                await this.postRepository.updateBasePost(
                    postId,
                    userId,
                    PostStatus.PARTIALLY_DONE,
                    new Date(),
                    undefined
                )

                this.logger.info('Base post status updated to PARTIALLY_DONE', {
                    operation: 'checkAndUpdateBasePostStatusWithoutCounters',
                    userId,
                    postId,
                    targetCount: postDetails.targets.length,
                    doneCount: postDetails.targets.filter((t) => t.status === PostStatus.DONE).length,
                    failedCount: postDetails.targets.filter((t) => t.status === PostStatus.FAILED).length,
                })
            }
            // Update from POSTING to PARTIALLY_DONE if some targets succeeded and some failed
            else if (postDetails.status === PostStatus.POSTING && someTargetsDone && someTargetsFailed) {
                await this.postRepository.updateBasePost(
                    postId,
                    userId,
                    PostStatus.PARTIALLY_DONE,
                    new Date(),
                    undefined
                )

                this.logger.info('Base post status updated from POSTING to PARTIALLY_DONE', {
                    operation: 'checkAndUpdateBasePostStatusWithoutCounters',
                    userId,
                    postId,
                    targetCount: postDetails.targets.length,
                    doneCount: postDetails.targets.filter((t) => t.status === PostStatus.DONE).length,
                    failedCount: postDetails.targets.filter((t) => t.status === PostStatus.FAILED).length,
                })
            }
            // Update to FAILED if all targets failed
            else if (allTargetsFailed && postDetails.status !== PostStatus.FAILED) {
                await this.postRepository.updateBasePost(postId, userId, PostStatus.FAILED, new Date(), undefined)

                this.logger.info('Base post status updated to FAILED', {
                    operation: 'checkAndUpdateBasePostStatusWithoutCounters',
                    userId,
                    postId,
                    targetCount: postDetails.targets.length,
                })
            }
        } catch (error: unknown) {
            this.logger.error('Error checking and updating base post status', {
                operation: 'checkAndUpdateBasePostStatusWithoutCounters',
                userId,
                postId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: (error as any).code,
                              stack: error.stack,
                          }
                        : undefined,
            })
        }
    }

    async checkAndUpdateBasePostStatus(userId: string, postId: string): Promise<void> {
        try {
            const postDetails = await this.postRepository.getPostDetails(postId, userId)

            const allTargetsDone = postDetails.targets.every((target) => target.status === PostStatus.DONE)
            const someTargetsDone = postDetails.targets.some((target) => target.status === PostStatus.DONE)
            const someTargetsFailed = postDetails.targets.some((target) => target.status === PostStatus.FAILED)
            const allTargetsFailed = postDetails.targets.every((target) => target.status === PostStatus.FAILED)

            // Count successfully published targets for sent posts limit
            const successfullyPublishedTargets = postDetails.targets.filter(
                (target) => target.status === PostStatus.DONE
            )
            const successfullyPublishedCount = successfullyPublishedTargets.length

            // Determine if we need to increment counters
            // Only increment if this is a status change that includes new successful targets
            let shouldIncrementCounters = false
            let incrementCount = 0

            // Update to DONE if all targets are successful
            if (allTargetsDone && postDetails.status !== PostStatus.DONE) {
                await this.postRepository.updateBasePost(postId, userId, PostStatus.DONE, new Date(), undefined)

                // For immediate posts, counters are already incremented in createPost
                // For scheduled posts, increment here since they weren't counted in createPost
                if (postDetails.scheduledTime) {
                    // Scheduled posts: increment here since they weren't counted in createPost
                    shouldIncrementCounters = true
                    incrementCount = successfullyPublishedCount
                }
                // For immediate posts that were just created, counters are already incremented in createPost
                // For retry posts, counters are handled in retryPostTarget method

                this.logger.info('Base post status updated to DONE', {
                    operation: 'checkAndUpdateBasePostStatus',
                    userId,
                    postId,
                    targetCount: postDetails.targets.length,
                    sentPostsIncremented: incrementCount,
                    isScheduled: !!postDetails.scheduledTime,
                    wasPosting: postDetails.status === PostStatus.POSTING,
                })
            }
            // Update to PARTIALLY_DONE if some targets succeeded and some failed
            else if (someTargetsDone && someTargetsFailed && postDetails.status !== PostStatus.PARTIALLY_DONE) {
                await this.postRepository.updateBasePost(
                    postId,
                    userId,
                    PostStatus.PARTIALLY_DONE,
                    new Date(),
                    undefined
                )

                // For immediate posts, counters are already incremented in createPost
                // For scheduled posts, increment here since they weren't counted in createPost
                if (postDetails.scheduledTime) {
                    // Scheduled posts: increment here since they weren't counted in createPost
                    shouldIncrementCounters = true
                    incrementCount = successfullyPublishedCount
                }
                // For immediate posts that were just created, counters are already incremented in createPost
                // For retry posts, counters are handled in retryPostTarget method

                this.logger.info('Base post status updated to PARTIALLY_DONE', {
                    operation: 'checkAndUpdateBasePostStatus',
                    userId,
                    postId,
                    targetCount: postDetails.targets.length,
                    doneCount: postDetails.targets.filter((t) => t.status === PostStatus.DONE).length,
                    failedCount: postDetails.targets.filter((t) => t.status === PostStatus.FAILED).length,
                    sentPostsIncremented: incrementCount,
                    isScheduled: !!postDetails.scheduledTime,
                    wasPosting: postDetails.status === PostStatus.POSTING,
                })
            }
            // Update to FAILED if all targets failed
            else if (allTargetsFailed && postDetails.status !== PostStatus.FAILED) {
                await this.postRepository.updateBasePost(postId, userId, PostStatus.FAILED, new Date(), undefined)

                this.logger.info('Base post status updated to FAILED', {
                    operation: 'checkAndUpdateBasePostStatus',
                    userId,
                    postId,
                    targetCount: postDetails.targets.length,
                    sentPostsIncremented: 0, // No sent posts for failed targets
                })
            }

            // Increment counters if needed
            if (shouldIncrementCounters && incrementCount > 0) {
                await this.incrementSentPostsLimit(userId, incrementCount)

                // Increment platform-specific rate limits for each successfully published target
                for (const target of successfullyPublishedTargets) {
                    try {
                        await this.rateLimiter.incrementUsage(target.platform, userId, target.socialAccountId)
                        await this.rateLimiter.incrementAppUsage(target.platform, userId)

                        this.logger.debug('Incremented rate limits for scheduled post target', {
                            operation: 'checkAndUpdateBasePostStatus',
                            userId,
                            postId,
                            platform: target.platform,
                            socialAccountId: target.socialAccountId,
                        })
                    } catch (error) {
                        this.logger.warn('Failed to increment rate limits for target', {
                            operation: 'checkAndUpdateBasePostStatus',
                            userId,
                            postId,
                            platform: target.platform,
                            socialAccountId: target.socialAccountId,
                            error: {
                                name: error instanceof Error ? error.name : 'UnknownError',
                                code: error instanceof Error ? error.message : 'Unknown error',
                                stack: error instanceof Error ? error.stack : undefined,
                            },
                        })
                    }
                }

                this.logger.info('Incremented sent posts limit and rate limits', {
                    operation: 'checkAndUpdateBasePostStatus',
                    userId,
                    postId,
                    incrementCount,
                    reason: postDetails.scheduledTime ? 'scheduled_post_completed' : 'retry_post_completed',
                })
            }
        } catch (error) {
            this.logger.error('Failed to check and update base post status', {
                operation: 'checkAndUpdateBasePostStatus',
                userId,
                postId,
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    code: error instanceof Error ? error.message : 'Unknown error',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
        }
    }

    async getFailedPostTargets(userId: string): Promise<PostTargetEntity[]> {
        try {
            const failedPosts = await this.postRepository.getFailedPostTargets(userId)

            return failedPosts
        } catch (err: unknown) {
            if (err instanceof BaseAppError) throw err
            throw new BaseAppError('Faile to get failed post targets', ErrorCode.BAD_REQUEST, 500)
        }
    }
}
