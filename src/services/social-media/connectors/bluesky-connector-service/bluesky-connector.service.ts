import { Account } from "@/entities/account";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import { BaseAppError } from "@/shared/errors/base-error";
import { IApiClient } from "@/shared/infra/api";
import { ILogger } from "@/shared/infra/logger";
import { getEnvVar } from "@/shared/utils/get-env-var";
import axios from "axios";
import { v4 as uuidv4 } from 'uuid'
import { uploadAccountAvatar } from "../../utils/upload-account-avatar";
import { IMediaUploader } from "@/shared/infra/media";
import { upsertAccount } from "../../utils/upsert-account";
import { IAccountRepository } from "@/repositories/account-repository";
import { IAccountsService } from "@/services/accounts-service";
import { IBlueskyConnectorService } from "./bluesky-connector-service.interface";

export class BlueskyConnectorService implements IBlueskyConnectorService {
	private readonly apiBaseUrl;
	private logger: ILogger
	private httpClient: IApiClient
	private mediaUploader: IMediaUploader
	private accountRepository: IAccountRepository
	private accountService: IAccountsService

	constructor(logger: ILogger, httpClient: IApiClient, mediaUploader: IMediaUploader, accountRepository: IAccountRepository, accountService: IAccountsService) {
		this.apiBaseUrl = getEnvVar('BLUESKY_API_BASE_URL') || getEnvVar('BLUESKY_OAUTH_BASE_URL') 
		this.logger = logger
		this.httpClient = httpClient
		this.mediaUploader = mediaUploader
		this.accountRepository = accountRepository
		this.accountService = accountService
	}

	async connectBlueskyAccount(        
		userId: string,
        identifier: string,
        appPassword: string): Promise<{success: boolean}> {
		try {
            const session = await this.httpClient.post<{
                did: string
                handle: string
                accessJwt: string
                refreshJwt?: string
            }>(`${this.apiBaseUrl}/xrpc/com.atproto.server.createSession`, {
                identifier,
                password: appPassword,
            })

			const { did, handle, accessJwt, refreshJwt } = session

						if (!accessJwt || !did) {
							throw new BaseAppError('Failed to establish Bluesky session', ErrorCode.UNAUTHORIZED, 401)
						}

			            let displayName: string | undefined
            let avatarUrl: string | undefined

			try {
                const profile = await this.httpClient.get<{
                    displayName?: string
                    avatar?: string
                }>(`${this.apiBaseUrl}/xrpc/app.bsky.actor.getProfile`, {
                    headers: {
                        Authorization: `Bearer ${accessJwt}`,
                    },
                    params: {
                        actor: did,
                    },
                })

                displayName = profile.displayName
                avatarUrl = profile.avatar
            } catch (profileError) {
                this.logger.warn('Failed to fetch Bluesky profile details', {
                    operation: 'connect_bluesky_account',
                    entity: 'Account',
                    userId,
                    did,
                    error: {
                        name: profileError instanceof Error ? profileError.name : 'Unknown',
                        stack: profileError instanceof Error ? profileError.stack : undefined,
                    },
                })
            }

			const accountName = displayName || handle || did

            const accessTokenTtlMinutes = Number(process.env.BLUESKY_ACCESS_TOKEN_TTL_MINUTES || '55')
            const accessTokenExpiresAt = new Date(Date.now() + accessTokenTtlMinutes * 60 * 1000)

            const accountImageUrl = await uploadAccountAvatar(
				this.mediaUploader,
				userId,
				identifier,
				avatarUrl
            )

            const account = new Account(
                uuidv4(),
                userId,
                'bluesky',
                accountName,
                accessJwt,
                new Date(),
                did,
                accountImageUrl,
                refreshJwt,
                accessTokenExpiresAt,
                undefined
            )

			const { isNew } = await upsertAccount(account, this.accountRepository, this.accountService)

            this.logger.info('Successfully processed Bluesky account', {
                operation: 'connect_bluesky_account',
                entity: 'Account',
                userId,
                did,
                handle,
                wasCreated: isNew,
            })

            return { success: true }
		} catch (error: unknown) {
            this.logger.error('Failed to connect Bluesky account', {
                operation: 'connect_bluesky_account',
                entity: 'Account',
                userId,
                identifier,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              stack: error.stack,
                          }
                        : { name: 'UnknownError' },
            })

            if (axios.isAxiosError(error)) {
                const status = error.response?.status || 500

                if (status === 400 || status === 401) {
                    throw new BaseAppError(
                        'Invalid Bluesky credentials. Please verify your identifier and app password.',
                        ErrorCode.UNAUTHORIZED,
                        401
                    )
                }
            }

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError('Failed to connect Bluesky account', ErrorCode.UNKNOWN_ERROR, 500)
		}
	}
}
