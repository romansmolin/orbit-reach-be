export interface IAiCreditsService {
    getBalance(tenantId: string): Promise<number>
    grantForPurchase(tenantId: string, credits: number, paymentId: string): Promise<void>
    /** Throws INSUFFICIENT_AI_CREDITS (402) without deducting anything when the balance is too low. */
    spend(tenantId: string, credits: number): Promise<void>
    refund(tenantId: string, credits: number): Promise<void>
}
