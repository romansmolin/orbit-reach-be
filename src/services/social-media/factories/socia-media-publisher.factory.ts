import { SocilaMediaPlatform } from "@/schemas/posts.schemas";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import { BaseAppError } from "@/shared/errors/base-error";
import { IBlueskyConntentPublisherService } from "../publishers/bluesky-content-publisher/bluesky-content-publisher.interface";
import { BlueskyContentPublisherService } from "../publishers/bluesky-content-publisher/bluesky-content-publisher.service";
import { IFacebookContentPublisherService } from "../publishers/facebook-content-publisher/facebook-content-publisher.interface";
import { FacebookContentPublisherService } from "../publishers/facebook-content-publisher/facebook-content-publisher.service";
import { ILinkedinContentPublisherService } from "../publishers/linkedin-content-publisher/linkedin-content-publisher.interface";
import { LinkedinContentPublisherService } from "../publishers/linkedin-content-publisher/linkedin-content-publisher.service";
import { IInstagramContentPublisherService } from "../publishers/instagram-content-publisher/instagram-content-publisher.interface";
import { InstagramContentPublisherService } from "../publishers/instagram-content-publisher/instagram-content-publisher.service";
import { IPinterestContentPublisherService } from "../publishers/pinterest-content-publisher/pinterest-content-publisher.interface";
import { PinterestContentPublisherService } from "../publishers/pinterest-content-publisher/pinterest-content-publisher.service";
import { IThreadsContentPublisherService } from "../publishers/threads-content-publisher/threads-content-publisher.interface";
import { ThreadsContentPublisherService } from "../publishers/threads-content-publisher/threads-content-publisher.service";
import { ITikTokContentPublisherService } from "../publishers/tiktok-content-publisher/tiktok-content-publisher.interface";
import { TikTokContentPublisherService } from "../publishers/tiktok-content-publisher/tiktok-content-publisher.service";
import { IYouTubeContentPublisherService } from "../publishers/youtube-content-publisher/youtube-content-publisher.interface";
import { YouTubeContentPublisherService } from "../publishers/youtube-content-publisher/youtube-content-publisher.service";
import { IXContentPublisherService } from "../publishers/x-content-publisher/x-content-publisher.interface";
import { XContentPublisherService } from "../publishers/x-content-publisher/x-content-publisher.service";
import { ILogger } from "@/shared/infra/logger";
import { IAccountRepository } from "@/repositories/account-repository";
import { IPostsRepository } from "@/repositories/posts-repository";
import { IApiClient } from "@/shared/infra/api";
import { SocialMediaErrorHandler } from "@/shared/infra/social-media-errors";
import { IVideoProcessor } from "@/shared/infra/video-processor/video-processor.interface";
import { IMediaUploader } from "@/shared/infra/media";
import { ImageProcessor } from "@/shared/infra/media/image-processor";
import { CreatePostResponse, PostTargetResponse } from "@/types/posts.types";

type PublisherService =
	| IBlueskyConntentPublisherService
	| IFacebookContentPublisherService
	| ILinkedinContentPublisherService
	| IInstagramContentPublisherService
	| IPinterestContentPublisherService
	| IThreadsContentPublisherService
	| ITikTokContentPublisherService
	| IYouTubeContentPublisherService
	| IXContentPublisherService

export class SocialMediaPublisherFactory {
	private readonly blueskyPublisher: IBlueskyConntentPublisherService
	private readonly facebookPublisher: IFacebookContentPublisherService
	private readonly linkedinPublisher: ILinkedinContentPublisherService
	private readonly instagramPublisher: IInstagramContentPublisherService
	private readonly pinterestPublisher: IPinterestContentPublisherService
	private readonly threadsPublisher: IThreadsContentPublisherService
	private readonly tiktokPublisher: ITikTokContentPublisherService
	private readonly youtubePublisher: IYouTubeContentPublisherService
	private readonly xPublisher: IXContentPublisherService

	constructor(
		logger: ILogger,
		accountRepository: IAccountRepository,
		postRepository: IPostsRepository,
		httpClient: IApiClient,
		socialMediaErrorHandler: SocialMediaErrorHandler,
		videoProcessor: IVideoProcessor,
		mediaUploader: IMediaUploader,
		imageProcessor?: ImageProcessor
	) {
		const sharedImageProcessor = imageProcessor ?? new ImageProcessor(logger)

		this.blueskyPublisher = new BlueskyContentPublisherService(
			logger,
			accountRepository,
			postRepository,
			httpClient,
			socialMediaErrorHandler
		)
		this.facebookPublisher = new FacebookContentPublisherService(
			logger,
			accountRepository,
			postRepository,
			httpClient,
			socialMediaErrorHandler,
			sharedImageProcessor,
			mediaUploader
		)
		this.linkedinPublisher = new LinkedinContentPublisherService(
			logger,
			accountRepository,
			postRepository,
			httpClient,
			socialMediaErrorHandler
		)
		this.instagramPublisher = new InstagramContentPublisherService(
			logger,
			accountRepository,
			postRepository,
			videoProcessor,
			socialMediaErrorHandler,
			mediaUploader,
			httpClient
		)
		this.pinterestPublisher = new PinterestContentPublisherService(
			logger,
			accountRepository,
			postRepository,
			httpClient,
			socialMediaErrorHandler
		)
		this.threadsPublisher = new ThreadsContentPublisherService(
			logger,
			accountRepository,
			postRepository,
			httpClient,
			socialMediaErrorHandler
		)
		this.tiktokPublisher = new TikTokContentPublisherService(
			logger,
			accountRepository,
			postRepository,
			httpClient,
			socialMediaErrorHandler,
			videoProcessor,
			sharedImageProcessor,
			mediaUploader
		)
		this.youtubePublisher = new YouTubeContentPublisherService(
			logger,
			accountRepository,
			postRepository,
			httpClient,
			socialMediaErrorHandler
		)
		this.xPublisher = new XContentPublisherService(
			logger,
			accountRepository,
			postRepository,
			httpClient,
			socialMediaErrorHandler
		)
	}

	create(platform: SocilaMediaPlatform): PublisherService {
		switch(platform) {
			case SocilaMediaPlatform.BLUESKY:
				return this.blueskyPublisher
			case SocilaMediaPlatform.FACEBOOK:
				return this.facebookPublisher
			case SocilaMediaPlatform.LINKEDIN:
				return this.linkedinPublisher
			case SocilaMediaPlatform.INSTAGRAM:
				return this.instagramPublisher
			case SocilaMediaPlatform.PINTEREST:
				return this.pinterestPublisher
			case SocilaMediaPlatform.THREADS:
				return this.threadsPublisher
			case SocilaMediaPlatform.TIKTOK:
				return this.tiktokPublisher
			case SocilaMediaPlatform.X:
				return this.xPublisher
			case SocilaMediaPlatform.YOUTUBE:
				return this.youtubePublisher
			default: {
				throw new BaseAppError(`Unknown platform publisher - ${platform}`, ErrorCode.BAD_REQUEST, 500)
			}
		}
	}

	async publish(
		platform: SocilaMediaPlatform,
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		options?: { mainCaption?: string; post?: CreatePostResponse }
	): Promise<unknown> {
		const mainCaption = options?.mainCaption
		const post = options?.post

		switch (platform) {
			case SocilaMediaPlatform.THREADS:
				return this.threadsPublisher.sendPostToThreads(postTarget, userId, postId, mainCaption, post)
			case SocilaMediaPlatform.INSTAGRAM:
				return this.instagramPublisher.sendPostToInstagram(postTarget, userId, postId, mainCaption, post)
			case SocilaMediaPlatform.PINTEREST:
				return this.pinterestPublisher.sendPostToPinterest(
					postTarget,
					userId,
					postId,
					postTarget.pinterestBoardId,
					mainCaption
				)
			case SocilaMediaPlatform.FACEBOOK:
				return this.facebookPublisher.sendPostToFacebook(postTarget, userId, postId, mainCaption)
			case SocilaMediaPlatform.YOUTUBE:
				return this.youtubePublisher.sendPostToYouTube(postTarget, userId, postId, mainCaption)
			case SocilaMediaPlatform.BLUESKY:
				return this.blueskyPublisher.sendPostToBluesky(postTarget, userId, postId, mainCaption)
			case SocilaMediaPlatform.TIKTOK:
				return this.tiktokPublisher.sendPostToTikTok(postTarget, userId, postId, mainCaption, post)
			case SocilaMediaPlatform.X:
				return this.xPublisher.sendPostToX(postTarget, userId, postId, mainCaption)
			case SocilaMediaPlatform.LINKEDIN:
				return this.linkedinPublisher.sendPostToLinkedin(postTarget, userId, postId, mainCaption)
			default:
				throw new BaseAppError(`Unknown platform publisher - ${platform}`, ErrorCode.BAD_REQUEST, 500)
		}
	}
}
