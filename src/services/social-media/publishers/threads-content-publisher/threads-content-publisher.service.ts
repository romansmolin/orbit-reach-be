import { IThreadsContentPublisherService } from "./threads-content-publisher.interface";
import { ILogger } from "@/shared/infra/logger";
import { IAccountRepository } from "@/repositories/account-repository";
import { IPostsRepository } from "@/repositories/posts-repository";
import { IApiClient } from "@/shared/infra/api";
import { SocialMediaErrorHandler } from "@/shared/infra/social-media-errors";
import { BaseAppError } from "@/shared/errors/base-error";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import {
	ThreadsMediaType,
	ThreadsPostStatus,
	PostTargetResponse,
	CreatePostResponse,
	IPost,
	PostStatus,
} from "@/types/posts.types";

export class ThreadsContentPublisherService implements IThreadsContentPublisherService {
	private logger: ILogger
	private accountRepository: IAccountRepository
	private postRepository: IPostsRepository
	private httpClient: IApiClient
	private socialMediaErrorHandler: SocialMediaErrorHandler

	private readonly THREADS_POLL_INTERVAL_MS = 5000

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

	private async waitForThreadsContainerReady(
		mediaContainerId: string,
		accessToken: string
	): Promise<ThreadsPostStatus> {
		while (true) {
			const response = await this.httpClient.get<{ status: ThreadsPostStatus }>(
				`https://graph.threads.net/v1.0/${mediaContainerId}`,
				{ params: { access_token: accessToken } }
			)
			const status = response.status

			this.logger.debug('Polled media container status', { status })

			switch (status) {
				case ThreadsPostStatus.IN_PROGRESS:
					await new Promise((resolve) => setTimeout(resolve, this.THREADS_POLL_INTERVAL_MS))
					continue
				case ThreadsPostStatus.FINISHED:
				case ThreadsPostStatus.PUBLISHED:
					return status
				case ThreadsPostStatus.ERROR:
					throw new BaseAppError(
						`Media container ${mediaContainerId} failed (ERROR)`,
						ErrorCode.UNKNOWN_ERROR,
						500
					)
				case ThreadsPostStatus.EXPIRED:
					throw new BaseAppError(
						`Media container ${mediaContainerId} expired before publish`,
						ErrorCode.UNKNOWN_ERROR,
						500
					)
				default:
					throw new BaseAppError(
						`Unknown status "${status}" for container ${mediaContainerId}`,
						ErrorCode.UNKNOWN_ERROR,
						500
					)
			}
		}
	}

	private async publishReplies(
		replies: string[],
		maxCount: number,
		pageId: string,
		accessToken: string,
		initialThreadId: string
	): Promise<void> {
		let lastThreadId = initialThreadId

		this.logger.debug("REPLIES: ", {
			replies
		})

		for (const replyText of replies.slice(0, maxCount)) {
			const replyCreation = await this.httpClient.post<{ id: string }>(
				`https://graph.threads.net/v1.0/${pageId}/threads`,
				{},
				{
					params: {
						access_token: accessToken,
						media_type: ThreadsMediaType.TEXT,
						text: replyText,
						reply_to_id: lastThreadId,
					},
				}
			)

			await this.waitForThreadsContainerReady(replyCreation.id, accessToken)

			const replyPublish = await this.httpClient.post<{ id: string }>(
				`https://graph.threads.net/v1.0/${pageId}/threads_publish`,
				null,
				{
					params: {
						access_token: accessToken,
						creation_id: replyCreation.id,
					},
				}
			)

			lastThreadId = replyPublish.id || lastThreadId
		}
	}

	async sendPostToThreads(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		mainCaption?: string,
		post?: CreatePostResponse
	): Promise<IPost | null> {
		try {
			const { accessToken, pageId } = await this.accountRepository.getAccountByUserIdAndSocialAccountId(
				userId,
				postTarget.socialAccountId
			)

			const mediaAssets = await this.postRepository.getPostMediaAssets(postId)

			let creationId: string

			if (mediaAssets.length === 0) {
				const response = await this.httpClient.post<{ id: string }>(
					`https://graph.threads.net/v1.0/${pageId}/threads`,
					{
						...(postTarget?.tags && postTarget.tags.length > 0 && { topic_tag: postTarget.tags[0] }),
						...(postTarget?.links && postTarget.links.length > 0 && { link_attachment: postTarget.links[0] }),
					},
					{
						params: {
							access_token: accessToken,
							media_type: ThreadsMediaType.TEXT,
							text: postTarget.text || mainCaption || '',
						},
					}
				)

				creationId = response.id
			} else if (mediaAssets.length === 1) {
				const mediaAsset = mediaAssets[0]
				const mediaType = mediaAsset.type?.startsWith('image')
					? ThreadsMediaType.IMAGE
					: mediaAsset.type?.startsWith('video')
						? ThreadsMediaType.VIDEO
						: ThreadsMediaType.TEXT

				const response = await this.httpClient.post<{ id: string }>(
					`https://graph.threads.net/v1.0/${pageId}/threads`,
					{
						...(postTarget?.tags && postTarget.tags.length > 0 && { topic_tag: postTarget.tags[0] }),
						...(postTarget?.links && postTarget.links.length > 0 && { link_attachment: postTarget.links[0] }),
					},
					{
						params: {
							access_token: accessToken,
							media_type: mediaType,
							text: postTarget.text || mainCaption || '',
							...(mediaType === ThreadsMediaType.IMAGE ? { image_url: mediaAsset.url } : {}),
							...(mediaType === ThreadsMediaType.VIDEO ? { video_url: mediaAsset.url } : {}),
						},
					}
				)

				creationId = response.id
			} else {
				if (mediaAssets.length > 10) {
					throw new BaseAppError('Threads carousel supports maximum 10 images', ErrorCode.BAD_REQUEST, 400)
				}

				const hasVideo = mediaAssets.some((asset) => asset.type?.startsWith('video'))

				if (hasVideo) {
					throw new BaseAppError('Threads carousel only supports images, not videos', ErrorCode.BAD_REQUEST, 400)
				}

				const mediaContainerIds: string[] = []

				for (const mediaAsset of mediaAssets) {
					const response = await this.httpClient.post<{ id: string }>(
						`https://graph.threads.net/v1.0/${pageId}/threads`,
						{
							...(postTarget?.tags && postTarget.tags.length > 0 && { topic_tag: postTarget.tags[0] }),
							...(postTarget?.links && postTarget.links.length > 0 && { link_attachment: postTarget.links[0] }),
						},
						{
							params: {
								access_token: accessToken,
								media_type: ThreadsMediaType.IMAGE,
								image_url: mediaAsset.url,
								is_carousel_item: true,
							},
						}
					)

					mediaContainerIds.push(response.id)
				}

				await Promise.all(
					mediaContainerIds.map((containerId) => this.waitForThreadsContainerReady(containerId, accessToken))
				)

				const carouselResponse = await this.httpClient.post<{ id: string }>(
					`https://graph.threads.net/v1.0/${pageId}/threads`,
					{
						...(postTarget?.tags && postTarget.tags.length > 0 && { topic_tag: postTarget.tags[0] }),
						...(postTarget?.links && postTarget.links.length > 0 && { link_attachment: postTarget.links[0] }),
					},
					{
						params: {
							access_token: accessToken,
							media_type: ThreadsMediaType.CAROUSEL,
							text: postTarget.text || mainCaption || '',
							children: mediaContainerIds.join(','),
						},
					}
				)

				creationId = carouselResponse.id
			}

			this.logger.debug('Media container created', { creationId })

			await this.waitForThreadsContainerReady(creationId, accessToken)

			const postRes = await this.httpClient.post<{ id: string }>(
				`https://graph.threads.net/v1.0/${pageId}/threads_publish`,
				null,
				{
					params: {
						access_token: accessToken,
						creation_id: creationId,
					},
				}
			)

			const replies = postTarget.threadsReplies || []
			await this.publishReplies(
				replies,
				Math.min(replies.length, 10),
				pageId,
				accessToken,
				postRes.id
			)

			await this.postRepository.updatePostTarget(userId, postId, postTarget.socialAccountId, PostStatus.DONE)

			this.logger.info('Threads post published successfully', {
				operation: 'sendPostToThreads',
				userId,
				postId,
				threadsPostId: postRes.id,
				mediaCount: mediaAssets.length,
				mediaType: mediaAssets.length > 1 ? 'carousel' : mediaAssets.length === 1 ? 'single' : 'text',
				replyCount: replies.length,
			})

			return await this.postRepository.getPostDetails(postId, userId)
		} catch (error: unknown) {
			const errorResult = await this.socialMediaErrorHandler.handleSocialMediaError(
				error,
				'threads',
				userId,
				postId,
				postTarget.socialAccountId
			)

			throw errorResult.error
		}
	}
}
