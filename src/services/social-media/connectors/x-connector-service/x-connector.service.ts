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
import { IXConnectorService } from "./x-connector-service.interface"

export class XConnectorService implements IXConnectorService {
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
        this.appId = getEnvVar("X_APP_ID")
        this.appSecret = getEnvVar("X_APP_SECRET")
        this.redirectUri = getEnvVar("X_REDIRECT_URL")
        this.backendUrl = getEnvVar("BACKEND_URL")
    }

    async connectXAccount(userId: string, code: string, codeVerifier: string): Promise<{ success: boolean }> {
        try {
            const formData = new URLSearchParams({
                code,
                redirect_uri: `${this.backendUrl}${this.redirectUri}`,
                grant_type: "authorization_code",
                code_verifier: codeVerifier,
            })

            const credentials = Buffer.from(`${this.appId}:${this.appSecret}`).toString("base64")

            const tokenResponse = await this.httpClient.post<{
                access_token: string
                refresh_token?: string
                expires_in: number
            }>("https://api.twitter.com/2/oauth2/token", formData.toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    Authorization: `Basic ${credentials}`,
                },
            })

            const accessToken = tokenResponse?.access_token

            if (!accessToken) {
                throw new BaseAppError("Failed to retrieve X access token", ErrorCode.UNAUTHORIZED, 401)
            }

            const tokenExpiresIn = new Date(Date.now() + (tokenResponse.expires_in || 0) * 1000)

            const userInfoResponse = await this.httpClient.get<{
                data?: {
                    id: string
                    username: string
                    name?: string
                    profile_image_url?: string
                }
            }>("https://api.twitter.com/2/users/me", {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: {
                    "user.fields": "id,username,name,profile_image_url",
                },
            })

            const user = userInfoResponse.data

            if (!user || !user.id || !user.username) {
                throw new BaseAppError("X user info not found", ErrorCode.NOT_FOUND, 404)
            }

            const accountImageUrl = await uploadAccountAvatar(
                this.mediaUploader,
                userId,
                user.username || user.id,
                user.profile_image_url
            )

            const account = new Account(
                uuidv4(),
                userId,
                "x",
                user.name || user.username,
                accessToken,
                new Date(),
                user.id,
                accountImageUrl,
                tokenResponse.refresh_token,
                tokenExpiresIn
            )

            const { isNew } = await upsertAccount(account, this.accountRepository, this.accountService)

            this.logger.info("Successfully processed X account", {
                operation: "connect_x_account",
                entity: "Account",
                userId,
                wasCreated: isNew,
            })

            return { success: true }
        } catch (error: unknown) {
            this.logger.error("Failed to connect X account", {
                operation: "connect_x_account",
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
                        "Invalid X authorization code. Please try connecting again.",
                        ErrorCode.UNAUTHORIZED,
                        401
                    )
                }
            }

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError("Failed to connect X account", ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
