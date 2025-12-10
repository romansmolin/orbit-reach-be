import { AccountRepository } from '@/repositories/account-repository'
import { PostsRepository } from '@/repositories/posts-repository'
import { UserRepository } from '@/repositories/user-repository'
import { PlatformUsageRepository } from '@/repositories/platform-usage-repository/platform-usage.repository'
import { SocialMediaPostSenderService } from '@/services/social-media-post-sender-service'
import { SocialMediaTokenRefresherService } from '@/services/social-media-token-refresher-service'
import { PlatformQuotaService } from '@/services/platform-quota-service/platform-quouta.service'
import { PostService } from '@/services/posts-service'
import { AiService, type IAiService } from '@/services/ai-service'
import { TenantSettingsRepository } from '@/repositories/tenant-settings-repository/tenant-settings.repository'
import { TenantSettingsService } from '@/services/tenant-settings-service/tenant-settings.service'
import { SocialMediaErrorHandler } from '@/shared/infra/social-media-errors'
import { VideoProcessor } from '@/shared/infra/video-processor'
import { OAuthErrorHandler } from '@/shared/infra/oauth-errors'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { S3Uploader } from '@/shared/infra/media'
import { BullMqPostScheduler, type IPostScheduler } from '@/shared/infra/queue'
import { AxiosApiClient } from '@/shared/infra/api'
import { UserService } from '@/services/users-service/users.service'
import { StripeService } from '@/services/stripe-service/stripe.service'
import { createDefaultRateLimiterService, RateLimiterService } from '@/shared/infra/rate-limiter'
import { NodemailerEmailService } from '@/services/email-service/email.service'
import { IEmailService } from '@/services/email-service/email-service.interface'
import { AccountsService } from '@/services/accounts-service'
import { SocilaMediaConnectorService } from '@/services/social-media-connector-service'
import { OAuthStateService } from '@/shared/infra/oauth-state'
import { StripeWebhookService } from '@/services/stripe-service/stripe-webhook.service'
import { getStripeConfigVar } from '@/shared/utils/get-stripe-config'
import Stripe from 'stripe'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { ConsoleLogger } from '@/shared/infra/logger'
import { SocialMediaPublisherFactory } from '@/services/social-media/factories/socia-media-publisher.factory'
import { ImageProcessor } from '@/shared/infra/media/image-processor'

export interface Services {
    postRepository: PostsRepository
    accountRepository: AccountRepository
    userRepository: UserRepository
    platformUsageRepository: PlatformUsageRepository
    platformQuotaService: PlatformQuotaService
    tenantSettingsRepository: TenantSettingsRepository
    tenantSettingsService: TenantSettingsService
    videoProcessor: VideoProcessor
    oauthErrorHandler: OAuthErrorHandler
    socialMediaErrorHandler: SocialMediaErrorHandler
    socialMediaPostSender: SocialMediaPostSenderService
    socialMediaTokenRefresher: SocialMediaTokenRefresherService
    mediaUploader: S3Uploader
    postsService: PostService
    postScheduler: IPostScheduler
    aiService: IAiService
    rateLimiterService: RateLimiterService
    emailService: IEmailService
    userService: UserService
    accountsService: AccountsService
    socialMediaConnector: SocilaMediaConnectorService
    oauthStateService: OAuthStateService
    stripeWebhookService: StripeWebhookService
    stripeService: StripeService
	logger: ILogger
}

export function initializeServices() {
	const logger = new ConsoleLogger()
	const imageProcessor = new ImageProcessor(logger)
	
	const stripeService = new StripeService()
    const platformUsageRepository = new PlatformUsageRepository()
    const postScheduler = new BullMqPostScheduler()
    const apiClient = new AxiosApiClient()

    const mediaUploader = new S3Uploader(logger)
    const postRepository = new PostsRepository(logger)
    const accountRepository = new AccountRepository(logger)
    const userRepository = new UserRepository(logger)
    const emailService: IEmailService = new NodemailerEmailService(logger)
	const videoProcessor = new VideoProcessor(logger)
    const oauthErrorHandler = new OAuthErrorHandler(logger)
	const tenantSettingsRepository = new TenantSettingsRepository(logger)


    const userService = new UserService(userRepository, stripeService, logger, emailService)
    const tenantSettingsService = new TenantSettingsService(tenantSettingsRepository)
    const platformQuotaService = new PlatformQuotaService(platformUsageRepository)

    const socialMediaErrorHandler = new SocialMediaErrorHandler(logger, postRepository)
    const socialMediaPublisherFactory = new SocialMediaPublisherFactory(
        logger,
        accountRepository,
        postRepository,
        apiClient,
        socialMediaErrorHandler,
        videoProcessor,
        mediaUploader,
        imageProcessor
    )

    const socialMediaPostSender = new SocialMediaPostSenderService(
        postRepository,
        logger,
        socialMediaErrorHandler,
        socialMediaPublisherFactory
    )

    const socialMediaTokenRefresher = new SocialMediaTokenRefresherService(logger, accountRepository)


    const postsService = new PostService(
        postRepository,
        mediaUploader,
        logger,
        postScheduler,
        socialMediaPostSender,
        userRepository,
        platformQuotaService,
        tenantSettingsService,
        socialMediaErrorHandler
    )

    const openAiBaseUrl = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1'

    const openAiClient = new AxiosApiClient(openAiBaseUrl)
    const aiService: IAiService = new AiService(openAiClient, logger, userService)
    const rateLimiterService = createDefaultRateLimiterService(logger)
    const accountsService = new AccountsService(accountRepository, logger, mediaUploader, userService, postsService)
    const socialMediaConnector = new SocilaMediaConnectorService(
        logger,
        mediaUploader,
        accountRepository,
        apiClient,
        accountsService
    )

    const oauthStateService = new OAuthStateService(logger)

    const stripeSecretKey = getStripeConfigVar('STRIPE_SECRET_KEY')
    const stripeWebhookSecret = getStripeConfigVar('STRIPE_WEBHOOK_SECRET')

    if (!stripeSecretKey || !stripeWebhookSecret) {
        throw new BaseAppError(
            'Required Stripe environment variables are not configured',
            ErrorCode.UNKNOWN_ERROR,
            500
        )
    }

    const stripeClient = new Stripe(stripeSecretKey)
    const stripeWebhookService = new StripeWebhookService(stripeClient, stripeWebhookSecret, userService)

    return {
        postRepository,
        accountRepository,
        userRepository,
        tenantSettingsRepository,
        tenantSettingsService,
        platformUsageRepository,
        platformQuotaService,
        videoProcessor,
        oauthErrorHandler,
        socialMediaErrorHandler,
        socialMediaPostSender,
        socialMediaTokenRefresher,
        mediaUploader,
        postsService,
        postScheduler,
        aiService,
        rateLimiterService,
        emailService,
        userService,
        accountsService,
        socialMediaConnector,
        oauthStateService,
        stripeWebhookService,
        stripeService,
		logger
    }
}
