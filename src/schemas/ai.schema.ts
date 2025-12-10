import z from 'zod'
import { SocilaMediaPlatform } from './posts.schemas'

export enum AiTone {
    FRIENDLY = 'friendly',
    PROFESSIONAL = 'professional',
    INFORMATIVE = 'informative',
    HUMOROUS = 'humorous',
    INSPIRATIONAL = 'inspirational',
    EMPHATHETIC = 'empathetic',
    AUTHORITATIVE = 'authoritative',
    PLAYFUL = 'playful',
    EDUCATIONAL = 'educational',
    URGENT = 'urgent',
}

const Account = z.object({
    id: z.uuid('Invalid UUID format for account'),
    platform: z.enum(
        SocilaMediaPlatform,
        'We can except only tiktok,threads, x, instagram, facebook, pinterest, bluesky, youtube'
    ),
})

export const aiApiPayloadSchema = z.object({
    tone: z.enum(
        AiTone,
        'We expect the following values: friendly, professional,informative,humorous,inspirational ,empathetic, authoritative, playful, educational, urgent'
    ),
    language: z.string(),
    includeHashtags: z.boolean().optional(),
    notesForAi: z
        .string()
        .trim()
        .min(10, 'The minimal lenght is 10 characters')
        .max(500, 'The maximal lenght is 500 symbols')
        .optional(),
    selectedAccounts: z.array(Account).nonempty('At least one post is required'),
    forbiddenWords: z.array(z.string()),
})

export type AiRequest = z.infer<typeof aiApiPayloadSchema>

export const AiOutputItemSchema = z.object({
    platform: z.enum(['tiktok', 'instagram', 'threads', 'bluesky', 'linkedin', 'youtube']),
    language: z.string(),
    title: z.string().nullable(),
    text: z.string(),
    hashtags: z.array(z.string().regex(/^#[^\s#]+$/)).default([]),
    charCounts: z.object({
        title: z.number().nullable(),
        text: z.number(),
    }),
    warnings: z.array(z.string()),
})

export const AiOutputSchema = z.object({
    items: z.array(AiOutputItemSchema).nonempty(),
})

export type AiOutputItem = z.infer<typeof AiOutputItemSchema>
export type AiOutput = z.infer<typeof AiOutputSchema>
