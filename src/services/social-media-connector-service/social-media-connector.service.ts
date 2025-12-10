import { Account } from "@/entities/account"
import { SocilaMediaPlatform } from "@/schemas/posts.schemas"
import { IAccountRepository } from "@/repositories/account-repository"
import { IAccountsService } from "@/services/accounts-service/accounts.service.interface"
import { IBlueskyConnectorService } from "@/services/social-media/connectors/bluesky-connector-service/bluesky-connector-service.interface"
import { IFacebookConnectorService } from "@/services/social-media/connectors/facebook-connector-service/facebook-connector-service.interface"
import { IInstagramConnectorService } from "@/services/social-media/connectors/instagram-connector-service/instagram-connector-service.interface"
import { ILinkedinConnectorService } from "@/services/social-media/connectors/linkedin-connector-service/linkedin-connector-service.interface"
import { IPinterestConnectorService } from "@/services/social-media/connectors/pinterest-connector-service/pinterest-connector-service.interface"
import { IThreadsConnectorService } from "@/services/social-media/connectors/threads-connector-service/threads-connector-service.interface"
import { ITikTokConnectorService } from "@/services/social-media/connectors/tiktok-connector-service/tiktok-connector-service.interface"
import { IYouTubeConnectorService } from "@/services/social-media/connectors/youtube-connector-service/youtube-connector-service.interface"
import { IXConnectorService } from "@/services/social-media/connectors/x-connector-service/x-connector-service.interface"
import { SocialMediaConnectorFactory } from "@/services/social-media/factories/social-media-connector.factory"
import { IApiClient } from "@/shared/infra/api"
import { ILogger } from "@/shared/infra/logger/logger.interface"
import { IMediaUploader } from "@/shared/infra/media/media-uploader.interface"
import { ISocilaMediaConnectorService } from "./social-media-connector.interface"

export class SocilaMediaConnectorService implements ISocilaMediaConnectorService {
    private readonly connectorFactory: SocialMediaConnectorFactory

    constructor(
        logger: ILogger,
        mediaUploader: IMediaUploader,
        accountRepository: IAccountRepository,
        apiClient: IApiClient,
        accountsService: IAccountsService
    ) {
        this.connectorFactory = new SocialMediaConnectorFactory(
            logger,
            apiClient,
            mediaUploader,
            accountRepository,
            accountsService
        )
    }

    async connectFacebookAccount(userId: string, code: string): Promise<{ success: boolean }> {
        const connector = this.connectorFactory.create(SocilaMediaPlatform.FACEBOOK) as IFacebookConnectorService
        return connector.connectFacebookAccount(userId, code)
    }

    async connectInstagramAccount(userId: string, code: string): Promise<{ success: boolean }> {
        const connector = this.connectorFactory.create(SocilaMediaPlatform.INSTAGRAM) as IInstagramConnectorService
        return connector.connectInstagramAccount(userId, code)
    }

    async connectThreadsAccount(userId: string, code: string): Promise<{ success: boolean }> {
        const connector = this.connectorFactory.create(SocilaMediaPlatform.THREADS) as IThreadsConnectorService
        return connector.connectThreadsAccount(userId, code)
    }

    async connectTikTokAccount(userId: string, code: string): Promise<{ success: boolean }> {
        const connector = this.connectorFactory.create(SocilaMediaPlatform.TIKTOK) as ITikTokConnectorService
        return connector.connectTikTokAccount(userId, code)
    }

    async connectYouTubeAccount(userId: string, code: string): Promise<{ success: boolean }> {
        const connector = this.connectorFactory.create(SocilaMediaPlatform.YOUTUBE) as IYouTubeConnectorService
        return connector.connectYouTubeAccount(userId, code)
    }

    async connectBlueskyAccount(userId: string, identifier: string, appPassword: string): Promise<{ success: boolean }> {
        const connector = this.connectorFactory.create(SocilaMediaPlatform.BLUESKY) as IBlueskyConnectorService
        return connector.connectBlueskyAccount(userId, identifier, appPassword)
    }

    async connectXAccount(userId: string, code: string, codeVerifier: string): Promise<{ success: boolean }> {
        const connector = this.connectorFactory.create(SocilaMediaPlatform.X) as IXConnectorService
        return connector.connectXAccount(userId, code, codeVerifier)
    }

    async connectPinterestAccount(userId: string, code: string): Promise<{ success: boolean }> {
        const connector = this.connectorFactory.create(SocilaMediaPlatform.PINTEREST) as IPinterestConnectorService
        return connector.connectPinterestAccount(userId, code)
    }

    async connectLinkedinAccount(userId: string, code: string): Promise<{ success: boolean }> {
        const connector = this.connectorFactory.create(SocilaMediaPlatform.LINKEDIN) as ILinkedinConnectorService
        return connector.connectLinkedinAccount(userId, code)
    }
}
