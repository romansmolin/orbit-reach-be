import { AccountRepository } from '@/repositories/account-repository'
import { PinterestBoard } from '@/entities/pinterest-board'
import { AccountSchema, transformAccounts } from '@/schemas/account.schemas'
import { SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { BaseAppError } from '@/shared/errors/base-error'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { IMediaUploader } from '@/shared/infra/media/media-uploader.interface'
import { IAccountsService, FacebookPage } from './accounts.service.interface'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { IUserService } from '@/services/users-service/user.service.interface'
import { IPostsService } from '@/services/posts-service/posts.service.interface'

export class AccountsService implements IAccountsService {
    private accountRepository: AccountRepository
    private logger: ILogger
    private mediaUploader: IMediaUploader
    private userService: IUserService
    private postsService: IPostsService

    constructor(
        accountRepository: AccountRepository,
        logger: ILogger,
        mediaUploader: IMediaUploader,
        userService: IUserService,
        postsService: IPostsService
    ) {
        this.accountRepository = accountRepository
        this.logger = logger
        this.mediaUploader = mediaUploader
        this.userService = userService
        this.postsService = postsService
    }

    private isS3Url(url: string): boolean {
        try {
            const parsedUrl = new URL(url)
            const bucket = process.env.AWS_S3_BUCKET

            if (!bucket) {
                return parsedUrl.hostname.includes('amazonaws.com')
            }

            const normalizedHostname = parsedUrl.hostname.toLowerCase()
            return normalizedHostname === `${bucket}.s3.amazonaws.com` || normalizedHostname.startsWith(`${bucket}.s3.`)
        } catch {
            return false
        }
    }

    async getAllAccounts(userId: string): Promise<AccountSchema[]> {
        try {
            const accounts = await this.accountRepository.getAllAccounts(userId)

            return transformAccounts(accounts)
        } catch (error) {
            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError(' Failed to retrieve all accounts!', ErrorCode.BAD_REQUEST, 500)
        }
    }

    async deleteAccount(userId: string, accountId: string): Promise<{ success: boolean }> {
        try {
            const account = await this.accountRepository.getAccountById(userId, accountId)

            if (!account) {
                this.logger.warn('Account not found for deletion', {
                    operation: 'delete_account',
                    entity: 'Account',
                    userId,
                    accountId,
                })
                return { success: false }
            }

            if (account.picture && this.isS3Url(account.picture)) {
                try {
                    await this.mediaUploader.delete(account.picture)
                } catch (err) {
                    this.logger.warn('Failed to delete account image from S3', {
                        operation: 'delete_account',
                        entity: 'Account',
                        userId,
                        accountId,
                        error: {
                            name: err instanceof Error ? err.name : 'Unknown',
                            code: undefined,
                            stack: err instanceof Error ? err.stack : undefined,
                        },
                    })
                }
            }

            if (account.platform === SocilaMediaPlatform.PINTEREST) {
                try {
                    await this.accountRepository.deletePinterestBoardsByAccountId(accountId)
                } catch (err) {
                    this.logger.error('Failed to delete Pinterest boards', {
                        operation: 'delete_account',
                        entity: 'PinterestBoard',
                        userId,
                        accountId,
                        error: {
                            name: err instanceof Error ? err.name : 'Unknown',
                            code: err instanceof BaseAppError ? err.code : 'UNKNOWN',
                            stack: err instanceof Error ? err.stack : undefined,
                        },
                    })
                }
            }

            await this.postsService.deletePostsOrphanedByAccount(userId, accountId)

            const success = await this.accountRepository.deleteAccount(userId, accountId)

            if (success) {
                await this.decrementConnectedAccountsUsage(userId)
                this.logger.info('Successfully deleted account', {
                    operation: 'delete_account',
                    entity: 'Account',
                    userId,
                    accountId,
                })
            } else {
                this.logger.warn('Account not found for deletion', {
                    operation: 'delete_account',
                    entity: 'Account',
                    userId,
                    accountId,
                })
            }

            return { success }
        } catch (error) {
            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to delete account', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async getPinterestBoards(userId: string, socialAccountId: string): Promise<PinterestBoard[]> {
        try {
            const boards = await this.accountRepository.getPinterestBoards(userId, socialAccountId)
            return boards
        } catch (error) {
            this.logger.error('Failed to get Pinterest boards', {
                operation: 'get_pinterest_boards',
                entity: 'PinterestBoard',
                userId,
                socialAccountId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })

            if (error instanceof BaseAppError) throw error
            throw new BaseAppError('Failed to create post', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async ensureAccountLimit(userId: string): Promise<void> {
        const usage = await this.userService.getUsageQuota(userId)
        const { used, limit } = usage.connectedAccounts

        if (used >= limit) {
            throw new BaseAppError(
                'Account limit reached for the current plan',
                ErrorCode.PLAN_LIMIT_REACHED,
                403
            )
        }
    }

    async incrementConnectedAccountsUsage(userId: string): Promise<void> {
        await this.userService.incrementConnectedAccountsUsage(userId)
    }

    async decrementConnectedAccountsUsage(userId: string): Promise<void> {
        await this.userService.decrementConnectedAccountsUsage(userId)
    }
}
