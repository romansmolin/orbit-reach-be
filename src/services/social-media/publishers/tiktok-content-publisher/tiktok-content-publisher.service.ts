import { ITikTokContentPublisherService } from "./tiktok-content-publisher.interface";
import { ILogger } from "@/shared/infra/logger";
import { IAccountRepository } from "@/repositories/account-repository";
import { IPostsRepository } from "@/repositories/posts-repository";
import { IApiClient } from "@/shared/infra/api";
import { SocialMediaErrorHandler } from "@/shared/infra/social-media-errors";
import { BaseAppError } from "@/shared/errors/base-error";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import {
	PostStatus,
	PostTargetResponse,
	CreatePostResponse,
	TikTokPrivacyLevel,
	TikTokMediaAssestSourceType,
	TikTokPostMode,
} from "@/types/posts.types";
import { formatCaptionWithTags } from "../../utils/format-captions-with-tags";
import { IVideoProcessor } from "@/shared/infra/video-processor/video-processor.interface";
import { ImageProcessor } from "@/shared/infra/media/image-processor";
import { IMediaUploader } from "@/shared/infra/media";
import * as ffmpeg from "fluent-ffmpeg";
import * as path from "path";
import { mkdir, rm, writeFile } from "fs/promises";

type TikTokVideoInitResponse = {
	data: {
		publish_id: string
		upload_url: string
	}
}

type TikTokPhotoInitResponse = {
	data: {
		publish_id: string
	}
}

type TikTokStatusResponse = {
	data?: {
		status?: string
		fail_reason?: string
	}
}

type TikTokCreatorInfoResponse = {
	data?: {
		can_post?: boolean
		can_post_more?: boolean
		can_post_now?: boolean
		max_video_post_duration_sec?: number
		privacy_level_options?: string[]
	}
}

type TikTokCreatorInfoResult = {
	canPost: boolean | null
	maxVideoPostDurationSec: number | null
	privacyLevelOptions: string[] | null
}

export class TikTokContentPublisherService implements ITikTokContentPublisherService {
	private logger: ILogger
	private accountRepository: IAccountRepository
	private postRepository: IPostsRepository
	private httpClient: IApiClient
	private socialMediaErrorHandler: SocialMediaErrorHandler
	private videoProcessor: IVideoProcessor
	private imageProcessor: ImageProcessor
	private mediaUploader: IMediaUploader

	constructor(
		logger: ILogger,
		accountRepository: IAccountRepository,
		postRepository: IPostsRepository,
		httpClient: IApiClient,
		socialMediaErrorHandler: SocialMediaErrorHandler,
		videoProcessor: IVideoProcessor,
		imageProcessor: ImageProcessor,
		mediaUploader: IMediaUploader
	) {
		this.logger = logger
		this.accountRepository = accountRepository
		this.postRepository = postRepository
		this.httpClient = httpClient
		this.socialMediaErrorHandler = socialMediaErrorHandler
		this.videoProcessor = videoProcessor
		this.imageProcessor = imageProcessor
		this.mediaUploader = mediaUploader
	}

	private async downloadImage(url: string): Promise<Buffer> {
		const response = await this.httpClient.get<ArrayBuffer>(url, {
			responseType: 'arraybuffer',
			timeoutMs: 30000,
		})
		return Buffer.isBuffer(response) ? response : Buffer.from(response)
	}

	private async getOrCreateResizedImage(
		originalUrl: string,
		userId: string,
		postId: string,
		assetIndex: number
	): Promise<{ url: string; isTemporary: boolean }> {
		const imageBuffer = await this.downloadImage(originalUrl)
		const validation = await this.imageProcessor.validateImageForPlatform(imageBuffer, 'tiktok')

		if (validation.valid) {
			return { url: originalUrl, isTemporary: false }
		}

		const resizedKey = `${userId}/resized/tiktok/${postId}-${assetIndex}-${Date.now()}.jpg`
		const processedBuffer = await this.imageProcessor.processImageForPlatform(imageBuffer, 'tiktok', originalUrl)

		const resizedUrl = await this.mediaUploader.upload({
			key: resizedKey,
			body: processedBuffer,
			contentType: 'image/jpeg',
		})

		this.logger.info('Created resized image for TikTok', {
			operation: 'getOrCreateResizedImage',
			userId,
			postId,
			assetIndex,
			originalUrl,
			resizedUrl,
			originalSize: imageBuffer.length,
			resizedSize: processedBuffer.length,
		})

		return { url: resizedUrl, isTemporary: true }
	}

	private async cleanupTemporaryUploads(urls: string[]): Promise<void> {
		for (const url of urls) {
			try {
				await this.mediaUploader.delete(url)
				this.logger.debug('Cleaned up temporary media asset from S3', {
					operation: 'cleanupTemporaryUploads',
					url,
				})
			} catch (error) {
				this.logger.warn('Failed to cleanup temporary media asset from S3', {
					operation: 'cleanupTemporaryUploads',
					url,
					error: {
						name: error instanceof Error ? error.name : 'UnknownError',
						code: error instanceof Error ? error.message : 'Unknown error',
						stack: error instanceof Error ? error.stack : undefined,
					},
				})
			}
		}
	}

	private async getPostingCreatorInfo(accessToken: string, userId: string, postId: string): Promise<TikTokCreatorInfoResult> {
		const { TIKTOK_API_URL, TIKTOK_API_VERSION } = process.env

		if (!TIKTOK_API_URL || !TIKTOK_API_VERSION) {
			throw new BaseAppError('Missing TikTok API configuration', ErrorCode.NOT_FOUND, 404)
		}

		try {
			const response = await this.httpClient.post<TikTokCreatorInfoResponse>(
				`${TIKTOK_API_URL}/${TIKTOK_API_VERSION}/post/publish/creator_info/query/`,
				{}, // TikTok expects an empty JSON body; avoid sending headers as body
				{
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'Content-Type': 'application/json',
					},
				}
			)

			const infoPayload =
				(response as any)?.data ??
				(response as any)?.creator_info ??
				response ??
				(response as any)?.data
			const canPostSignal = [infoPayload?.can_post, infoPayload?.can_post_more, infoPayload?.can_post_now].find(
				(flag) => typeof flag === 'boolean'
			)
			const canPost = typeof canPostSignal === 'boolean' ? canPostSignal : null

			const rawDuration = infoPayload?.max_video_post_duration_sec
			const maxVideoPostDurationSec =
				typeof rawDuration === 'number'
					? rawDuration
					: typeof rawDuration === 'string' && rawDuration
						? Number(rawDuration)
						: null
			const privacyLevelOptions = Array.isArray(infoPayload?.privacy_level_options)
				? infoPayload.privacy_level_options
				: null
			const normalizedMaxDuration =
				typeof maxVideoPostDurationSec === 'number' && Number.isFinite(maxVideoPostDurationSec)
					? maxVideoPostDurationSec
					: null

			return {
				canPost,
				maxVideoPostDurationSec: normalizedMaxDuration,
				privacyLevelOptions,
			}
		} catch (error: unknown) {
			const responseData =
				error && typeof error === 'object' && 'response' in error && (error as any).response?.data
			this.logger.error('Error retrieving posting creator info from TikTok', {
				operation: 'getPostingCreatorInfo',
				userId,
				postId,
				responseData,
				error: {
					name: error instanceof Error ? error.name : 'UnknownError',
					code: error instanceof Error ? error.message : 'Unknown error occurred',
					stack: error instanceof Error ? error.stack : undefined,
				},
			})

			throw new BaseAppError('Failed to retrieve TikTok creator info', ErrorCode.UNKNOWN_ERROR, 500)
		}
	}

	private resolvePrivacyLevel(
		privacyOptions?: string[] | null,
		requestedPrivacy?: TikTokPrivacyLevel | null
	): TikTokPrivacyLevel {
		const validOptions = (privacyOptions || [])
			.map((option) => option?.toUpperCase())
			.filter((option): option is TikTokPrivacyLevel =>
				Object.values(TikTokPrivacyLevel).includes(option as TikTokPrivacyLevel)
			)

		if (requestedPrivacy) {
			if (validOptions.length === 0 || validOptions.includes(requestedPrivacy)) {
				return requestedPrivacy
			}
			this.logger.warn('Requested TikTok privacy level not allowed; falling back to available options', {
				operation: 'resolvePrivacyLevel',
				requestedPrivacy,
				availableOptions: validOptions,
			})
		}

		if (validOptions.includes(TikTokPrivacyLevel.SELF_ONLY)) {
			return TikTokPrivacyLevel.SELF_ONLY
		}

		return validOptions[0] ?? TikTokPrivacyLevel.SELF_ONLY
	}

	private async getVideoDurationSeconds(videoBuffer: Buffer, userId: string, postId: string): Promise<number> {
		const tempDir = path.join(process.cwd(), 'temp', 'tiktok-video-duration', `${userId}-${postId}-${Date.now()}`)
		const videoPath = path.join(tempDir, 'video.mp4')

		await mkdir(tempDir, { recursive: true })

		try {
			await writeFile(videoPath, videoBuffer)

			const duration = await new Promise<number>((resolve, reject) => {
				ffmpeg.ffprobe(videoPath, (err, metadata) => {
					if (err) {
						reject(err)
						return
					}

					resolve(metadata.format.duration || 0)
				})
			})

			return duration
		} catch (error) {
			this.logger.error('Failed to measure TikTok video duration', {
				operation: 'getVideoDurationSeconds',
				userId,
				postId,
				error: {
					name: error instanceof Error ? error.name : 'UnknownError',
					code: error instanceof Error ? error.message : 'Unknown error occurred',
					stack: error instanceof Error ? error.stack : undefined,
				},
			})

			throw new BaseAppError(
				'Unable to verify TikTok video duration. Please try again later.',
				ErrorCode.UNKNOWN_ERROR,
				500
			)
		} finally {
			try {
				await rm(tempDir, { recursive: true, force: true })
			} catch (cleanupError) {
				this.logger.warn('Failed to cleanup temporary TikTok duration file', {
					operation: 'getVideoDurationSeconds',
					userId,
					postId,
					error: {
						name: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
						code: cleanupError instanceof Error ? cleanupError.message : 'Unknown error occurred',
						stack: cleanupError instanceof Error ? cleanupError.stack : undefined,
					},
				})
			}
		}
	}

	async sendPostToTikTok(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		mainCaption?: string,
		post?: CreatePostResponse
	): Promise<void> {
		try {
			const { TIKTOK_API_URL, TIKTOK_API_VERSION } = process.env

			if (!TIKTOK_API_URL || !TIKTOK_API_VERSION) {
				throw new BaseAppError(
					'Lack of requiring environment variables for TiktTok API',
					ErrorCode.NOT_FOUND,
					404
				)
			}

			const mediaAssets = await this.postRepository.getPostMediaAssets(postId)

			if (mediaAssets.length === 0) {
				throw new BaseAppError('TikTok posts require video or image content', ErrorCode.BAD_REQUEST, 400)
			}

			const {
				accessToken,
				maxVideoPostDurationSec: storedMaxVideoPostDurationSec,
				privacyLevelOptions: storedPrivacyLevelOptions,
			} = await this.accountRepository.getAccountByUserIdAndSocialAccountId(
				userId,
				postTarget.socialAccountId
			)

			const creatorInfo = await this.getPostingCreatorInfo(accessToken, userId, postId)

			if (creatorInfo.canPost === false) {
				throw new BaseAppError(
					'TikTok account cannot publish right now. Please try again later.',
					ErrorCode.RATE_LIMIT_EXCEEDED,
					429
				)
			}

			const maxAllowedVideoDurationSec = creatorInfo.maxVideoPostDurationSec ?? storedMaxVideoPostDurationSec ?? null

			const privacyLevel = this.resolvePrivacyLevel(
				creatorInfo.privacyLevelOptions ?? storedPrivacyLevelOptions ?? null,
				postTarget.tikTokPostPrivacyLevel ?? null
			)

			const description = formatCaptionWithTags(postTarget.text || mainCaption, postTarget.tags, 'tiktok') || ''

			const hasVideo = mediaAssets.some((asset) => asset.type?.startsWith('video'))
			const hasImage = mediaAssets.some((asset) => asset.type?.startsWith('image'))

			if (hasVideo && hasImage) {
				throw new BaseAppError(
					'TikTok does not support mixed media types (video + images)',
					ErrorCode.BAD_REQUEST,
					400
				)
			}

			if (hasVideo && mediaAssets.length > 1) {
				throw new BaseAppError('TikTok only supports one video per post', ErrorCode.BAD_REQUEST, 400)
			}

			let publishId: string

			if (hasVideo) {
				const mediaAsset = mediaAssets[0]
				let mediaBuffer: Buffer

				if (post?.coverImageUrl) {
					try {
						this.logger.info('Processing video with cover image for TikTok', {
							operation: 'sendPostToTikTok',
							userId,
							postId,
							coverImageUrl: post.coverImageUrl,
						})

						const mediaResponse = await this.httpClient.get<ArrayBuffer>(mediaAsset.url, { responseType: 'arraybuffer' })
						const originalVideoBuffer = Buffer.isBuffer(mediaResponse) ? mediaResponse : Buffer.from(mediaResponse)

						const processedVideoBuffer = await this.videoProcessor.processVideoWithCover(
							originalVideoBuffer,
							post.coverImageUrl
						)

						mediaBuffer = processedVideoBuffer
					} catch (error) {
						this.logger.error('Failed to process video with cover image for TikTok, using original', {
							operation: 'sendPostToTikTok',
							userId,
							postId,
							error: {
								name: error instanceof Error ? error.name : 'UnknownError',
								code: error instanceof Error ? error.message : 'Unknown error occurred',
								stack: error instanceof Error ? error.stack : undefined,
							},
						})

						const mediaResponse = await this.httpClient.get<ArrayBuffer>(mediaAsset.url, { responseType: 'arraybuffer' })
						mediaBuffer = Buffer.isBuffer(mediaResponse) ? mediaResponse : Buffer.from(mediaResponse)
					}
				} else {
					const mediaResponse = await this.httpClient.get<ArrayBuffer>(mediaAsset.url, { responseType: 'arraybuffer' })
					mediaBuffer = Buffer.isBuffer(mediaResponse) ? mediaResponse : Buffer.from(mediaResponse)
				}

				if (maxAllowedVideoDurationSec) {
					const videoDurationSeconds = await this.getVideoDurationSeconds(mediaBuffer, userId, postId)

					if (videoDurationSeconds > maxAllowedVideoDurationSec) {
						throw new BaseAppError(
							`TikTok video duration exceeds the allowed limit of ${maxAllowedVideoDurationSec} seconds. Please shorten your video and try again.`,
							ErrorCode.BAD_REQUEST,
							400
						)
					}
				}

				const mediaSize = mediaBuffer.length

				this.logger.debug("PRIVACY LEVEL: ", {privacy_level: privacyLevel	})

				const initResponse = await this.httpClient.post<TikTokVideoInitResponse>(
					`${TIKTOK_API_URL}/${TIKTOK_API_VERSION}/post/publish/video/init/`,
					{
						post_info: {
							privacy_level: privacyLevel,
							title: postTarget.title,
							brand_content_toggle: false,
							brand_organic_toggle: false,
							...(post?.coverImageUrl && {
								video_cover_timestamp_ms: 1,
							}),
							...(post?.coverTimestamp &&
								!post?.coverImageUrl && {
									video_cover_timestamp_ms: Math.floor(Number(post.coverTimestamp) * 1000),
								}),
						},
						source_info: {
							source: TikTokMediaAssestSourceType.FILE_UPLOAD,
							video_size: mediaSize,
							chunk_size: mediaSize,
							total_chunk_count: 1,
						},
					},
					{
						headers: {
							Authorization: `Bearer ${accessToken}`,
							'Content-Type': 'application/json',
						},
					}
				)

				publishId = initResponse.data.publish_id
				const uploadUrl = initResponse.data.upload_url

				await this.httpClient.put(uploadUrl, mediaBuffer, {
					headers: {
						'Content-Type': mediaAsset.type,
						'Content-Length': mediaSize.toString(),
						'Content-Range': `bytes 0-${mediaSize - 1}/${mediaSize}`,
					},
				})
			} else {
				if (mediaAssets.length > 35) {
					throw new BaseAppError('TikTok supports maximum 35 images in a slideshow', ErrorCode.BAD_REQUEST, 400)
				}

				const hasVideoInImages = mediaAssets.some((asset) => asset.type?.startsWith('video'))

				if (hasVideoInImages) {
					throw new BaseAppError(
						'TikTok slideshow only supports images, not videos',
						ErrorCode.BAD_REQUEST,
						400
					)
				}

				const photoUrls: string[] = []
				const temporaryUploads: string[] = []

				try {
					for (const [index, asset] of mediaAssets.entries()) {
						const { url: resizedUrl, isTemporary } = await this.getOrCreateResizedImage(
							asset.url,
							userId,
							postId,
							index
						)

						if (isTemporary) {
							temporaryUploads.push(resizedUrl)
						}

						this.logger.info('Using image for TikTok', {
							operation: 'sendPostToTikTok',
							userId,
							postId,
							assetIndex: index + 1,
							originalUrl: asset.url,
							resizedUrl,
						})

						photoUrls.push(resizedUrl)
					}

					const initResponse = await this.httpClient.post<TikTokPhotoInitResponse>(
						'https://open.tiktokapis.com/v2/post/publish/content/init/',
						{
							media_type: 'PHOTO',
							post_mode: TikTokPostMode.DIRECT_POST,
							post_info: {
								title: postTarget.title,
								description,
								auto_add_music: postTarget.isAutoMusicEnabled,
								privacy_level: privacyLevel,
								brand_content_toggle: false,
								brand_organic_toggle: false,
							},
							source_info: {
								source: TikTokMediaAssestSourceType.PULL_FROM_URL,
								photo_cover_index: 0,
								photo_images: photoUrls,
							},
						},
						{
							headers: {
								Authorization: `Bearer ${accessToken}`,
								'Content-Type': 'application/json',
							},
						}
					)

					publishId = initResponse.data.publish_id
				} finally {
					await this.cleanupTemporaryUploads(temporaryUploads)
				}
			}

			await new Promise((resolve) => setTimeout(resolve, 3000))

			const statusResponse = await this.httpClient.post<TikTokStatusResponse>(
				`${TIKTOK_API_URL}/${TIKTOK_API_VERSION}/post/publish/status/fetch/`,
				{
					publish_id: publishId,
				},
				{
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'Content-Type': 'application/json',
					},
				}
			)

			const uploadStatus = statusResponse.data?.status

			if (uploadStatus === 'FAILED') {
				const failureDetail = statusResponse.data?.fail_reason || 'Unknown failure reason'

				this.logger.error('TikTok media upload failed', {
					operation: 'sendPostToTikTok',
					userId,
					postId,
					publishId,
					mediaType: hasVideo ? 'video' : 'photo',
					mediaCount: mediaAssets.length,
					status: uploadStatus,
					failureReason: failureDetail,
				})

				await this.postRepository.updatePostTarget(
					userId,
					postId,
					postTarget.socialAccountId,
					PostStatus.FAILED,
					failureDetail
				)

				throw new BaseAppError(
					`TikTok ${hasVideo ? 'video' : 'photo'} upload failed: ${failureDetail}`,
					ErrorCode.BAD_REQUEST,
					400
				)
			}

			await this.postRepository.updatePostTarget(userId, postId, postTarget.socialAccountId, PostStatus.DONE)

			this.logger.info('TikTok media upload initiated successfully', {
				operation: 'sendPostToTikTok',
				userId,
				postId,
				publishId,
				mediaType: hasVideo ? 'video' : 'photo',
				mediaCount: mediaAssets.length,
				status: uploadStatus,
			})
		} catch (error: unknown) {
			const errorResult = await this.socialMediaErrorHandler.handleSocialMediaError(
				error,
				'tiktok',
				userId,
				postId,
				postTarget.socialAccountId
			)

			throw errorResult.error
		}
	}
}
