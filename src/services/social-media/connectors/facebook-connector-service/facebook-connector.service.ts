import { Account } from "@/entities/account"
import { IAccountRepository } from "@/repositories/account-repository"
import { IAccountsService } from "@/services/accounts-service"
import { ErrorCode } from "@/shared/consts/error-codes.const"
import { BaseAppError } from "@/shared/errors/base-error"
import { IApiClient } from "@/shared/infra/api"
import { ILogger } from "@/shared/infra/logger"
import { IMediaUploader } from "@/shared/infra/media"
import { getEnvVar } from "@/shared/utils/get-env-var"
import axios from "axios"
import { v4 as uuidv4 } from "uuid"
import { uploadAccountAvatar } from "../../utils/upload-account-avatar"
import { upsertAccount } from "../../utils/upsert-account"
import { IFacebookConnectorService } from "./facebook-connector-service.interface"

export class FacebookConnectorService implements IFacebookConnectorService {
    private readonly logger: ILogger
    private readonly httpClient: IApiClient
    private readonly mediaUploader: IMediaUploader
    private readonly accountRepository: IAccountRepository
    private readonly accountService: IAccountsService
    private readonly appId: string
    private readonly appSecret: string
    private readonly redirectUri: string
    private readonly backendUrl: string

    constructor(
        logger: ILogger,
        httpClient: IApiClient,
        mediaUploader: IMediaUploader,
        accountRepository: IAccountRepository,
        accountService: IAccountsService
    ) {
        this.logger = logger
        this.httpClient = httpClient
        this.mediaUploader = mediaUploader
        this.accountRepository = accountRepository
        this.accountService = accountService
        this.appId = getEnvVar("FB_APP_ID")
        this.appSecret = getEnvVar("FB_APP_SECRET")
        this.redirectUri = getEnvVar("FB_REDIRECT_URI")
        this.backendUrl = getEnvVar("BACKEND_URL")
    }

    async connectFacebookAccount(userId: string, code: string): Promise<{ success: boolean }> {
        try {
            const accessTokenResponse = await this.httpClient.get<{ access_token: string }>(
                "https://graph.facebook.com/v18.0/oauth/access_token",
                {
                    params: {
                        client_id: this.appId,
                        client_secret: this.appSecret,
                        redirect_uri: `${this.backendUrl}${this.redirectUri}`,
                        code,
                    },
                }
            )

            const accessToken = accessTokenResponse?.access_token

            if (!accessToken) {
                throw new BaseAppError("Failed to retrieve Facebook user access token", ErrorCode.BAD_REQUEST, 400)
            }

            const pagesResponse = await this.httpClient.get<{ data: any[] }>(
                "https://graph.facebook.com/v18.0/me/accounts",
                {
                    params: {
                        access_token: accessToken,
                        fields: "id,name,access_token,picture,expires_in",
                    },
                }
            )

            const pages = pagesResponse?.data || []

            if (pages.length === 0) {
                throw new BaseAppError("No Facebook pages available", ErrorCode.NOT_FOUND, 404)
            }

            const updatedPages: string[] = []
            const otherErrors: string[] = []
            let createdCount = 0

            for (const page of pages) {
                try {
                    const profileImageUrl = page.picture?.data?.url
                    const FACEBOOK_TOKEN_EXPIRY_SECONDS = 5_183_944
                    const tokenExpiresAt = new Date(Date.now() + FACEBOOK_TOKEN_EXPIRY_SECONDS * 1000)

                    const accountImageUrl = await uploadAccountAvatar(
                        this.mediaUploader,
                        userId,
                        page.name || page.id || "facebook-page",
                        profileImageUrl
                    )

                    const longLiveAccessToken = await this.httpClient.get<{ access_token: string }>(
                        "https://graph.facebook.com/v18.0/oauth/access_token",
                        {
                            params: {
                                client_id: this.appId,
                                client_secret: this.appSecret,
                                fb_exchange_token: page.access_token,
                                grant_type: "fb_exchange_token",
                            },
                        }
                    )

                    if (!longLiveAccessToken?.access_token) {
                        throw new BaseAppError("Failed to exchange Facebook page token", ErrorCode.BAD_REQUEST, 400)
                    }

                    const account = new Account(
                        uuidv4(),
                        userId.toString(),
                        "facebook",
                        page.name,
                        longLiveAccessToken.access_token,
                        new Date(),
                        page.id,
                        accountImageUrl,
                        undefined,
                        tokenExpiresAt
                    )

                    const { isNew } = await upsertAccount(account, this.accountRepository, this.accountService)
                    if (isNew) {
                        createdCount++
                    } else {
                        updatedPages.push(page.name)
                    }
                } catch (pageError: any) {
                    otherErrors.push(pageError?.message || "Unknown error")
                }
            }

            if (createdCount === 0 && updatedPages.length === 0) {
                this.logger.warn("Failed to connect any Facebook pages", {
                    operation: "connect_facebook_account",
                    entity: "Account",
                    userId,
                    updatedPages,
                    otherErrors,
                })
                return { success: false }
            }

            this.logger.info("Processed Facebook page connections", {
                operation: "connect_facebook_account",
                entity: "Account",
                userId,
                createdCount,
                updatedCount: updatedPages.length,
                errorCount: otherErrors.length,
            })

            return { success: true }
        } catch (error: unknown) {
            this.logger.error("Error during Facebook account connection", {
                operation: "connect_facebook_account",
                entity: "Account",
                userId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              stack: error.stack,
                          }
                        : { name: "UnknownError" },
                axiosMessage: axios.isAxiosError(error)
                    ? error.response?.data?.error?.message || error.message
                    : undefined,
                errorMessage: error instanceof Error ? error.message : undefined,
            })

            if (axios.isAxiosError(error)) {
                const status = error.response?.status || 500

                if (status === 400 || status === 401) {
                    throw new BaseAppError(
                        "Invalid Facebook authorization code. Please try connecting again.",
                        ErrorCode.UNAUTHORIZED,
                        401
                    )
                }
            }

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError("Failed to connect Facebook account", ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
