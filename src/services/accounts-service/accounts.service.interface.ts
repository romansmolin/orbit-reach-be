import type { AccountSchema } from '../../schemas/account.schemas'
import { PinterestBoard } from '../../entities/pinterest-board'

export interface FacebookPage {
    id: string
    name: string
    access_token: string
    picture: {
        data: {
            url: string
        }
    }
}

export interface IAccountsService {
    getAllAccounts(userId: string): Promise<AccountSchema[]>
    deleteAccount(userId: string, accountId: string): Promise<{ success: boolean }>
    getPinterestBoards(userId: string, socialAccountId: string): Promise<PinterestBoard[]>
    ensureAccountLimit(userId: string): Promise<void>
    incrementConnectedAccountsUsage(userId: string): Promise<void>
    decrementConnectedAccountsUsage(userId: string): Promise<void>
}
