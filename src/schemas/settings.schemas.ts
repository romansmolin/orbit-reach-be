import z from 'zod'
import { isValidTimeZone } from '@/shared/infra/timezone/timezone.utils'

export const tenantTimezoneSchema = z
    .object({
        timezone: z
            .string()
            .trim()
            .min(1, 'Timezone is required')
            .refine((val) => isValidTimeZone(val), 'Provided timezone is not supported'),
    })
    .strict()

export type TenantTimezoneSchema = z.infer<typeof tenantTimezoneSchema>
