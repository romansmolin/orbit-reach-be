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
import { ILinkedinConnectorService } from "./linkedin-connector-service.interface"

export class LinkedinConnectorService implements ILinkedinConnectorService {
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
        this.clientId = getEnvVar("LINKEDIN_CLIENT_ID")
        this.clientSecret = getEnvVar("LINKEDIN_CLIENT_SECRET")
        this.redirectUri = getEnvVar("LINKEDIN_REDIRECT_URI")
        this.backendUrl = getEnvVar("BACKEND_URL")
    }

    async connectLinkedinAccount(userId: string, code: string): Promise<{ success: boolean }> {
        try {
            const formData = new URLSearchParams({
                grant_type: "authorization_code",
                code,
                redirect_uri: `${this.backendUrl}${this.redirectUri}`,
                client_id: this.clientId,
                client_secret: this.clientSecret,
            })

            const tokenResponse = await this.httpClient.post<{
                access_token: string
                refresh_token?: string
                expires_in?: number
                refresh_token_expires_in?: number
            }>("https://www.linkedin.com/oauth/v2/accessToken", formData.toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            })

            const accessToken = tokenResponse?.access_token

            if (!accessToken) {
                throw new BaseAppError("Failed to retrieve LinkedIn access token", ErrorCode.UNAUTHORIZED, 401)
            }

            const profile = await this.httpClient.get<{
                sub: string
                name?: string
                given_name?: string
                family_name?: string
                email?: string
                picture?: string
            }>("https://api.linkedin.com/v2/userinfo", {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            })

            if (!profile || !profile.sub) {
                throw new BaseAppError("LinkedIn profile information not found", ErrorCode.NOT_FOUND, 404)
            }

            const firstName = profile.given_name || profile.name?.split(" ")[0] || "LinkedIn"
            const lastName = profile.family_name || profile.name?.split(" ").slice(1).join(" ") || "User"
            const displayName = profile.name || `${firstName} ${lastName}`.trim() || "LinkedIn User"
            const profilePictureUrl = profile.picture || undefined

            const accountImageUrl = await uploadAccountAvatar(
                this.mediaUploader,
                userId,
                displayName,
                profilePictureUrl
            )

            const tokenExpiresIn = new Date(Date.now() + (tokenResponse.expires_in || 0) * 1000)
            const refreshTokenExpiresIn = tokenResponse.refresh_token_expires_in
                ? new Date(Date.now() + tokenResponse.refresh_token_expires_in * 1000)
                : undefined

            const account = new Account(
                uuidv4(),
                userId,
                "linkedin",
                displayName,
                accessToken,
                new Date(),
                profile.sub,
                accountImageUrl,
                tokenResponse.refresh_token,
                tokenExpiresIn,
                refreshTokenExpiresIn
            )

            const { isNew } = await upsertAccount(account, this.accountRepository, this.accountService)

            this.logger.info("Successfully processed LinkedIn account", {
                operation: "connect_linkedin_account",
                entity: "Account",
                userId,
                linkedinId: profile.sub,
                displayName,
                hasRefreshToken: !!tokenResponse.refresh_token,
                wasCreated: isNew,
            })

            return { success: true }
        } catch (error: unknown) {
            this.logger.error("Failed to connect LinkedIn account", {
                operation: "connect_linkedin_account",
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
                        "Invalid LinkedIn authorization code. Please try connecting again.",
                        ErrorCode.UNAUTHORIZED,
                        401
                    )
                }
            }

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError("Failed to connect LinkedIn account", ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
