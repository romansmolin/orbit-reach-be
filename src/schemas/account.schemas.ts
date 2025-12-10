import { z } from 'zod'

export const accountSchema = z.object({
    id: z.string().uuid(),
    platform: z.string(),
    username: z.string(),
    tenantId: z.string().uuid(),
    picture: z.string().nullable().optional(),
    connectedAt: z.coerce.date(),
    refreshToken: z.string().optional().nullable(),
    maxVideoPostDurationSec: z.number().nullable().optional(),
    privacyLevelOptions: z.array(z.string()).nullable().optional(),
})

export type AccountSchema = z.infer<typeof accountSchema>

// Helper function to transform Account entity to schema-validated object
export const transformAccount = (account: any) => {
    return accountSchema.parse(account)
}

// Helper function to transform multiple accounts
export const transformAccounts = (accounts: any[]) => {
    return accounts.map(transformAccount)
}
