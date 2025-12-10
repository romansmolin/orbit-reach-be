import { Pool } from 'pg'
import { pgClient } from '../../db-connection'
import { Account, SocialTokenSnapshot } from '../../entities/account'
import { PinterestBoard } from '../../entities/pinterest-board'
import { BaseAppError } from '../../shared/errors/base-error'
import type { ILogger } from '../../shared/infra/logger/logger.interface'
import type { IAccountRepository } from './accounts.repository.interface'
import { ErrorCode } from '../../shared/consts/error-codes.const'
import { encryptSecret, decryptSecret } from '@/shared/utils/secret-crypto'

export class AccountRepository implements IAccountRepository {
    private client: Pool
    private logger: ILogger

    constructor(logger: ILogger) {
        this.client = pgClient()
        this.logger = logger
    }

    private encryptToken(token?: string | null): string | null {
        if (!token) return token ?? null

        try {
            return encryptSecret(token)
        } catch (error) {
            this.logger.error('Failed to encrypt social token', {
                operation: 'encrypt_social_token',
                entity: 'Account',
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                },
            })
            throw new BaseAppError('Unable to secure social credential', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    private encryptRequiredToken(token: string): string {
        const encrypted = this.encryptToken(token)
        if (!encrypted) {
            throw new BaseAppError('Missing social credential', ErrorCode.UNKNOWN_ERROR, 500)
        }
        return encrypted
    }

    private decryptToken(token?: string | null): string | null {
        if (!token) return token ?? null

        try {
            return decryptSecret(token)
        } catch (error) {
            this.logger.error('Failed to decrypt social token', {
                operation: 'decrypt_social_token',
                entity: 'Account',
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                },
            })
            throw new BaseAppError('Unable to read stored credential', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    private mapRowToAccount(row: any): Account {
        const accessToken = this.decryptToken(row.access_token)

        if (!accessToken) {
            throw new BaseAppError('Access token is missing for social account', ErrorCode.UNKNOWN_ERROR, 500)
        }

        return new Account(
            row.id,
            row.tenant_id,
            row.platform,
            row.username,
            accessToken,
            row.connected_date,
            row.page_id,
            row.picture || undefined,
            this.decryptToken(row.refresh_token || null) || undefined,
            row.expires_in || null,
            row.refresh_expires_in || null,
            row.max_video_post_duration_sec ?? null,
            Array.isArray(row.privacy_level_options) ? row.privacy_level_options : null
        )
    }

    private getBlueskyAccessTokenExpiry(): Date {
        const ttlMinutes = Number(process.env.BLUESKY_ACCESS_TOKEN_TTL_MINUTES || '55')
        return new Date(Date.now() + ttlMinutes * 60 * 1000)
    }

    async save(account: Account): Promise<Account> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            const expiresIn =
                account.platform === 'bluesky' && !account.expiresIn
                    ? this.getBlueskyAccessTokenExpiry()
                    : account.expiresIn

            const encryptedAccessToken = this.encryptRequiredToken(account.accessToken)
            const encryptedRefreshToken = this.encryptToken(account.refreshToken ?? null)

            const result = await client.query(
                `INSERT INTO social_accounts (
                    id,
                    tenant_id,
                    platform,
                    username,
                    access_token,
                    connected_date,
                    page_id,
                    picture,
                    refresh_token,
                    expires_in,
                    refresh_expires_in,
                    max_video_post_duration_sec,
                    privacy_level_options
                 )
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                 RETURNING *`,
                [
                    account.id,
                    account.tenantId,
                    account.platform,
                    account.username,
                    encryptedAccessToken,
                    account.connectedAt,
                    account.pageId,
                    account.picture,
                    encryptedRefreshToken,
                    expiresIn,
                    account.refreshExpiresIn,
                    account.maxVideoPostDurationSec ?? null,
                    account.privacyLevelOptions ?? null,
                ]
            )

            await client.query('COMMIT')

            const savedAccount = result.rows[0]

            return this.mapRowToAccount(savedAccount)
        } catch (error: any) {
            await client.query('ROLLBACK')

            throw new BaseAppError(`Unknown error while saving social account: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async findByTenantPlatformAndPage(tenantId: string, platform: string, pageId: string): Promise<Account | null> {
        try {
            const result = await this.client.query(
                `SELECT * FROM social_accounts WHERE tenant_id = $1 AND platform = $2 AND page_id = $3 LIMIT 1`,
                [tenantId, platform, pageId]
            )

            if (result.rows.length === 0) {
                return null
            }

            const row = result.rows[0]

            return this.mapRowToAccount(row)
        } catch (error) {
            this.logger.error('Failed to find account by tenant/platform/page', {
                operation: 'find_by_tenant_platform_page',
                entity: 'Account',
                tenantId,
                platform,
                pageId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })

            throw new BaseAppError(`Failed to find account: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async findByUserId(userId: string): Promise<Account[]> {
        try {
            const result = await this.client.query(`SELECT * FROM social_accounts WHERE tenant_id = $1`, [userId])

            return result.rows.map((row) => this.mapRowToAccount(row))
        } catch (error) {
            this.logger.error('Failed to find accounts by user ID', {
                operation: 'find_by_user_id',
                entity: 'Account',
                userId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError(`Failed to find accounts: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async updateAccountByTenantPlatformAndPage(params: {
        tenantId: string
        platform: string
        pageId: string
        username: string
        accessToken: string
        connectedAt: Date | string
        picture?: string
        refreshToken?: string | null
        expiresIn?: Date | null
        refreshExpiresIn?: Date | null
        maxVideoPostDurationSec?: number | null
        privacyLevelOptions?: string[] | null
    }): Promise<Account> {
        const {
            tenantId,
            platform,
            pageId,
            username,
            accessToken,
            connectedAt,
            picture,
            refreshToken = null,
            expiresIn = null,
            refreshExpiresIn = null,
            maxVideoPostDurationSec = null,
            privacyLevelOptions = null,
        } = params

        const client = await this.client.connect()

        try {
            await client.query('BEGIN')

            const encryptedAccessToken = this.encryptRequiredToken(accessToken)
            const encryptedRefreshToken = this.encryptToken(refreshToken ?? null)

            const result = await client.query(
                `UPDATE social_accounts
                 SET username = $1,
                     access_token = $2,
                     connected_date = $3,
                     picture = COALESCE($4, picture),
                     refresh_token = $5,
                     expires_in = $6,
                     refresh_expires_in = $7,
                     max_video_post_duration_sec = COALESCE($8, max_video_post_duration_sec),
                     privacy_level_options = COALESCE($9, privacy_level_options)
                 WHERE tenant_id = $10 AND platform = $11 AND page_id = $12
                 RETURNING *`,
                [
                    username,
                    encryptedAccessToken,
                    connectedAt,
                    picture ?? null,
                    encryptedRefreshToken,
                    expiresIn,
                    refreshExpiresIn,
                    maxVideoPostDurationSec,
                    privacyLevelOptions,
                    tenantId,
                    platform,
                    pageId,
                ]
            )

            if (result.rows.length === 0) {
                throw new BaseAppError('Account not found', ErrorCode.NOT_FOUND, 404)
            }

            await client.query('COMMIT')

            const updatedAccount = result.rows[0]

            return this.mapRowToAccount(updatedAccount)
        } catch (error) {
            await client.query('ROLLBACK')

            this.logger.error('Failed to update social account by tenant/platform/page', {
                operation: 'update_by_tenant_platform_page',
                entity: 'Account',
                tenantId,
                platform,
                pageId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError(`Failed to update account: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async findByUserIdAndType(userId: string, type: string): Promise<Account[]> {
        try {
            const result = await this.client.query(
                `SELECT * FROM social_accounts WHERE tenant_id = $1 AND platform = $2`,
                [userId, type]
            )

            return result.rows.map((row) => this.mapRowToAccount(row))
        } catch (error) {
            this.logger.error('Failed to find accounts by user ID and type', {
                operation: 'find_by_user_id_and_type',
                entity: 'Account',
                userId,
                type,
                error: {
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError(`Failed to find accounts: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async getAllAccounts(userId: string): Promise<Account[]> {
        try {
            const accounts = await this.client.query(`SELECT * FROM social_accounts WHERE tenant_id = $1`, [userId])

            return accounts.rows.map((row) => this.mapRowToAccount(row))
        } catch (error) {
            const errorCode = error instanceof BaseAppError ? error.code : 'UNKNOWN'

            this.logger.error('Failed to get all accounts', {
                operation: 'get_all_accounts',
                entity: 'Account',
                userId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: errorCode,
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError(`Failed to fetch accounts: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async updateAccessToken(userId: string, pageId: string, newAccessToken: string): Promise<Account> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            const encryptedToken = this.encryptRequiredToken(newAccessToken)

            const result = await client.query(
                `UPDATE social_accounts 
                 SET access_token = $1
                 WHERE tenant_id = $2 AND page_id = $3
                 RETURNING *`,
                [encryptedToken, userId, pageId]
            )

            if (result.rows.length === 0) {
                throw new BaseAppError('Account not found', ErrorCode.NOT_FOUND, 404)
            }

            await client.query('COMMIT')

            const updatedAccount = result.rows[0]

            return this.mapRowToAccount(updatedAccount)
        } catch (error) {
            await client.query('ROLLBACK')
            const errorCode = error instanceof BaseAppError ? error.code : 'UNKNOWN'
            this.logger.error('Failed to update access token', {
                operation: 'update_access_token',
                entity: 'Account',
                userId,
                pageId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: errorCode,
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError(
                `Unknown error while updating access token for social account: ${error}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        } finally {
            client.release()
        }
    }

    async deleteAccount(userId: string, accountId: string): Promise<boolean> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            const result = await client.query(
                `DELETE FROM social_accounts 
                 WHERE tenant_id = $1 AND id = $2
                 RETURNING *`,
                [userId, accountId]
            )

            if (result.rows.length === 0) {
                throw new BaseAppError('Account not found', ErrorCode.NOT_FOUND, 404)
            }

            await client.query('COMMIT')
            return true
        } catch (error) {
            await client.query('ROLLBACK')
            this.logger.error('Failed to delete account', {
                operation: 'delete_account',
                entity: 'Account',
                userId,
                accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError(`Failed to delete account: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getAccountById(userId: string, accountId: string): Promise<Account | null> {
        try {
            const result = await this.client.query(`SELECT * FROM social_accounts WHERE tenant_id = $1 AND id = $2`, [
                userId,
                accountId,
            ])
            if (result.rows.length === 0) return null
            const row = result.rows[0]
            return this.mapRowToAccount(row)
        } catch (error) {
            this.logger.error('Failed to get account by id', {
                operation: 'get_account_by_id',
                entity: 'Account',
                userId,
                accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError(`Failed to get account by id: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async getAccountByUserIdAndSocialAccountId(
        tenantId: string,
        socialAccountId: string
    ): Promise<{
        accessToken: string
        pageId: string
        refreshToken?: string | null
        expiresIn?: Date | null
        refreshExpiresIn?: Date | null
		maxVideoPostDurationSec?: number
		privacyLevelOptions?: string[]
    }> {
        try {
            const result = await this.client.query(
                `SELECT access_token, page_id, refresh_token, expires_in, refresh_expires_in, max_video_post_duration_sec, privacy_level_options
                 FROM social_accounts 
                 WHERE tenant_id = $1 AND id = $2`,
                [tenantId, socialAccountId]
            )

            if (result.rows.length === 0) {
                throw new BaseAppError('Social account not found', ErrorCode.NOT_FOUND, 404)
            }

            const row = result.rows[0]

            const accessToken = this.decryptToken(row.access_token)
            if (!accessToken) {
                throw new BaseAppError('Access token is missing for social account', ErrorCode.UNKNOWN_ERROR, 500)
            }

            return {
                accessToken,
                pageId: row.page_id,
                refreshToken: this.decryptToken(row.refresh_token) || null,
                expiresIn: row.expires_in,
                refreshExpiresIn: row.refresh_expires_in,
                maxVideoPostDurationSec: row.max_video_post_duration_sec ?? null,
                privacyLevelOptions: Array.isArray(row.privacy_level_options) ? row.privacy_level_options : null,
            }
        } catch (error) {
            this.logger.error('Failed to get account by tenant ID and social account ID', {
                operation: 'get_account_by_tenant_and_social_id',
                entity: 'Account',
                tenantId,
                socialAccountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })

            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError('Failed to get social account access token', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async findAccountsWithExpiringAccessTokens(): Promise<{ accountsSnapshots: SocialTokenSnapshot[] }> {
        const client = await this.client.connect()

        try {
            client.query('BEGIN')

            const result = await client.query(
                `SELECT * FROM social_accounts
                WHERE (
                    platform IN ('facebook', 'instagram', 'threads', 'pinterest')
                    AND expires_in < NOW() + INTERVAL '10 days'
                ) OR (
                    platform = 'tiktok'
                    AND expires_in < NOW() + INTERVAL '5 minutes'
                ) OR (
                    platform = 'youtube'
                    AND expires_in < NOW() + INTERVAL '5 minutes'
                ) OR (
                    platform = 'x'
                    AND expires_in < NOW() + INTERVAL '5 minutes'
                ) OR (
                    platform = 'bluesky'
                    AND (expires_in IS NULL OR expires_in < NOW() + INTERVAL '15 minutes')
                )`
            )

            const accountsSnapshots = result.rows.map((row) => {
                const accessToken = this.decryptToken(row.access_token)
                if (!accessToken) {
                    throw new BaseAppError('Access token is missing for social account', ErrorCode.UNKNOWN_ERROR, 500)
                }

                return new SocialTokenSnapshot(
                    row.id,
                    row.platform,
                    accessToken,
                    this.decryptToken(row.refresh_token) || null
                )
            })

            return {
                accountsSnapshots,
            }
        } catch (error: unknown) {
            client.query('ROLLBACK')
            this.logger.error('Failed to delete account', {
                operation: 'find_accounts_with_expiring_access_tokens',
                entity: 'Account',
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })

            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError(
                `Failed to find accounts with expiring access tokens: ${error}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        } finally {
            client.release()
        }
    }

    async updateAccessTokenByAccountId(
        accountId: string,
        expiresIn: Date | null,
        accessToken: string,
        refreshToken: string | null,
        refreshTokenExpiresIn: Date | null = null
    ): Promise<{ success: boolean }> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            const encryptedAccessToken = this.encryptRequiredToken(accessToken)
            const encryptedRefreshToken = this.encryptToken(refreshToken)

            const result = await client.query(
                `UPDATE social_accounts 
                 SET access_token = $1,
                     refresh_token = $2,
                     expires_in = $3,
                     refresh_expires_in = $4
                 WHERE id = $5
                 RETURNING *`,
                [encryptedAccessToken, encryptedRefreshToken, expiresIn, refreshTokenExpiresIn, accountId]
            )

            if (result.rows.length === 0) {
                throw new BaseAppError('Account not found', ErrorCode.NOT_FOUND, 404)
            }

            await client.query('COMMIT')

            return { success: true }
        } catch (error: unknown) {
            await client.query('ROLLBACK')

            this.logger.error('Failed to update access token by account ID', {
                operation: 'update_access_token_by_account_id',
                entity: 'Account',
                accountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })

            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError(
                `Failed to update access token for ${accountId}: ${error}`,
                ErrorCode.UNKNOWN_ERROR,
                500
            )
        } finally {
            client.release()
        }
    }

    async savePinterestBoard(board: PinterestBoard): Promise<PinterestBoard> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            const result = await client.query(
                `INSERT INTO pinterest_boards (id, tenant_id, social_account_id, pinterest_board_id, name, description, owner_username, thumbnail_url, privacy, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 ON CONFLICT (tenant_id, pinterest_board_id) 
                 DO UPDATE SET 
                    name = EXCLUDED.name,
                    description = EXCLUDED.description,
                    owner_username = EXCLUDED.owner_username,
                    thumbnail_url = EXCLUDED.thumbnail_url,
                    privacy = EXCLUDED.privacy,
                    updated_at = EXCLUDED.updated_at
                 RETURNING *`,
                [
                    board.id,
                    board.tenantId,
                    board.socialAccountId,
                    board.pinterestBoardId,
                    board.name,
                    board.description,
                    board.ownerUsername,
                    board.thumbnailUrl,
                    board.privacy,
                    board.createdAt,
                    board.updatedAt,
                ]
            )

            await client.query('COMMIT')

            const savedBoard = result.rows[0]
            return new PinterestBoard(
                savedBoard.id,
                savedBoard.tenant_id,
                savedBoard.social_account_id,
                savedBoard.pinterest_board_id,
                savedBoard.name,
                savedBoard.description,
                savedBoard.owner_username,
                savedBoard.thumbnail_url,
                savedBoard.privacy,
                savedBoard.created_at,
                savedBoard.updated_at
            )
        } catch (error) {
            await client.query('ROLLBACK')
            this.logger.error('Failed to save Pinterest board', {
                operation: 'save_pinterest_board',
                entity: 'PinterestBoard',
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError(`Failed to save Pinterest board: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async deletePinterestBoardsByAccountId(socialAccountId: string): Promise<{ success: boolean }> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            const result = await client.query(`DELETE FROM pinterest_boards WHERE social_account_id = $1`, [
                socialAccountId,
            ])

            await client.query('COMMIT')

            this.logger.info('Deleted Pinterest boards for account', {
                operation: 'delete_pinterest_boards_by_account_id',
                entity: 'PinterestBoard',
                socialAccountId,
                deletedCount: result.rowCount,
            })

            return { success: true }
        } catch (error) {
            await client.query('ROLLBACK')
            this.logger.error('Failed to delete Pinterest boards by account ID', {
                operation: 'delete_pinterest_boards_by_account_id',
                entity: 'PinterestBoard',
                socialAccountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError(`Failed to delete Pinterest boards: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getPinterestBoards(tenantId: string, socialAccountId: string): Promise<PinterestBoard[]> {
        try {
            const result = await this.client.query(
                `SELECT *
                 FROM pinterest_boards
                 WHERE tenant_id = $1
                   AND social_account_id = $2
                   AND (privacy IS NULL OR UPPER(privacy) <> 'SECRET')
                 ORDER BY created_at DESC`,
                [tenantId, socialAccountId]
            )

            return result.rows.map(
                (row) =>
                    new PinterestBoard(
                        row.id,
                        row.tenant_id,
                        row.social_account_id,
                        row.pinterest_board_id,
                        row.name,
                        row.description,
                        row.owner_username,
                        row.thumbnail_url,
                        row.privacy,
                        row.created_at,
                        row.updated_at
                    )
            )
        } catch (error) {
            this.logger.error('Failed to get Pinterest boards', {
                operation: 'get_pinterest_boards',
                entity: 'PinterestBoard',
                tenantId,
                socialAccountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown Error',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError(`Failed to get Pinterest boards: ${error}`, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }
}
