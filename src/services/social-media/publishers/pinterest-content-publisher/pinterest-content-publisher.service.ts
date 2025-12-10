import { IPinterestContentPublisherService } from "./pinterest-content-publisher.interface";
import { ILogger } from "@/shared/infra/logger";
import { IAccountRepository } from "@/repositories/account-repository";
import { IPostsRepository } from "@/repositories/posts-repository";
import { IApiClient } from "@/shared/infra/api";
import { SocialMediaErrorHandler } from "@/shared/infra/social-media-errors";
import { BaseAppError } from "@/shared/errors/base-error";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import { PostStatus, PostTargetResponse } from "@/types/posts.types";
import FormData from "form-data";

export class PinterestContentPublisherService implements IPinterestContentPublisherService {
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

	async sendPostToPinterest(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		pinterestBoardId: string | null,
		mainCaption?: string
	): Promise<void> {
		try {
			const { PINTEREST_API_URL, PINTEREST_API_VERSION } = process.env

			if (!PINTEREST_API_URL || !PINTEREST_API_VERSION) {
				throw new BaseAppError(
					'Lack of required environment variables for Pinteres',
					ErrorCode.BAD_REQUEST,
					400
				)
			}

			const { accessToken } = await this.accountRepository.getAccountByUserIdAndSocialAccountId(
				userId,
				postTarget.socialAccountId
			)

			const mediaAsset = await this.postRepository.getPostMediaAsset(postId)

			if (!mediaAsset?.url)
				throw new BaseAppError('Media asset not found for Pinterest post', ErrorCode.BAD_REQUEST, 400)

			if (!pinterestBoardId) throw new BaseAppError('Pinterest board ID is required', ErrorCode.BAD_REQUEST, 400)

			const isVideo = mediaAsset.type?.startsWith('video')
			const isImage = mediaAsset.type?.startsWith('image')

			if (!isVideo && !isImage) {
				throw new BaseAppError('Unsupported media type for Pinterest', ErrorCode.BAD_REQUEST, 400)
			}

			let mediaSource: Record<string, unknown>

			if (isVideo) {
				this.logger.debug('Processing video for Pinterest', {
					operation: 'sendPostToPinterest',
					userId,
					postId,
					mediaType: 'video',
				})

				const registerResponse = await this.httpClient.post<{
					media_id: string
					upload_url: string
					upload_parameters: Record<string, string>
				}>(
					`${PINTEREST_API_URL}/${PINTEREST_API_VERSION}/media`,
					{ media_type: 'video' },
					{
						headers: {
							Authorization: `Bearer ${accessToken}`,
							'Content-Type': 'application/json',
						},
					}
				)

				const { media_id, upload_url, upload_parameters } = registerResponse

				this.logger.debug('Media upload registered', {
					operation: 'sendPostToPinterest',
					mediaId: media_id,
				})

				const videoResponse = await this.httpClient.get<NodeJS.ReadableStream | Buffer>(mediaAsset.url, {
					responseType: 'stream',
				})

				const uploadForm = new FormData()

				Object.entries(upload_parameters).forEach(([key, value]) => {
					uploadForm.append(key, value)
				})

				uploadForm.append('file', videoResponse as any)

				await this.httpClient.post(upload_url, uploadForm, {
					headers: {
						...uploadForm.getHeaders(),
					},
				})

				this.logger.debug('Video uploaded to Pinterest', {
					operation: 'sendPostToPinterest',
					mediaId: media_id,
				})

				mediaSource = {
					source_type: 'video_id',
					video_id: media_id,
				}
			} else {
				mediaSource = {
					source_type: 'image_url',
					url: mediaAsset.url,
				}
			}

			const pinData = {
				board_id: pinterestBoardId,
				media_source: mediaSource,
				...(postTarget.text || mainCaption ? { description: postTarget.text || mainCaption } : {}),
				...(postTarget.title ? { title: postTarget.title } : {}),
			}

			const response = await this.httpClient.post<{ id: string }>(
				`${PINTEREST_API_URL}/${PINTEREST_API_VERSION}/pins`,
				pinData,
				{
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'Content-Type': 'application/json',
					},
				}
			)

			await this.postRepository.updatePostTarget(userId, postId, postTarget.socialAccountId, PostStatus.DONE)

			this.logger.info('Pinterest pin created successfully', {
				operation: 'sendPostToPinterest',
				userId,
				postId,
				pinterestBoardId,
				mediaType: isVideo ? 'video' : 'image',
				pinId: response.id,
			})
		} catch (error: unknown) {
			const errorResult = await this.socialMediaErrorHandler.handleSocialMediaError(
				error,
				'pinterest',
				userId,
				postId,
				postTarget.socialAccountId
			)

			throw errorResult.error
		}
	}
}
