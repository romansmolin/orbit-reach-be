import { Account } from "@/entities/account"
import { IAccountRepository } from "@/repositories/account-repository"
import { PinterestBoard } from "@/entities/pinterest-board"
import { IAccountsService } from "@/services/accounts-service"
import { ErrorCode } from "@/shared/consts/error-codes.const"
import { BaseAppError } from "@/shared/errors/base-error"
import { IApiClient } from "@/shared/infra/api"
import { ILogger } from "@/shared/infra/logger"
import { IMediaUploader } from "@/shared/infra/media"
import { getEnvVar } from "@/shared/utils/get-env-var"
import { IPinterestBoardResponse } from "@/types/account.types"
import axios from "axios"
import { v4 as uuidv4 } from "uuid"
import { uploadAccountAvatar } from "../../utils/upload-account-avatar"
import { upsertAccount } from "../../utils/upsert-account"
import { IPinterestConnectorService } from "./pinterest-connector-service.interface"
import qs from "qs"

export class PinterestConnectorService implements IPinterestConnectorService {
    private readonly logger: ILogger
    private readonly httpClient: IApiClient
    private readonly mediaUploader: IMediaUploader
    private readonly accountRepository: IAccountRepository
    private readonly accountService: IAccountsService
    private readonly appId: string
    private readonly appSecret: string
    private readonly redirectUri: string
    private readonly backendUrl: string
    private readonly apiBaseUrl: string
    private readonly apiVersion: string

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
        this.appId = getEnvVar("PINTEREST_APP_ID")
        this.appSecret = getEnvVar("PINTEREST_APP_SECRET")
        this.redirectUri = getEnvVar("PINTEREST_REDIRECT_URL")
        this.backendUrl = getEnvVar("BACKEND_URL")
        this.apiBaseUrl = getEnvVar("PINTEREST_API_URL")
        this.apiVersion = getEnvVar("PINTEREST_API_VERSION")
    }

    async connectPinterestAccount(userId: string, code: string): Promise<{ success: boolean }> {
        try {
            const tokenBody = qs.stringify({
                grant_type: "authorization_code",
                code,
                redirect_uri: `${this.backendUrl}${this.redirectUri}`,
                continuous_refresh: true,
            })

            const tokenResponse = await this.httpClient.post<{
                access_token: string
                refresh_token?: string
                scope?: string[]
            }>(
                `${this.apiBaseUrl}/${this.apiVersion}/oauth/token`,
                tokenBody,
                {
                    headers: {
                        Authorization: `Basic ${Buffer.from(`${this.appId}:${this.appSecret}`).toString("base64")}`,
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                }
            )

            const accessToken = tokenResponse?.access_token

            if (!accessToken) {
                throw new BaseAppError("Failed to retrieve Pinterest access token", ErrorCode.BAD_REQUEST, 400)
            }

            const profileResponse = await this.httpClient.get<{
                username: string
                id: string
                profile_image?: string
            }>(`${this.apiBaseUrl}/${this.apiVersion}/user_account`, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            })

            if (!profileResponse?.id) {
                throw new BaseAppError("Failed to fetch Pinterest account details", ErrorCode.BAD_REQUEST, 400)
            }

            const boardsResponse = await this.httpClient.get<IPinterestBoardResponse>(
                `${this.apiBaseUrl}/${this.apiVersion}/boards`,
                {
                    headers: { Authorization: `Bearer ${accessToken}` },
                }
            )

            if (!boardsResponse) {
                throw new BaseAppError("Failed to get boards from Pinterest", ErrorCode.BAD_REQUEST, 404)
            }

            const accountImageUrl = await uploadAccountAvatar(
                this.mediaUploader,
                userId,
                profileResponse.username || profileResponse.id,
                profileResponse.profile_image,
                accessToken
            )

            const account = new Account(
                uuidv4(),
                userId,
                "pinterest",
                profileResponse.username,
                accessToken,
                new Date(),
                profileResponse.id,
                accountImageUrl,
                tokenResponse.refresh_token
            )

            const { isNew, account: persistedAccount } = await upsertAccount(
                account,
                this.accountRepository,
                this.accountService
            )

            if (boardsResponse.items && boardsResponse.items.length > 0) {
                await Promise.all(
                    boardsResponse.items
                        .filter((board) => (board.privacy || "").toUpperCase() !== "SECRET")
                        .map(async (board) => {
                            try {
                                const pinterestBoard = new PinterestBoard(
                                    uuidv4(),
                                    userId,
                                    persistedAccount.id,
                                    board.id,
                                    board.name,
                                    board.description || null,
                                    board.owner?.username || null,
                                    board.media?.image_cover_url || null,
                                    board.privacy,
                                    new Date(),
                                    new Date()
                                )
                                await this.accountRepository.savePinterestBoard(pinterestBoard)
                            } catch (boardError) {
                                this.logger.warn("Failed to save Pinterest board", {
                                    operation: "connect_pinterest_account",
                                    entity: "PinterestBoard",
                                    userId,
                                    boardId: board.id,
                                    error: {
                                        name: boardError instanceof Error ? boardError.name : "Unknown",
                                        stack: boardError instanceof Error ? boardError.stack : undefined,
                                    },
                                })
                            }
                        })
                )
            }

            this.logger.info("Successfully processed Pinterest account", {
                operation: "connect_pinterest_account",
                entity: "Account",
                userId,
                pinterestUserId: profileResponse.id,
                wasCreated: isNew,
            })

            return { success: true }
        } catch (error: unknown) {
            this.logger.error("Failed to connect Pinterest account", {
                operation: "connect_pinterest_account",
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
                        "Invalid Pinterest authorization code. Please try connecting again.",
                        ErrorCode.UNAUTHORIZED,
                        401
                    )
                }
            }

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError("Failed to connect Pinterest account", ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
