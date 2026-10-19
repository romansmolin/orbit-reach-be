export type AiCreditChangeReason = 'purchase' | 'generation' | 'refund'

export interface IAiCreditsRepository {
    getBalance(tenantId: string): Promise<number>
    /** Returns false when `reference` was already applied, so callers can retry safely. */
    credit(tenantId: string, amount: number, reason: AiCreditChangeReason, reference?: string): Promise<boolean>
    /** Returns false when the balance is lower than `amount`; nothing is deducted then. */
    tryDebit(tenantId: string, amount: number): Promise<boolean>
}
