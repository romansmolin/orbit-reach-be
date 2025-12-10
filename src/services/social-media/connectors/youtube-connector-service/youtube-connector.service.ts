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
import { IYouTubeConnectorService } from "./youtube-connector-service.interface"

export class YouTubeConnectorService implements IYouTubeConnectorService {
    private readonly logger: ILogger
    private readonly httpClient: IApiClient
    private readonly mediaUploader: IMediaUploader
    private readonly accountRepository: IAccountRepository
    private readonly accountService: IAccountsService
    private readonly clientId: string
    private readonly clientSecret: string
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
        this.clientId = getEnvVar("GOOGLE_CLIENT_ID")
        this.clientSecret = getEnvVar("GOOGLE_CLIENT_SECRET")
        this.redirectUri = getEnvVar("YOUTUBE_REDIRECT_URI")
        this.backendUrl = getEnvVar("BACKEND_URL")
    }

    async connectYouTubeAccount(userId: string, code: string): Promise<{ success: boolean }> {
        try {
            const formData = new URLSearchParams({
                code,
                client_id: this.clientId,
                client_secret: this.clientSecret,
                redirect_uri: `${this.backendUrl}${this.redirectUri}`,
                grant_type: "authorization_code",
            })

            const tokenResponse = await this.httpClient.post<{
                access_token: string
                refresh_token: string
                expires_in: number
                refresh_token_expires_in: number
            }>("https://oauth2.googleapis.com/token", formData.toString(), {
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
            })

            const {
                access_token: accessToken,
                refresh_token: refreshToken,
                expires_in,
                refresh_token_expires_in,
            } = tokenResponse

            if (!accessToken) {
                throw new BaseAppError("Failed to retrieve YouTube access token", ErrorCode.UNAUTHORIZED, 401)
            }

            const userInfoResponse = await this.httpClient.get<{
                items?: Array<{
                    id: string
                    snippet: {
                        title: string
                        thumbnails?: { default?: { url?: string } }
                    }
                }>
            }>("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
                headers: { Authorization: `Bearer ${accessToken}` },
            })

            const channel = userInfoResponse.items?.[0]

            if (!channel) {
                throw new BaseAppError("YouTube channel info not found", ErrorCode.NOT_FOUND, 404)
            }

            const tokenExpiresIn = new Date(Date.now() + (expires_in || 0) * 1000)
            const refreshTokenExpiresIn = new Date(Date.now() + (refresh_token_expires_in || 0) * 1000)

            const accountImageUrl = await uploadAccountAvatar(
                this.mediaUploader,
                userId,
                channel.snippet.title || channel.id,
                channel.snippet.thumbnails?.default?.url
            )

            const account = new Account(
                uuidv4(),
                userId,
                "youtube",
                channel.snippet.title,
                accessToken,
                new Date(),
                channel.id,
                accountImageUrl,
                refreshToken,
                tokenExpiresIn,
                refreshTokenExpiresIn
            )

            const { isNew } = await upsertAccount(account, this.accountRepository, this.accountService)

            this.logger.info("Successfully processed YouTube account", {
                operation: "connect_youtube_account",
                entity: "Account",
                userId,
                channelId: channel.id,
                wasCreated: isNew,
            })

            return { success: true }
        } catch (error: unknown) {
            this.logger.error("Failed to connect YouTube account", {
                operation: "connect_youtube_account",
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
                    ? error.response?.data?.error_description || error.message
                    : undefined,
            })

            if (axios.isAxiosError(error)) {
                const status = error.response?.status || 500

                if (status === 400 || status === 401) {
                    throw new BaseAppError(
                        "Invalid YouTube authorization code. Please try connecting again.",
                        ErrorCode.UNAUTHORIZED,
                        401
                    )
                }
            }

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError("Failed to connect YouTube account", ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
