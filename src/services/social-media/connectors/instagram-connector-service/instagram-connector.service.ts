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
import { IInstagramConnectorService } from "./instagram-connector-service.interface"

export class InstagramConnectorService implements IInstagramConnectorService {
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
        this.appId = getEnvVar("INSTAGRAM_APP_ID")
        this.appSecret = getEnvVar("INSTAGRAM_APP_SECRET")
        this.redirectUri = getEnvVar("INSTAGRAM_REDIRECT_URI")
        this.backendUrl = getEnvVar("BACKEND_URL")
    }

    async connectInstagramAccount(userId: string, code: string): Promise<{ success: boolean }> {
        try {
            const formData = new URLSearchParams({
                client_id: this.appId,
                client_secret: this.appSecret,
                redirect_uri: `${this.backendUrl}${this.redirectUri}`,
                grant_type: "authorization_code",
                code,
            })

            const tokenResponse = await this.httpClient.post<{
                access_token: string
            }>("https://api.instagram.com/oauth/access_token", formData.toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            })

            const shortLivedToken = tokenResponse?.access_token

            if (!shortLivedToken) {
                throw new BaseAppError("Failed to get short-lived Instagram access token", ErrorCode.BAD_REQUEST, 400)
            }

            const longLivedTokenResponse = await this.httpClient.get<{
                access_token: string
                expires_in: number
            }>("https://graph.instagram.com/access_token", {
                params: {
                    grant_type: "ig_exchange_token",
                    client_secret: this.appSecret,
                    access_token: shortLivedToken,
                },
            })

            const longLivedToken = longLivedTokenResponse?.access_token

            if (!longLivedToken) {
                throw new BaseAppError("Failed to get long-lived Instagram access token", ErrorCode.BAD_REQUEST, 400)
            }

            const accessTokenExpiresAt = new Date(Date.now() + (longLivedTokenResponse.expires_in || 0) * 1000)

            const accountInfoResponse = await this.httpClient.get<{
                id: string
                username: string
                profile_picture_url?: string
                user_id?: string
            }>("https://graph.instagram.com/v23.0/me", {
                params: {
                    fields: "id,username,profile_picture_url,user_id",
                    access_token: longLivedToken,
                },
            })

            if (!accountInfoResponse?.id) {
                throw new BaseAppError("Failed to fetch Instagram account details", ErrorCode.BAD_REQUEST, 400)
            }

            const instagramUserId = accountInfoResponse.user_id ?? accountInfoResponse.id

            const accountImageUrl = await uploadAccountAvatar(
                this.mediaUploader,
                userId,
                accountInfoResponse.username || instagramUserId,
                accountInfoResponse.profile_picture_url
            )

            const account = new Account(
                uuidv4(),
                userId,
                "instagram",
                accountInfoResponse.username,
                longLivedToken,
                new Date(),
                instagramUserId,
                accountImageUrl,
                undefined,
                accessTokenExpiresAt
            )

            const { isNew } = await upsertAccount(account, this.accountRepository, this.accountService)

            this.logger.info("Successfully processed Instagram account", {
                operation: "connect_instagram_account",
                entity: "Account",
                userId,
                instagramUserId,
                wasCreated: isNew,
            })

            return { success: true }
        } catch (error: unknown) {
            this.logger.error("Failed to connect Instagram account", {
                operation: "connect_instagram_account",
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
            })

            if (axios.isAxiosError(error)) {
                const status = error.response?.status || 500

                if (status === 400 || status === 401) {
                    throw new BaseAppError(
                        "Invalid Instagram authorization code. Please try connecting again.",
                        ErrorCode.UNAUTHORIZED,
                        401
                    )
                }
            }

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError("Failed to connect Instagram account", ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
