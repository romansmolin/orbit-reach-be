import z from 'zod'

export const contactRequestSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, 'Name should contain at least 2 characters')
        .max(100, 'Name should not exceed 100 characters'),
    email: z
        .string()
        .trim()
        .email('Email address is not valid')
        .max(255, 'Email should not exceed 255 characters'),
    message: z
        .string()
        .trim()
        .min(10, 'Message should contain at least 10 characters')
        .max(2000, 'Message should not exceed 2000 characters'),
})

export type ContactRequestPayload = z.infer<typeof contactRequestSchema>
