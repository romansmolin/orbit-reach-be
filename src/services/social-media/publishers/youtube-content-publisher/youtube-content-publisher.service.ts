import { IYouTubeContentPublisherService } from "./youtube-content-publisher.interface";
import { ILogger } from "@/shared/infra/logger";
import { IAccountRepository } from "@/repositories/account-repository";
import { IPostsRepository } from "@/repositories/posts-repository";
import { IApiClient } from "@/shared/infra/api";
import { SocialMediaErrorHandler } from "@/shared/infra/social-media-errors";
import { BaseAppError } from "@/shared/errors/base-error";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import { PostStatus, PostTargetResponse } from "@/types/posts.types";

type YouTubeInitResponse = {
	headers: {
		location?: string
	}
}

type YouTubeUploadResponse = {
	data?: { id?: string }
}

export class YouTubeContentPublisherService implements IYouTubeContentPublisherService {
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

	async sendPostToYouTube(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		mainCaption?: string
	): Promise<void> {
		try {
			const mediaAsset = await this.postRepository.getPostMediaAsset(postId)

			if (!mediaAsset?.url || !mediaAsset.type?.startsWith('video')) {
				throw new BaseAppError('YouTube posts require video content', ErrorCode.BAD_REQUEST, 400)
			}

			const { accessToken } = await this.accountRepository.getAccountByUserIdAndSocialAccountId(
				userId,
				postTarget.socialAccountId
			)

			const title = postTarget.title || 'Video Upload'
			const description = postTarget.text || mainCaption || ''

			const initResponse = await this.httpClient.post<YouTubeInitResponse>(
				'https://www.googleapis.com/upload/youtube/v3/videos',
				{
					snippet: {
						title,
						description,
						categoryId: '22',
					},
					status: {
						privacyStatus: 'public',
					},
				},
				{
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'Content-Type': 'application/json',
						'X-Upload-Content-Type': mediaAsset.type,
						'X-Upload-Content-Length': '0',
					},
					params: {
						part: 'snippet,status',
						uploadType: 'resumable',
					},
				}
			)

			const uploadUrl = initResponse.headers.location

			if (!uploadUrl) {
				throw new BaseAppError('Failed to initialize YouTube upload', ErrorCode.UNKNOWN_ERROR, 500)
			}

			const videoResponse = await this.httpClient.get<NodeJS.ReadableStream | Buffer>(mediaAsset.url, {
				responseType: 'stream',
			})

			const uploadResponse = await this.httpClient.put<YouTubeUploadResponse>(uploadUrl, videoResponse as any, {
				headers: {
					'Content-Type': mediaAsset.type,
				},
			})

			await this.postRepository.updatePostTarget(userId, postId, postTarget.socialAccountId, PostStatus.DONE)

			this.logger.info('YouTube video uploaded successfully', {
				operation: 'sendPostToYouTube',
				userId,
				postId,
				videoId: uploadResponse.data?.id,
			})
		} catch (error: unknown) {
			const errorResult = await this.socialMediaErrorHandler.handleSocialMediaError(
				error,
				'youtube',
				userId,
				postId,
				postTarget.socialAccountId
			)

			throw errorResult.error
		}
	}
}
