import { SocilaMediaPlatform } from "@/schemas/posts.schemas"
import { ErrorCode } from "@/shared/consts/error-codes.const"
import { BaseAppError } from "@/shared/errors/base-error"
import { IBlueskyConnectorService } from "../connectors/bluesky-connector-service/bluesky-connector-service.interface"
import { BlueskyConnectorService } from "../connectors/bluesky-connector-service/bluesky-connector.service"
import { IFacebookConnectorService } from "../connectors/facebook-connector-service/facebook-connector-service.interface"
import { FacebookConnectorService } from "../connectors/facebook-connector-service/facebook-connector.service"
import { ILinkedinConnectorService } from "../connectors/linkedin-connector-service/linkedin-connector-service.interface"
import { LinkedinConnectorService } from "../connectors/linkedin-connector-service/linkedin-connector.service"
import { IInstagramConnectorService } from "../connectors/instagram-connector-service/instagram-connector-service.interface"
import { InstagramConnectorService } from "../connectors/instagram-connector-service/instagram-connector.service"
import { IPinterestConnectorService } from "../connectors/pinterest-connector-service/pinterest-connector-service.interface"
import { PinterestConnectorService } from "../connectors/pinterest-connector-service/pinterest-connector.service"
import { ITikTokConnectorService } from "../connectors/tiktok-connector-service/tiktok-connector-service.interface"
import { TikTokConnectorService } from "../connectors/tiktok-connector-service/tiktok-connector.service"
import { IThreadsConnectorService } from "../connectors/threads-connector-service/threads-connector-service.interface"
import { ThreadsConnectorService } from "../connectors/threads-connector-service/threads-connector.service"
import { IYouTubeConnectorService } from "../connectors/youtube-connector-service/youtube-connector-service.interface"
import { YouTubeConnectorService } from "../connectors/youtube-connector-service/youtube-connector.service"
import { IXConnectorService } from "../connectors/x-connector-service/x-connector-service.interface"
import { XConnectorService } from "../connectors/x-connector-service/x-connector.service"
import { ILogger } from "@/shared/infra/logger"
import { IAccountRepository } from "@/repositories/account-repository"
import { IAccountsService } from "@/services/accounts-service"
import { IApiClient } from "@/shared/infra/api"
import { IMediaUploader } from "@/shared/infra/media"

export class SocialMediaConnectorFactory {
    private readonly blueskyConnectorService: IBlueskyConnectorService
    private readonly facebookConnectorService: IFacebookConnectorService
    private readonly linkedinConnectorService: ILinkedinConnectorService
    private readonly instagramConnectorService: IInstagramConnectorService
    private readonly pinterestConnectorService: IPinterestConnectorService
    private readonly tiktokConnectorService: ITikTokConnectorService
    private readonly threadsConnectorService: IThreadsConnectorService
    private readonly youtubeConnectorService: IYouTubeConnectorService
    private readonly xConnectorService: IXConnectorService

    constructor(
        logger: ILogger,
        httpClient: IApiClient,
        mediaUploader: IMediaUploader,
        accountRepository: IAccountRepository,
        accountService: IAccountsService
    ) {
        this.blueskyConnectorService = new BlueskyConnectorService(
            logger,
            httpClient,
            mediaUploader,
            accountRepository,
            accountService
        )
        this.facebookConnectorService = new FacebookConnectorService(
            logger,
            httpClient,
            mediaUploader,
            accountRepository,
            accountService
        )
        this.linkedinConnectorService = new LinkedinConnectorService(
            logger,
            httpClient,
            mediaUploader,
            accountRepository,
            accountService
        )
        this.instagramConnectorService = new InstagramConnectorService(
            logger,
            httpClient,
            mediaUploader,
            accountRepository,
            accountService
        )
        this.pinterestConnectorService = new PinterestConnectorService(
            logger,
            httpClient,
            mediaUploader,
            accountRepository,
            accountService
        )
        this.tiktokConnectorService = new TikTokConnectorService(
            logger,
            httpClient,
            mediaUploader,
            accountRepository,
            accountService
        )
        this.threadsConnectorService = new ThreadsConnectorService(
            logger,
            httpClient,
            mediaUploader,
            accountRepository,
            accountService
        )
        this.youtubeConnectorService = new YouTubeConnectorService(
            logger,
            httpClient,
            mediaUploader,
            accountRepository,
            accountService
        )
        this.xConnectorService = new XConnectorService(
            logger,
            httpClient,
            mediaUploader,
            accountRepository,
            accountService
        )
    }

    create(platform: SocilaMediaPlatform) {
        switch (platform) {
            case SocilaMediaPlatform.BLUESKY:
                return this.blueskyConnectorService
            case SocilaMediaPlatform.FACEBOOK:
                return this.facebookConnectorService
            case SocilaMediaPlatform.LINKEDIN:
                return this.linkedinConnectorService
            case SocilaMediaPlatform.INSTAGRAM:
                return this.instagramConnectorService
            case SocilaMediaPlatform.PINTEREST:
                return this.pinterestConnectorService
            case SocilaMediaPlatform.TIKTOK:
                return this.tiktokConnectorService
            case SocilaMediaPlatform.THREADS:
                return this.threadsConnectorService
            case SocilaMediaPlatform.YOUTUBE:
                return this.youtubeConnectorService
            case SocilaMediaPlatform.X:
                return this.xConnectorService
            default: {
                throw new BaseAppError(`Unknown platform connector - ${platform}`, ErrorCode.BAD_REQUEST, 500)
            }
        }
    }
}
