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
import { IThreadsConnectorService } from "./threads-connector-service.interface"

export class ThreadsConnectorService implements IThreadsConnectorService {
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
        this.appId = getEnvVar("THREADS_APP_ID")
        this.appSecret = getEnvVar("THREADS_APP_SECRET")
        this.redirectUri = getEnvVar("THREADS_REDIRECT_URI")
        this.backendUrl = getEnvVar("BACKEND_URL")
    }

    async connectThreadsAccount(userId: string, code: string): Promise<{ success: boolean }> {
        try {
            const redirectUri = `${this.backendUrl}${this.redirectUri}`

            const oauthParams = {
                client_id: this.appId,
                client_secret: this.appSecret,
                redirect_uri: redirectUri,
                code,
            }

            const tokenResponse = await this.httpClient.get<{ access_token: string }>(
                "https://graph.threads.net/oauth/access_token",
                { params: oauthParams }
            )

            const shortLiveToken = tokenResponse?.access_token

            if (!shortLiveToken) {
                throw new BaseAppError("Failed to retrieve Threads access token", ErrorCode.UNAUTHORIZED, 401)
            }

            const profile = await this.httpClient.get<{
                id: string
                username: string
                threads_profile_picture_url?: string
                threads_biography?: string
            }>("https://graph.threads.net/v1.0/me", {
                params: {
                    fields: "id,username,name,threads_profile_picture_url,threads_biography",
                    access_token: shortLiveToken,
                },
            })

            const tokenExchangeResponse = await this.httpClient.get<{
                access_token: string
                expires_in: number
            }>("https://graph.threads.net/access_token", {
                params: {
                    grant_type: "th_exchange_token",
                    client_secret: this.appSecret,
                    access_token: shortLiveToken,
                },
            })

            const longLiveAccessToken = tokenExchangeResponse?.access_token

            if (!longLiveAccessToken) {
                throw new BaseAppError("Failed to exchange Threads token", ErrorCode.BAD_REQUEST, 400)
            }

            const tokenExpiresIn = new Date(Date.now() + (tokenExchangeResponse.expires_in || 0) * 1000)

            if (!profile || !profile.id || !profile.username) {
                throw new BaseAppError("Threads profile information not found", ErrorCode.NOT_FOUND, 404)
            }

            const accountImageUrl = await uploadAccountAvatar(
                this.mediaUploader,
                userId,
                profile.username || profile.id,
                profile.threads_profile_picture_url
            )

            const account = new Account(
                uuidv4(),
                userId.toString(),
                "threads",
                profile.username,
                longLiveAccessToken,
                new Date(),
                profile.id,
                accountImageUrl,
                undefined,
                tokenExpiresIn
            )

            const { isNew } = await upsertAccount(account, this.accountRepository, this.accountService)

            this.logger.info("Successfully processed Threads account", {
                operation: "connect_threads_account",
                entity: "Account",
                userId,
                wasCreated: isNew,
            })

            return { success: true }
        } catch (error: unknown) {
            this.logger.error("Failed to connect Threads account", {
                operation: "connect_threads_account",
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
                        "Invalid Threads authorization code. Please try connecting again.",
                        ErrorCode.UNAUTHORIZED,
                        401
                    )
                }
            }

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError("Failed to connect Threads account", ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
