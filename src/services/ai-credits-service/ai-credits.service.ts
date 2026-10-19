import { IAiCreditsRepository } from '@/repositories/ai-credits-repository'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { IAiCreditsService } from './ai-credits.service.interface'

export class AiCreditsService implements IAiCreditsService {
    constructor(private readonly repository: IAiCreditsRepository) {}

    getBalance(tenantId: string): Promise<number> {
        return this.repository.getBalance(tenantId)
    }

    async grantForPurchase(tenantId: string, credits: number, paymentId: string): Promise<void> {
        if (credits <= 0) return

        await this.repository.credit(tenantId, credits, 'purchase', `payment:${paymentId}`)
    }

    async spend(tenantId: string, credits: number): Promise<void> {
        const isDebited = await this.repository.tryDebit(tenantId, credits)

        if (!isDebited) {
            throw new BaseAppError(
                `Not enough AI credits. ${credits} required.`,
                ErrorCode.INSUFFICIENT_AI_CREDITS,
                402
            )
        }
    }

    async refund(tenantId: string, credits: number): Promise<void> {
        await this.repository.credit(tenantId, credits, 'refund')
    }
}
