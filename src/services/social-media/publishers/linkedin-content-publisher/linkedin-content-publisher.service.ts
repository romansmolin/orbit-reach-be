import { ILinkedinContentPublisherService } from "./linkedin-content-publisher.interface";
import { ILogger } from "@/shared/infra/logger";
import { IAccountRepository } from "@/repositories/account-repository";
import { IPostsRepository } from "@/repositories/posts-repository";
import { IApiClient } from "@/shared/infra/api";
import { SocialMediaErrorHandler } from "@/shared/infra/social-media-errors";
import { BaseAppError } from "@/shared/errors/base-error";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import { PostStatus, PostTargetResponse } from "@/types/posts.types";

type LinkedInRegisterUploadResponse = {
	value: {
		uploadMechanism: {
			'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
				uploadUrl: string
			}
		}
		asset: string
	}
}

export class LinkedinContentPublisherService implements ILinkedinContentPublisherService {
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

	async sendPostToLinkedin(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		mainCaption?: string
	): Promise<void> {
		try {
			const { accessToken, pageId: linkedinUserId } =
				await this.accountRepository.getAccountByUserIdAndSocialAccountId(userId, postTarget.socialAccountId)

			const mediaAssets = await this.postRepository.getPostMediaAssets(postId)
			const text = postTarget.text || mainCaption || ''

			if (mediaAssets.length === 0) {
				await this.createLinkedInTextPost(accessToken, text, linkedinUserId)
			} else if (mediaAssets.length === 1) {
				const mediaAsset = mediaAssets[0]
				if (mediaAsset.type?.startsWith('video')) {
					await this.createLinkedInVideoPost(
						accessToken,
						text,
						mediaAsset.url,
						userId,
						postId,
						linkedinUserId
					)
				} else {
					await this.createLinkedInImagePost(
						accessToken,
						text,
						[mediaAsset.url],
						userId,
						postId,
						linkedinUserId
					)
				}
			} else {
				const hasVideo = mediaAssets.some((asset) => asset.type?.startsWith('video'))
				if (hasVideo) {
					throw new BaseAppError(
						'LinkedIn carousel posts only support images, not videos',
						ErrorCode.BAD_REQUEST,
						400
					)
				}

				if (mediaAssets.length > 9) {
					throw new BaseAppError(
						'LinkedIn supports maximum 9 images in a carousel post',
						ErrorCode.BAD_REQUEST,
						400
					)
				}

				const imageUrls = mediaAssets.map((asset) => asset.url)
				await this.createLinkedInImagePost(accessToken, text, imageUrls, userId, postId, linkedinUserId)
			}

			await this.postRepository.updatePostTarget(userId, postId, postTarget.socialAccountId, PostStatus.DONE)

			this.logger.info('LinkedIn post created successfully', {
				operation: 'sendPostToLinkedin',
				userId,
				postId,
				mediaCount: mediaAssets.length,
				hasVideo: mediaAssets.some((asset) => asset.type?.startsWith('video')),
			})
		} catch (error: unknown) {
			const errorResult = await this.socialMediaErrorHandler.handleSocialMediaError(
				error,
				'linkedin',
				userId,
				postId,
				postTarget.socialAccountId
			)

			throw errorResult.error
		}
	}

	private async createLinkedInTextPost(accessToken: string, text: string, linkedinUserId: string): Promise<void> {
		const authorUrn = `urn:li:person:${linkedinUserId}`

		const payload = {
			author: authorUrn,
			lifecycleState: 'PUBLISHED',
			specificContent: {
				'com.linkedin.ugc.ShareContent': {
					shareCommentary: {
						text,
					},
					shareMediaCategory: 'NONE',
				},
			},
			visibility: {
				'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
			},
		}

		await this.httpClient.post('https://api.linkedin.com/v2/ugcPosts', payload, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				'X-Restli-Protocol-Version': '2.0.0',
			},
		})
	}

	private async createLinkedInImagePost(
		accessToken: string,
		text: string,
		imageUrls: string[],
		userId: string,
		postId: string,
		linkedinUserId: string
	): Promise<void> {
		const ownerUrn = `urn:li:person:${linkedinUserId}`
		const uploadedAssets: string[] = []

		for (const [index, imageUrl] of imageUrls.entries()) {
			try {
				const imageResponse = await this.httpClient.get<ArrayBuffer>(imageUrl, { responseType: 'arraybuffer' })
				const imageBuffer = Buffer.isBuffer(imageResponse) ? imageResponse : Buffer.from(imageResponse)

				const registerResponse = await this.httpClient.post<LinkedInRegisterUploadResponse>(
					'https://api.linkedin.com/v2/assets?action=registerUpload',
					{
						registerUploadRequest: {
							recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
							owner: ownerUrn,
							serviceRelationships: [
								{
									relationshipType: 'OWNER',
									identifier: 'urn:li:userGeneratedContent',
								},
							],
						},
					},
					{
						headers: {
							Authorization: `Bearer ${accessToken}`,
							'Content-Type': 'application/json',
						},
					}
				)

				const uploadUrl =
					registerResponse.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']
						.uploadUrl
				const asset = registerResponse.value.asset

				await this.httpClient.put(uploadUrl, imageBuffer, {
					headers: {
						'Content-Type': 'application/octet-stream',
					},
				})

				uploadedAssets.push(asset)

				this.logger.debug('LinkedIn image uploaded successfully', {
					operation: 'createLinkedInImagePost',
					userId,
					postId,
					imageIndex: index,
					asset,
				})
			} catch (error) {
				this.logger.error('Failed to upload image to LinkedIn', {
					operation: 'createLinkedInImagePost',
					userId,
					postId,
					imageIndex: index,
					imageUrl,
					error: {
						name: error instanceof Error ? error.name : 'Unknown Error',
						stack: error instanceof Error ? error.stack : undefined,
					},
				})
				throw error
			}
		}

		const payload = {
			author: ownerUrn,
			lifecycleState: 'PUBLISHED',
			specificContent: {
				'com.linkedin.ugc.ShareContent': {
					shareCommentary: {
						text,
					},
					shareMediaCategory: 'IMAGE',
					media: uploadedAssets.map((asset) => ({
						status: 'READY',
						description: {
							text,
						},
						media: asset,
						title: {
							text: 'Shared via ZapShipr',
						},
					})),
				},
			},
			visibility: {
				'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
			},
		}

		await this.httpClient.post('https://api.linkedin.com/v2/ugcPosts', payload, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
				'X-Restli-Protocol-Version': '2.0.0',
			},
		})
	}

	private async createLinkedInVideoPost(
		accessToken: string,
		text: string,
		videoUrl: string,
		userId: string,
		postId: string,
		linkedinUserId: string
	): Promise<void> {
		try {
			const ownerUrn = `urn:li:person:${linkedinUserId}`

			const videoResponse = await this.httpClient.get<ArrayBuffer>(videoUrl, { responseType: 'arraybuffer' })
			const videoBuffer = Buffer.isBuffer(videoResponse) ? videoResponse : Buffer.from(videoResponse)

			const registerResponse = await this.httpClient.post<LinkedInRegisterUploadResponse>(
				'https://api.linkedin.com/v2/assets?action=registerUpload',
				{
					registerUploadRequest: {
						recipes: ['urn:li:digitalmediaRecipe:feedshare-video'],
						owner: ownerUrn,
						serviceRelationships: [
							{
								relationshipType: 'OWNER',
								identifier: 'urn:li:userGeneratedContent',
							},
						],
					},
				},
				{
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'Content-Type': 'application/json',
					},
				}
			)

			const uploadUrl =
				registerResponse.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']
					.uploadUrl
			const asset = registerResponse.value.asset

			await this.httpClient.put(uploadUrl, videoBuffer, {
				headers: {
					'Content-Type': 'application/octet-stream',
				},
			})

			this.logger.debug('LinkedIn video uploaded successfully', {
				operation: 'createLinkedInVideoPost',
				userId,
				postId,
				asset,
				videoSize: videoBuffer.length,
			})

			const payload = {
				author: ownerUrn,
				lifecycleState: 'PUBLISHED',
				specificContent: {
					'com.linkedin.ugc.ShareContent': {
						shareCommentary: {
							text,
						},
						shareMediaCategory: 'VIDEO',
						media: [
							{
								status: 'READY',
								description: {
									text,
								},
								media: asset,
								title: {
									text: 'Video shared via ZapShipr',
								},
							},
						],
					},
				},
				visibility: {
					'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
				},
			}

			await this.httpClient.post('https://api.linkedin.com/v2/ugcPosts', payload, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
					'X-Restli-Protocol-Version': '2.0.0',
				},
			})
		} catch (error) {
			this.logger.error('Failed to create LinkedIn video post', {
				operation: 'createLinkedInVideoPost',
				userId,
				postId,
				videoUrl,
				error: {
					name: error instanceof Error ? error.name : 'Unknown Error',
					stack: error instanceof Error ? error.stack : undefined,
				},
			})
			throw error
		}
	}
}
