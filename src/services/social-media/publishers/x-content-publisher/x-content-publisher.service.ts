import { IXContentPublisherService } from "./x-content-publisher.interface";
import { ILogger } from "@/shared/infra/logger";
import { IAccountRepository } from "@/repositories/account-repository";
import { IPostsRepository } from "@/repositories/posts-repository";
import { IApiClient } from "@/shared/infra/api";
import { SocialMediaErrorHandler } from "@/shared/infra/social-media-errors";
import { BaseAppError } from "@/shared/errors/base-error";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import { PostStatus, PostTargetResponse } from "@/types/posts.types";
import { formatCaptionWithTags } from "../../utils/format-captions-with-tags";
import FormData from "form-data";

type MediaUploadResponse = { media_id_string: string }
type TweetResponse = { data: { id: string } }

export class XContentPublisherService implements IXContentPublisherService {
	private logger: ILogger
	private accountRepository: IAccountRepository
	private postRepository: IPostsRepository
	private httpClient: IApiClient
	private socialMediaErrorHandler: SocialMediaErrorHandler

	constructor(
		logger: ILogger,
		accountRepository: IAccountRepository,
		postRepository: IPostsRepository,
		httpClient: IApiClient,
		socialMediaErrorHandler: SocialMediaErrorHandler
	) {
		this.logger = logger
		this.accountRepository = accountRepository
		this.postRepository = postRepository
		this.httpClient = httpClient
		this.socialMediaErrorHandler = socialMediaErrorHandler
	}

	async sendPostToX(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		mainCaption?: string
	): Promise<void> {
		try {
			const { accessToken } = await this.accountRepository.getAccountByUserIdAndSocialAccountId(
				userId,
				postTarget.socialAccountId
			)

			const mediaAssets = await this.postRepository.getPostMediaAssets(postId)
			const text = formatCaptionWithTags(postTarget.text || mainCaption || '', postTarget.tags, 'x')

			const payload: Record<string, unknown> = { text }

			if (mediaAssets.length > 0) {
				if (mediaAssets.length > 4) {
					throw new BaseAppError(
						'X (Twitter) supports maximum 4 media files per tweet',
						ErrorCode.BAD_REQUEST,
						400
					)
				}

				const hasVideo = mediaAssets.some((asset) => asset.type?.startsWith('video'))
				const hasImage = mediaAssets.some((asset) => asset.type?.startsWith('image'))

				if (hasVideo && hasImage) {
					throw new BaseAppError(
						'X (Twitter) does not support mixed media types (video + images)',
						ErrorCode.BAD_REQUEST,
						400
					)
				}

				if (hasVideo && mediaAssets.length > 1) {
					throw new BaseAppError('X (Twitter) only supports one video per tweet', ErrorCode.BAD_REQUEST, 400)
				}

				const mediaIds: string[] = []

				for (const mediaAsset of mediaAssets) {
					const mediaResponse = await this.httpClient.get<ArrayBuffer>(mediaAsset.url, { responseType: 'arraybuffer' })
					const mediaBuffer = Buffer.isBuffer(mediaResponse) ? mediaResponse : Buffer.from(mediaResponse)

					if (mediaAsset.type?.startsWith('image')) {
						const formData = new FormData()
						formData.append('media', mediaBuffer, {
							filename: 'image.jpg',
							contentType: mediaAsset.type,
						})

						const uploadResponse = await this.httpClient.post<MediaUploadResponse>(
							'https://upload.twitter.com/1.1/media/upload.json',
							formData,
							{
								headers: {
									Authorization: `Bearer ${accessToken}`,
									...formData.getHeaders(),
								},
							}
						)

						mediaIds.push(uploadResponse.media_id_string)
					} else if (mediaAsset.type?.startsWith('video')) {
						const totalBytes = mediaBuffer.length

						const initFormData = new FormData()
						initFormData.append('command', 'INIT')
						initFormData.append('media_type', mediaAsset.type)
						initFormData.append('total_bytes', totalBytes.toString())
						initFormData.append('media_category', 'tweet_video')

						const initResponse = await this.httpClient.post<MediaUploadResponse>(
							'https://upload.twitter.com/1.1/media/upload.json',
							initFormData,
							{
								headers: {
									Authorization: `Bearer ${accessToken}`,
									...initFormData.getHeaders(),
								},
							}
						)

						const mediaId = initResponse.media_id_string

						const appendFormData = new FormData()
						appendFormData.append('command', 'APPEND')
						appendFormData.append('media_id', mediaId)
						appendFormData.append('segment_index', '0')
						appendFormData.append('media', mediaBuffer, {
							filename: 'video.mp4',
							contentType: mediaAsset.type,
						})

						await this.httpClient.post(
							'https://upload.twitter.com/1.1/media/upload.json',
							appendFormData,
							{
								headers: {
									Authorization: `Bearer ${accessToken}`,
									...appendFormData.getHeaders(),
								},
							}
						)

						const finalizeFormData = new FormData()
						finalizeFormData.append('command', 'FINALIZE')
						finalizeFormData.append('media_id', mediaId)

						await this.httpClient.post(
							'https://upload.twitter.com/1.1/media/upload.json',
							finalizeFormData,
							{
								headers: {
									Authorization: `Bearer ${accessToken}`,
									...finalizeFormData.getHeaders(),
								},
							}
						)

						mediaIds.push(mediaId)
					}
				}

				if (mediaIds.length > 0) {
					payload.media = {
						media_ids: mediaIds,
					}
				}
			}

			const response = await this.httpClient.post<TweetResponse>('https://api.x.com/2/tweets', payload, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
				},
			})

			await this.postRepository.updatePostTarget(userId, postId, postTarget.socialAccountId, PostStatus.DONE)

			this.logger.info('X post created successfully', {
				operation: 'sendPostToX',
				userId,
				postId,
				tweetId: response.data.id,
				mediaCount: mediaAssets.length,
			})
		} catch (error: unknown) {
			const errorResult = await this.socialMediaErrorHandler.handleSocialMediaError(
				error,
				'x',
				userId,
				postId,
				postTarget.socialAccountId
			)

			throw errorResult.error
		}
	}
}
