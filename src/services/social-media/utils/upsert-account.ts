import { Account } from "@/entities/account";
import { IAccountRepository } from "@/repositories/account-repository";
import { IAccountsService } from "@/services/accounts-service";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import { BaseAppError } from "@/shared/errors/base-error";

export const upsertAccount = async (account: Account, accountRepository: IAccountRepository, accountsService: IAccountsService): Promise<{ isNew: boolean; account: Account }> => {
	try {
        const existingAccount = await accountRepository.findByTenantPlatformAndPage(
            account.tenantId,
            account.platform,
            account.pageId
        )

		if (existingAccount) {
            const updatedAccount = await accountRepository.updateAccountByTenantPlatformAndPage({
                tenantId: account.tenantId,
                platform: account.platform,
                pageId: account.pageId,
                username: account.username,
                accessToken: account.accessToken,
                connectedAt: account.connectedAt instanceof Date ? account.connectedAt : new Date(account.connectedAt),
                picture: account.picture,
                refreshToken: account.refreshToken ?? null,
                expiresIn: account.expiresIn ?? null,
                refreshExpiresIn: account.refreshExpiresIn ?? null,
                maxVideoPostDurationSec: account.maxVideoPostDurationSec ?? null,
                privacyLevelOptions: account.privacyLevelOptions ?? null,
            })

            return { isNew: false, account: updatedAccount }
        }

		await accountsService.ensureAccountLimit(account.tenantId)
        const createdAccount = await accountRepository.save(account)
        await accountsService.incrementConnectedAccountsUsage(account.tenantId)


        return { isNew: true, account: createdAccount }

	} catch (err: unknown) {
		throw new BaseAppError(`Failed to upsert account: ${account}`, ErrorCode.BAD_REQUEST, 500)
	}
}
