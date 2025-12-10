import { Account, SocialTokenSnapshot } from '../../entities/account'
import { PinterestBoard } from '../../entities/pinterest-board'

export interface IAccountRepository {
    save(account: Account): Promise<Account>
    findByTenantPlatformAndPage(tenantId: string, platform: string, pageId: string): Promise<Account | null>
    updateAccountByTenantPlatformAndPage(params: {
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
    }): Promise<Account>
    findByUserId(userId: string): Promise<Account[]>
    findByUserIdAndType(userId: string, type: string): Promise<Account[]>
    getAllAccounts(userId: string): Promise<Account[]>
    updateAccessToken(userId: string, pageId: string, newAccessToken: string): Promise<Account>
    deleteAccount(userId: string, accountId: string): Promise<boolean>
    getAccountById(userId: string, accountId: string): Promise<Account | null>
    getAccountByUserIdAndSocialAccountId(
        tenantId: string,
        socialAccountId: string
    ): Promise<{
        accessToken: string
        pageId: string
        refreshToken?: string | null
        expiresIn?: Date | null
        refreshExpiresIn?: Date | null
        maxVideoPostDurationSec?: number | null
        privacyLevelOptions?: string[] | null
    }>
    findAccountsWithExpiringAccessTokens(): Promise<{ accountsSnapshots: SocialTokenSnapshot[] }>
    updateAccessTokenByAccountId(
        accountId: string,
        expiresIn: Date | null,
        accessToken: string,
        refreshToken: string | null,
        refreshTokenExpiresIn?: Date | null
    ): Promise<{ success: boolean }>
    savePinterestBoard(board: PinterestBoard): Promise<PinterestBoard>
    deletePinterestBoardsByAccountId(socialAccountId: string): Promise<{ success: boolean }>
    getPinterestBoards(tenantId: string, socialAccountId: string): Promise<PinterestBoard[]>
}
