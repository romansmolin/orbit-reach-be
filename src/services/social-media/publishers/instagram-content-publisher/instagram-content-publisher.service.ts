import { IInstagramContentPublisherService } from "./instagram-content-publisher.interface";
import { ILogger } from "@/shared/infra/logger";
import { IAccountRepository } from "@/repositories/account-repository";
import { IPostsRepository } from "@/repositories/posts-repository";
import { IVideoProcessor } from "@/shared/infra/video-processor/video-processor.interface";
import { SocialMediaErrorHandler } from "@/shared/infra/social-media-errors";
import { IMediaUploader } from "@/shared/infra/media";
import { IApiClient } from "@/shared/infra/api";
import { BaseAppError } from "@/shared/errors/base-error";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import { formatCaptionWithTags } from "../../utils/format-captions-with-tags";
import {
	PostTargetResponse,
	CreatePostResponse,
	IPost,
	InstagramMediaType,
	PostStatus,
	InstagramPostStatus,
} from "@/types/posts.types";
import axios from "axios";

export class InstagramContentPublisherService implements IInstagramContentPublisherService {
	private logger: ILogger
	private accountRepository: IAccountRepository
	private postRepository: IPostsRepository
	private videoProcessor: IVideoProcessor
	private socialMediaErrorHandler: SocialMediaErrorHandler
	private mediaUploader: IMediaUploader
	private httpClient: IApiClient

	private readonly IG_POLL_INTERVAL_MS = 5000

	constructor(
		logger: ILogger,
		accountRepository: IAccountRepository,
		postRepository: IPostsRepository,
		videoProcessor: IVideoProcessor,
		socialMediaErrorHandler: SocialMediaErrorHandler,
		mediaUploader: IMediaUploader,
		httpClient: IApiClient
	) {
		this.logger = logger
		this.accountRepository = accountRepository
		this.postRepository = postRepository
		this.videoProcessor = videoProcessor
		this.socialMediaErrorHandler = socialMediaErrorHandler
		this.mediaUploader = mediaUploader
		this.httpClient = httpClient
	}

	private async waitForInstagramContainerReady(
		containerId: string,
		accessToken: string
	): Promise<InstagramPostStatus> {
		let pollCount = 0
		const maxPolls = 60

		while (true) {
			pollCount++

			try {
				const response = await this.httpClient.get<{ status_code: string; id?: string }>(
					`https://graph.instagram.com/v23.0/${containerId}`,
					{
						params: {
							access_token: accessToken,
							fields: 'status_code,id',
						},
					}
				)

				const status = response.status_code as InstagramPostStatus

				switch (status) {
					case InstagramPostStatus.IN_PROGRESS:
						if (pollCount >= maxPolls) {
							throw new BaseAppError(
								`Instagram container ${containerId} still in progress after ${maxPolls} polls (${(maxPolls * this.IG_POLL_INTERVAL_MS) / 1000} seconds)`,
								ErrorCode.UNKNOWN_ERROR,
								500
							)
						}
						await new Promise((resolve) => setTimeout(resolve, this.IG_POLL_INTERVAL_MS))
						continue

					case InstagramPostStatus.FINISHED:
						this.logger.info('Instagram container finished processing', {
							operation: 'waitForInstagramContainerReady',
							containerId,
							pollCount,
						})
						return status

					case InstagramPostStatus.PUBLISHED:
						this.logger.info('Instagram container already published', {
							operation: 'waitForInstagramContainerReady',
							containerId,
							pollCount,
						})
						return status

					case InstagramPostStatus.ERROR:
						this.logger.error('Instagram container failed with ERROR status', {
							operation: 'waitForInstagramContainerReady',
							containerId,
							processingTimeSeconds: pollCount * 5,
						})

						throw new BaseAppError(
							`Instagram container ${containerId} failed (ERROR)`,
							ErrorCode.UNKNOWN_ERROR,
							500
						)

					case InstagramPostStatus.EXPIRED:
						this.logger.error('Instagram container expired', {
							operation: 'waitForInstagramContainerReady',
							containerId,
							pollCount,
							status,
						})
						throw new BaseAppError(
							`Instagram container ${containerId} expired before publish`,
							ErrorCode.UNKNOWN_ERROR,
							500
						)

					default:
						this.logger.error('Unknown Instagram container status', {
							operation: 'waitForInstagramContainerReady',
							containerId,
							pollCount,
							status,
							responseData: response,
						})
						throw new BaseAppError(
							`Unknown Instagram container status "${status}" for container ${containerId}`,
							ErrorCode.UNKNOWN_ERROR,
							500
						)
				}
			} catch (error) {
				this.logger.error('Error polling Instagram container status', {
					operation: 'waitForInstagramContainerReady',
					containerId,
					error: {
						name: error instanceof Error ? error.name : 'UnknownError',
						code: error instanceof Error ? error.message : 'Unknown error',
						stack: error instanceof Error ? error.stack : undefined,
					},
				})
				throw error
			}
		}
	}

	private async resolveInstagramLocationIdFromFacebookPage(
		userId: string,
		facebookPageReference?: string
	): Promise<string | undefined> {
		if (!facebookPageReference) {
			return undefined
		}

		let resolvedPageId = facebookPageReference
		let facebookAccount = await this.accountRepository.findByTenantPlatformAndPage(userId, 'facebook', facebookPageReference)

		if (!facebookAccount) {
			const accountById = await this.accountRepository.getAccountById(userId, facebookPageReference)
			if (accountById && accountById.platform === 'facebook') {
				facebookAccount = accountById
				resolvedPageId = accountById.pageId
			}
		}

		if (!facebookAccount) {
			throw new BaseAppError(
				'Selected Facebook Page must be connected before enabling Instagram location tagging',
				ErrorCode.BAD_REQUEST,
				400
			)
		}

		try {
			const response = await this.httpClient.get<{ location?: unknown }>(
				`https://graph.facebook.com/v19.0/${resolvedPageId}`,
				{
					params: {
						fields: 'location',
						access_token: facebookAccount.accessToken,
					},
				}
			)

			if (!response?.location) {
				throw new BaseAppError(
					'Selected Facebook Page does not contain location information required by Instagram',
					ErrorCode.BAD_REQUEST,
					400
				)
			}

			return resolvedPageId
		} catch (error) {
			if (error instanceof BaseAppError) {
				throw error
			}

			this.logger.error('Failed to fetch location data from Facebook Page', {
				operation: 'resolveInstagramLocationIdFromFacebookPage',
				userId,
				facebookPageReference,
				resolvedPageId,
				error: {
					name: error instanceof Error ? error.name : 'UnknownError',
					code: error instanceof Error ? error.message : 'Unknown error',
					stack: error instanceof Error ? error.stack : undefined,
				},
				response: axios.isAxiosError(error) ? error.response?.data : undefined,
				status: axios.isAxiosError(error) ? error.response?.status : undefined,
			})

			throw new BaseAppError(
				'Unable to retrieve Facebook Page location information',
				ErrorCode.UNKNOWN_ERROR,
				500
			)
		}
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

	async sendPostToInstagram(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		mainCaption?: string,
		post?: CreatePostResponse
	): Promise<IPost | null> {
		const temporaryUploads: string[] = []
		try {
			const { accessToken, pageId } = await this.accountRepository.getAccountByUserIdAndSocialAccountId(
				userId,
				postTarget.socialAccountId
			)

			const mediaAssets = await this.postRepository.getPostMediaAssets(postId)
			const normalizedLegacyLocationId = postTarget.instagramLocationId?.trim()
			const legacyLocationId =
				normalizedLegacyLocationId && normalizedLegacyLocationId.length > 0
					? normalizedLegacyLocationId
					: undefined
			const normalizedFacebookPageId = postTarget.instagramFacebookPageId?.trim()
			const facebookPageId =
				normalizedFacebookPageId && normalizedFacebookPageId.length > 0
					? normalizedFacebookPageId
					: undefined

			if (mediaAssets.length === 0) {
				throw new BaseAppError('No media assets found for Instagram post', ErrorCode.BAD_REQUEST, 400)
			}

			const hasVideo = mediaAssets.some((asset) => asset.type?.startsWith('video'))
			const hasImage = mediaAssets.some((asset) => asset.type?.startsWith('image'))

			if (hasVideo && hasImage) {
				throw new BaseAppError(
					'Instagram does not support mixed media types (video + images)',
					ErrorCode.BAD_REQUEST,
					400
				)
			}

			if (hasVideo && mediaAssets.length > 1) {
				throw new BaseAppError('Instagram only supports one video per post', ErrorCode.BAD_REQUEST, 400)
			}

			if ((facebookPageId || legacyLocationId) && mediaAssets.length > 1) {
				throw new BaseAppError(
					'Instagram location tagging is not supported for carousel posts',
					ErrorCode.BAD_REQUEST,
					400
				)
			}

			const resolvedLocationId = await this.resolveInstagramLocationIdFromFacebookPage(userId, facebookPageId)
			const locationId = resolvedLocationId ?? legacyLocationId

			let creationId: string

			if (mediaAssets.length === 1) {
				const mediaAsset = mediaAssets[0]
				const mediaType = mediaAsset.type?.startsWith('image')
					? InstagramMediaType.IMAGE
					: mediaAsset.type?.startsWith('video')
						? InstagramMediaType.REELS
						: null

				if (!mediaType) {
					throw new BaseAppError('Unsupported media type for Instagram', ErrorCode.BAD_REQUEST, 400)
				}

				let processedVideoUrl = mediaAsset.url
				if (mediaType === InstagramMediaType.REELS) {
					try {
						const videoResponse = await this.httpClient.get<ArrayBuffer>(mediaAsset.url, { responseType: 'arraybuffer' })
						const videoBuffer = Buffer.isBuffer(videoResponse) ? videoResponse : Buffer.from(videoResponse)

						const processedVideoBuffer = await this.videoProcessor.processVideoForPlatform(
							videoBuffer,
							'instagram'
						)

						const uploadedVideoUrl = await this.mediaUploader.upload({
							key: `${userId}/processed/instagram/${postId}-${Date.now()}.mp4`,
							body: processedVideoBuffer,
							contentType: 'video/mp4',
						})
						temporaryUploads.push(uploadedVideoUrl)

						this.logger.info('Instagram video processed successfully', {
							operation: 'sendPostToInstagram',
							originalSize: videoBuffer.length,
							processedSize: processedVideoBuffer.length,
						})

						processedVideoUrl = uploadedVideoUrl
					} catch (error) {
						this.logger.warn('Failed to process video for Instagram, using original', {
							operation: 'sendPostToInstagram',
							error: {
								name: error instanceof Error ? error.name : 'UnknownError',
								code: error instanceof Error ? error.message : 'Unknown error',
								stack: error instanceof Error ? error.stack : undefined,
							},
							videoUrl: mediaAsset.url,
						})
					}
				}

				const formattedCaption = formatCaptionWithTags(
					postTarget.text || mainCaption,
					postTarget.tags,
					'instagram'
				)

				const requestParams = {
					access_token: accessToken,
					caption: formattedCaption,
					...(mediaType === InstagramMediaType.REELS ? { media_type: mediaType } : {}),
					...(mediaType === InstagramMediaType.IMAGE ? { image_url: mediaAsset.url } : {}),
					...(mediaType === InstagramMediaType.REELS ? { video_url: processedVideoUrl } : {}),
					...(mediaType === InstagramMediaType.REELS && post?.coverImageUrl
						? { cover_url: post.coverImageUrl }
						: {}),
					...(mediaType === InstagramMediaType.REELS && typeof post?.coverTimestamp === 'number'
						? { thumb_offset: post.coverTimestamp * 1000 }
						: {}),
					...(locationId ? { location_id: locationId } : {}),
				}

				try {
					const headResponse = await axios.head(processedVideoUrl, { timeout: 10000 })
					const contentLength = parseInt(headResponse.headers['content-length'] || '0')
					const fileSizeMB = contentLength / (1024 * 1024)

					this.logger.info('Processed video URL validation successful', {
						operation: 'sendPostToInstagram',
						fileSizeMB: fileSizeMB.toFixed(2),
						contentType: headResponse.headers['content-type'],
					})
				} catch (validationError) {
					this.logger.warn('Processed video URL validation failed', {
						operation: 'sendPostToInstagram',
						error: {
							name: validationError instanceof Error ? validationError.name : 'UnknownError',
							code: validationError instanceof Error ? validationError.message : 'Unknown error',
							stack: validationError instanceof Error ? validationError.stack : undefined,
						},
					})
				}

				this.logger.info('Creating Instagram media container', {
					operation: 'sendPostToInstagram',
					mediaType,
				})

				let response
				try {
					response = await this.httpClient.post<{ id: string }>(
						`https://graph.instagram.com/v23.0/${pageId}/media`,
						null,
						{
							headers: {
								'Content-Type': 'application/json',
								Authorization: `Bearer ${accessToken}`,
							},
							params: requestParams,
						}
					)
				} catch (error) {
					this.logger.error('Failed to create Instagram media container', {
						operation: 'sendPostToInstagram',
						pageId,
						requestParams,
						error: {
							name: error instanceof Error ? error.name : 'UnknownError',
							code: error instanceof Error ? error.message : 'Unknown error',
							stack: error instanceof Error ? error.stack : undefined,
						},
						response: axios.isAxiosError(error) ? error.response?.data : undefined,
						status: axios.isAxiosError(error) ? error.response?.status : undefined,
						statusText: axios.isAxiosError(error) ? error.response?.statusText : undefined,
						fullErrorResponse: axios.isAxiosError(error) ? (error.response?.data as any)?.error : undefined,
					})
					throw error
				}

				creationId = response.id

				this.logger.info('Instagram media container created successfully', {
					operation: 'sendPostToInstagram',
					creationId,
				})
			} else {
				if (mediaAssets.length > 10) {
					throw new BaseAppError('Instagram carousel supports maximum 10 images', ErrorCode.BAD_REQUEST, 400)
				}

				const mediaContainerIds: string[] = []

				for (const mediaAsset of mediaAssets) {
					const response = await this.httpClient.post<{ id: string }>(
						`https://graph.instagram.com/v23.0/${pageId}/media`,
						null,
						{
							headers: {
								'Content-Type': 'application/json',
								Authorization: `Bearer ${accessToken}`,
							},
							params: {
								access_token: accessToken,
								image_url: mediaAsset.url,
								is_carousel_item: true,
							},
						}
					)

					mediaContainerIds.push(response.id)
				}

				await Promise.all(
					mediaContainerIds.map((containerId) =>
						this.waitForInstagramContainerReady(containerId, accessToken)
					)
				)

				const carouselResponse = await this.httpClient.post<{ id: string }>(
					`https://graph.instagram.com/v23.0/${pageId}/media`,
					null,
					{
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${accessToken}`,
						},
						params: {
							access_token: accessToken,
							caption: formatCaptionWithTags(
								postTarget.text || mainCaption,
								postTarget.tags,
								'instagram'
							),
							media_type: 'CAROUSEL',
							children: mediaContainerIds.join(','),
						},
					}
				)

				creationId = carouselResponse.id
			}

			this.logger.info('Waiting for Instagram container to be ready', {
				operation: 'sendPostToInstagram',
				creationId,
			})

			await this.waitForInstagramContainerReady(creationId, accessToken)

			this.logger.info('Instagram container is ready, publishing post', {
				operation: 'sendPostToInstagram',
				creationId,
				pageId,
			})

			const publishParams = {
				creation_id: creationId,
			}

			this.logger.info('Publishing Instagram post', {
				operation: 'sendPostToInstagram',
				pageId,
				publishParams,
			})

			let postRes
			try {
				postRes = await this.httpClient.post<{ id: string }>(
					`https://graph.instagram.com/v23.0/${pageId}/media_publish`,
					null,
					{
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${accessToken}`,
						},
						params: publishParams,
					}
				)
			} catch (error) {
				this.logger.error('Failed to publish Instagram post', {
					operation: 'sendPostToInstagram',
					pageId,
					publishParams,
					error: {
						name: error instanceof Error ? error.name : 'UnknownError',
						code: error instanceof Error ? error.message : 'Unknown error',
						stack: error instanceof Error ? error.stack : undefined,
					},
					response: axios.isAxiosError(error) ? error.response?.data : undefined,
					status: axios.isAxiosError(error) ? error.response?.status : undefined,
					statusText: axios.isAxiosError(error) ? error.response?.statusText : undefined,
				})
				throw error
			}

			this.logger.info('Instagram publish API response', {
				operation: 'sendPostToInstagram',
				responseData: postRes,
			})

			await this.postRepository.updatePostTarget(userId, postId, postTarget.socialAccountId, PostStatus.DONE)

			this.logger.info('Instagram post published successfully', {
				operation: 'sendPostToInstagram',
				userId,
				postId,
				instagramPostId: postRes.id,
				mediaCount: mediaAssets.length,
				mediaType: mediaAssets.length > 1 ? 'carousel' : hasVideo ? 'video' : 'image',
			})

			return await this.postRepository.getPostDetails(postId, userId)
		} catch (error: unknown) {
			const errorResult = await this.socialMediaErrorHandler.handleSocialMediaError(
				error,
				'instagram',
				userId,
				postId,
				postTarget.socialAccountId
			)

			throw errorResult.error
		} finally {
			await this.cleanupTemporaryUploads(temporaryUploads)
		}
	}
}
