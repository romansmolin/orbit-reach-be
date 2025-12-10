import axios, { AxiosError } from 'axios'
import { ErrorCode } from '../../shared/consts/error-codes.const'
import qs from 'qs'
import { PostPlatform } from '@/schemas/posts.schemas'
import { BaseAppError } from '@/shared/errors/base-error'
import { handleAxiosErrors } from '@/shared/errors/handle-axios-error'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { ISocialMediaTokenRefresherService } from './social-media-token-refresher.interface'
import { IAccountRepository } from '@/repositories/account-repository'

export class SocialMediaTokenRefresherService implements ISocialMediaTokenRefresherService {
    private logger: ILogger
    private accountRepository: IAccountRepository

    constructor(logger: ILogger, accountRepository: IAccountRepository) {
        this.logger = logger
        this.accountRepository = accountRepository
    }

    async updateAccessToken(
        accountId: string,
        platform: PostPlatform,
        accessToken: string,
        refreshToken?: string
    ): Promise<void> {
        switch (platform) {
            case 'bluesky':
                await this.updateBlueskyAccessToken(accountId, refreshToken)
                break
            case 'tiktok':
                await this.updateTikTokAccessToken(accountId, accessToken, refreshToken || '')
                break
            case 'threads':
                await this.updateThreadsAccessToken(accountId, accessToken)
                break
            case 'x':
                await this.updateXAccessToken(accountId, accessToken, refreshToken || '')
                break
            case 'instagram':
                await this.updateInstagramAccessToken(accountId, accessToken)
                break
            case 'facebook':
                await this.updateFacebookAccessToken(accountId, accessToken)
                break
            case 'pinterest':
                await this.updatePinterestAccessToken(accountId, accessToken, refreshToken || '')
                break
            case 'youtube':
                await this.updateYouTubeAccessToken(accountId, accessToken, refreshToken || '')
                break
        }
    }

    private async updateBlueskyAccessToken(accountId: string, refreshToken?: string): Promise<void> {
        if (!refreshToken) {
            throw new BaseAppError('Missing Bluesky refresh token', ErrorCode.BAD_REQUEST, 400)
        }

        const apiBaseUrl = process.env.BLUESKY_API_BASE_URL || process.env.BLUESKY_OAUTH_BASE_URL || 'https://bsky.social'

        try {
            const response = await axios.post(
                `${apiBaseUrl}/xrpc/com.atproto.server.refreshSession`,
                undefined,
                {
                    headers: {
                        Authorization: `Bearer ${refreshToken}`,
                    },
                }
            )

            const { accessJwt, refreshJwt } = response.data || {}

            if (!accessJwt) {
                throw new BaseAppError('Failed to refresh Bluesky session', ErrorCode.UNAUTHORIZED, 401)
            }

            const accessTokenTtlMinutes = Number(process.env.BLUESKY_ACCESS_TOKEN_TTL_MINUTES || '55')
            const accessTokenExpiresAt = new Date(Date.now() + accessTokenTtlMinutes * 60 * 1000)

            await this.accountRepository.updateAccessTokenByAccountId(
                accountId,
                accessTokenExpiresAt,
                accessJwt,
                refreshJwt || refreshToken,
                null
            )

            this.logger.info('Bluesky token refreshed successfully', {
                operation: 'update_bluesky_access_token',
                entity: 'Account',
                accountId,
                receivedNewRefreshToken: !!refreshJwt,
            })
        } catch (error: unknown) {
            if (error instanceof AxiosError) {
                handleAxiosErrors(error, this.logger)
            }

            this.logger.error('Error while updating access token for Bluesky account', {
                blueskyAccountId: accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined,
                    code: error instanceof BaseAppError ? error.code : ErrorCode.UNKNOWN_ERROR,
                },
            })

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError(
                `Failed to update access token for Bluesky account with ${accountId}`,
                ErrorCode.BAD_REQUEST,
                500
            )
        }
    }

    async updateThreadsAccessToken(accountId: string, accessToken: string): Promise<void> {
        try {
            const { data } = await axios.get('https://graph.threads.net/refresh_access_token', {
                params: {
                    grant_type: 'th_refresh_token',
                    access_token: accessToken,
                },
            })
            const longLiveAccessToken = data.access_token
            const tokenExpiresIn = new Date(Date.now() + data.expires_in * 1000)

            await this.accountRepository.updateAccessTokenByAccountId(
                accountId,
                tokenExpiresIn,
                longLiveAccessToken,
                data.refresh_token || '',
                null
            )
        } catch (error: unknown) {
            if (error instanceof AxiosError) {
                handleAxiosErrors(error, this.logger)
            }

            this.logger.error('Error while updating access token for Threads account', {
                threadsAccountId: accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined,
                    code: error instanceof BaseAppError ? error.code : ErrorCode.UNKNOWN_ERROR,
                },
            })

            throw new BaseAppError(
                `Failed to update access token for Threads account with ${accountId}`,
                ErrorCode.BAD_REQUEST,
                500
            )
        }
    }

    async updateInstagramAccessToken(accountId: string, accessToken: string): Promise<void> {
        try {
            const { data } = await axios.get('https://graph.instagram.com/refresh_access_token', {
                params: {
                    grant_type: 'ig_refresh_token',
                    access_token: accessToken,
                },
            })
            const longLiveAccessToken = data.access_token
            const tokenExpiresIn = new Date(Date.now() + data.expires_in * 1000)

            await this.accountRepository.updateAccessTokenByAccountId(
                accountId,
                tokenExpiresIn,
                longLiveAccessToken,
                data.refresh_token || '',
                null
            )
        } catch (error: unknown) {
            if (error instanceof AxiosError) {
                handleAxiosErrors(error, this.logger)
            }

            this.logger.error('Error while updating access token for Instagram account', {
                instagramAccountId: accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined,
                    code: error instanceof BaseAppError ? error.code : ErrorCode.UNKNOWN_ERROR,
                },
            })

            throw new BaseAppError(
                `Failed to update access token for Instagram account with ${accountId}`,
                ErrorCode.BAD_REQUEST,
                500
            )
        }
    }

    async updatePinterestAccessToken(accountId: string, accessToken: string, refreshToken: string): Promise<void> {
        try {
            const {
                PINTEREST_APP_ID,
                PINTEREST_APP_SECRET,
                PINTEREST_REDIRECT_URL,
                PINTEREST_API_URL,
                PINTEREST_API_VERSION,
            } = process.env

            if (
                !PINTEREST_APP_ID ||
                !PINTEREST_APP_SECRET ||
                !PINTEREST_REDIRECT_URL ||
                !PINTEREST_API_URL ||
                !PINTEREST_API_VERSION
            ) {
                throw new BaseAppError('Missing Pinterest environment variables', ErrorCode.BAD_REQUEST, 400)
            }

            const formData = qs.stringify({
                grant_type: 'refresh_token',
                redirect_uri: `${process.env.BACKEND_URL}${PINTEREST_REDIRECT_URL}`,
                continuous_refresh: true,
                refresh_token: refreshToken,
            })

            // Create Basic Auth header with client credentials
            const credentials = Buffer.from(`${PINTEREST_APP_ID}:${PINTEREST_APP_SECRET}`).toString('base64')

            const { data } = await axios.post(`${PINTEREST_API_URL}/${PINTEREST_API_VERSION}/oauth/token`, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${credentials}`,
                },
            })

            const { access_token, refresh_token, refresh_token_expires_in, refresh_token_expires_at, expires_in } = data

            const tokenExpiresIn = new Date(Date.now() + expires_in * 1000)
            const refreshTokenExpiresIn = new Date(Date.now() + refresh_token_expires_in * 1000)

            await this.accountRepository.updateAccessTokenByAccountId(
                accountId,
                tokenExpiresIn,
                access_token,
                refresh_token,
                refreshTokenExpiresIn
            )
        } catch (error: unknown) {
            if (error instanceof AxiosError) {
                handleAxiosErrors(error, this.logger)
            }

            this.logger.error('Error while updating access token for Pinterest account', {
                pinterestAccountId: accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined,
                    code: error instanceof BaseAppError ? error.code : ErrorCode.UNKNOWN_ERROR,
                },
            })

            throw new BaseAppError(
                `Failed to update access token for Pinterest account with ${accountId}`,
                ErrorCode.BAD_REQUEST,
                500
            )
        }
    }

    async updateTikTokAccessToken(accountId: string, accessToken: string, refreshToken: string): Promise<void> {
        try {
            const { TIKTOK_APP_ID, TIKTOK_APP_SECRET } = process.env

            if (!TIKTOK_APP_ID || !TIKTOK_APP_SECRET) {
                throw new BaseAppError('Missing TikTok environment variables', ErrorCode.BAD_REQUEST, 400)
            }

            const formData = qs.stringify({
                client_key: TIKTOK_APP_ID,
                client_secret: TIKTOK_APP_SECRET,
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
            })

            const { data } = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            })

            this.logger.debug('NEW TIKTOK TOKEN: ', { data })

            const { access_token, refresh_token, expires_in, refresh_expires_in } = data

            const refreshTokenExpiresIn = new Date(Date.now() + refresh_expires_in * 1000)
            const tokenExpiresIn = new Date(Date.now() + expires_in * 1000)

            await this.accountRepository.updateAccessTokenByAccountId(
                accountId,
                tokenExpiresIn,
                access_token,
                refresh_token,
                refreshTokenExpiresIn
            )
        } catch (error: unknown) {
            if (error instanceof AxiosError) {
                handleAxiosErrors(error, this.logger)
            }

            this.logger.error('Error while updating access token for Instagram account', {
                tikTokAccountId: accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined,
                    code: error instanceof BaseAppError ? error.code : ErrorCode.UNKNOWN_ERROR,
                },
            })

            throw new BaseAppError(
                `Failed to update access token for TikTok account with ${accountId}`,
                ErrorCode.BAD_REQUEST,
                500
            )
        }
    }

    async updateYouTubeAccessToken(accountId: string, accessToken: string, refreshToken: string): Promise<void> {
        try {
            const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env

            if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
                throw new BaseAppError('Missing YouTube environment variables', ErrorCode.BAD_REQUEST, 400)
            }

            const formData = qs.stringify({
                client_id: GOOGLE_CLIENT_ID,
                client_secret: GOOGLE_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: 'refresh_token',
            })

            const { data } = await axios.post('https://oauth2.googleapis.com/token', formData, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            })

            const { access_token, refresh_token, expires_in, refresh_token_expires_in } = data

            const tokenExpiresIn = new Date(Date.now() + expires_in * 1000)
            const refreshTokenExpiresIn = new Date(Date.now() + refresh_token_expires_in * 1000)

            await this.accountRepository.updateAccessTokenByAccountId(
                accountId,
                tokenExpiresIn,
                access_token,
                refresh_token,
                refreshTokenExpiresIn
            )
        } catch (error: unknown) {
            if (error instanceof AxiosError) {
                handleAxiosErrors(error, this.logger)
            }

            this.logger.error('Error while updating access token for YouTube account', {
                threadsAccountId: accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined,
                    code: error instanceof BaseAppError ? error.code : ErrorCode.UNKNOWN_ERROR,
                },
            })

            throw new BaseAppError(
                `Failed to update access token for YouTube account with ${accountId}`,
                ErrorCode.BAD_REQUEST,
                500
            )
        }
    }

    async updateXAccessToken(accountId: string, accessToken: string, refreshToken: string): Promise<void> {
        try {
            const { X_APP_ID, X_APP_SECRET } = process.env

            if (!X_APP_ID || !X_APP_SECRET) {
                throw new BaseAppError('Missing X environment variables', ErrorCode.BAD_REQUEST, 400)
            }

            const formData = qs.stringify({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: X_APP_ID,
            })

            const credentials = Buffer.from(`${X_APP_ID}:${X_APP_SECRET}`).toString('base64')

            const { data } = await axios.post('https://api.twitter.com/2/oauth2/token', formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${credentials}`,
                },
            })

            const { access_token, refresh_token, expires_in } = data

            const tokenExpiresIn = new Date(Date.now() + expires_in * 1000)
            this.logger.info('NEW X ACCESS TOKEN: ', { token: access_token })

            await this.accountRepository.updateAccessTokenByAccountId(
                accountId,
                tokenExpiresIn,
                access_token,
                refresh_token,
                null
            )
        } catch (error: unknown) {
            if (error instanceof AxiosError) {
                handleAxiosErrors(error, this.logger)
            }

            this.logger.error('Error while updating access token for X account', {
                xAccountId: accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined,
                    code: error instanceof BaseAppError ? error.code : ErrorCode.UNKNOWN_ERROR,
                },
            })

            throw new BaseAppError(
                `Failed to update access token for X account with ${accountId}`,
                ErrorCode.BAD_REQUEST,
                500
            )
        }
    }

    async updateFacebookAccessToken(accountId: string, accessToken: string): Promise<void> {
        try {
            const { FB_APP_ID, FB_APP_SECRET } = process.env
            if (!FB_APP_ID || !FB_APP_SECRET) {
                throw new BaseAppError('Missing Facebook environment variables', ErrorCode.BAD_REQUEST, 400)
            }

            const { data } = await axios.get('https://graph.facebook.com/v18.0/oauth/access_token', {
                params: {
                    grant_type: 'fb_exchange_token',
                    client_id: FB_APP_ID,
                    client_secret: FB_APP_SECRET,
                    fb_exchange_token: accessToken,
                },
            })

            const FACEBOOK_TOKEN_EXPIRY_SECONDS = 5183944
            const tokenExpiresIn = new Date(Date.now() + FACEBOOK_TOKEN_EXPIRY_SECONDS * 1000)

            const { access_token } = data

            await this.accountRepository.updateAccessTokenByAccountId(
                accountId,
                tokenExpiresIn,
                access_token,
                '', // Facebook doesn't use refresh tokens
                null
            )
        } catch (error: unknown) {
            if (error instanceof AxiosError) {
                handleAxiosErrors(error, this.logger)
            }

            this.logger.error('Error while updating access token for Facebook account', {
                facebookAccountId: accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined,
                    code: error instanceof BaseAppError ? error.code : ErrorCode.UNKNOWN_ERROR,
                },
            })

            throw new BaseAppError(
                `Failed to update access token for Facebook account with ${accountId}`,
                ErrorCode.BAD_REQUEST,
                500
            )
        }
    }

    async findExpiringAccessTokensAndUpdate(): Promise<{ accountIds: string[] }> {
        try {
            const { accountsSnapshots } = await this.accountRepository.findAccountsWithExpiringAccessTokens()

            if (accountsSnapshots.length === 0) {
                this.logger.info('No need to update any social account')
                return { accountIds: [] }
            }

            const results = await Promise.allSettled(
                accountsSnapshots.map((account) =>
                    this.updateAccessToken(
                        account.id,
                        account.platform,
                        account.accessToken,
                        account.refreshToken ?? undefined
                    )
                )
            )

            const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')

            if (failures.length > 0) {
                const errorDetails = failures.map((failure, index) => ({
                    accountId: accountsSnapshots[index]?.id,
                    platform: accountsSnapshots[index]?.platform,
                    reason:
                        failure.reason instanceof Error
                            ? failure.reason.message
                            : typeof failure.reason === 'object' && 'message' in failure.reason
                              ? (failure.reason as any).message
                              : String(failure.reason),
                }))

                this.logger.error('Errors while updating access tokens', {
                    failures: errorDetails,
                })

                throw new BaseAppError(
                    `Failed to update tokens for ${failures.length} account(s)`,
                    ErrorCode.UNKNOWN_ERROR,
                    500
                )
            }

            return { accountIds: [] }
        } catch (error: unknown) {
            this.logger.error('Failed to find and update', {
                operation: 'findExpiringAccessTokensAndUpdate',
                entity: 'Account',
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw error
        }
    }
}
