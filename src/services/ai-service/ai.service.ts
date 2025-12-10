import { ZodError } from 'zod'
import { AiOutput, AiOutputSchema, AiRequest } from '@/schemas/ai.schema'
import { PostPlatform, SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { IApiClient } from '@/shared/infra/api'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { AiIntroductoryResult, IAiService } from './ai-service.interface'
import { IUserService } from '@/services/users-service/user.service.interface'
import { UserPlans } from '@/shared/consts/plans'

type OpenAiRole = 'system' | 'user'

interface OpenAiMessage {
    role: OpenAiRole
    content: string
}

interface OpenAiChatCompletionResponse {
    choices: Array<{
        message?: {
            content?: string | null
        }
    }>
}

type EnvLimitKey =
    | 'TIKTOK_CAPTION_LIMIT'
    | 'INSTAGRAM_CAPTION_LIMIT'
    | 'THREADS_TEXT_LIMIT'
    | 'BLUESKY_POST_CHAR_LIMIT'
    | 'LINKEDIN_TEXT_LIMIT'
    | 'YOUTUBE_DESCRIPTION_LIMIT'
    | 'YOUTUBE_TITLE_LIMIT'

type EnvLimits = Record<EnvLimitKey, string>

interface ProcessedForbiddenWord {
    original: string
    normalized: string
}

interface PlatformLimitConfig {
    text?: EnvLimitKey | null
    title?: EnvLimitKey | null
}

const SUPPORTED_PLATFORMS: ReadonlyArray<PostPlatform> = [
    SocilaMediaPlatform.TIKTOK,
    SocilaMediaPlatform.INSTAGRAM,
    SocilaMediaPlatform.THREADS,
    SocilaMediaPlatform.BLUESKY,
    SocilaMediaPlatform.LINKEDIN,
    SocilaMediaPlatform.YOUTUBE,
]

const PLATFORM_LIMIT_KEYS: Partial<Record<PostPlatform, PlatformLimitConfig>> = {
    [SocilaMediaPlatform.TIKTOK]: { text: 'TIKTOK_CAPTION_LIMIT' },
    [SocilaMediaPlatform.INSTAGRAM]: { text: 'INSTAGRAM_CAPTION_LIMIT' },
    [SocilaMediaPlatform.THREADS]: { text: 'THREADS_TEXT_LIMIT' },
    [SocilaMediaPlatform.BLUESKY]: { text: 'BLUESKY_POST_CHAR_LIMIT' },
    [SocilaMediaPlatform.LINKEDIN]: { text: 'LINKEDIN_TEXT_LIMIT' },
    [SocilaMediaPlatform.YOUTUBE]: {
        text: 'YOUTUBE_DESCRIPTION_LIMIT',
        title: 'YOUTUBE_TITLE_LIMIT',
    },
}

const AI_SYSTEM_PROMPT = `You are a content generation engine that MUST return a single JSON object ONLY, no markdown, no code fences, no prose. 
Follow the exact JSON schema and key order below. Never add extra keys. 
All strings must be plain text without markdown formatting unless explicitly requested.
Honor platform limits and constraints exactly. Rephrase to respect forbidden words.
Do not include tags right in text, we are hadling them on backend manually.

Output schema (and key order):
{
  "items": [
    {
      "platform": "tiktok" | "instagram" | "threads" | "bluesky" | "linkedin" | "youtube",
      "language": string,
      "title": string | null,
      "text": string,
      "hashtags": string[],
      "charCounts": { "title": number | null, "text": number },
      "warnings": string[]
    }
  ]
}

Platform capabilities:
- youtube: supports title + description (text). 
- tiktok: caption only (title = null).
- instagram: caption only (title = null).
- threads: text only (title = null); ALLOW MAX ONE HASHTAG total.
- bluesky: text only (title = null).
- linkedin: text only (title = null).

Hashtag rules:
- Provide relevant hashtags in target LANGUAGE when sensible.
- threads: MAX 1 hashtag.
- Others: 2–6 hashtags preferred.

Forbidden words:
- Never output words from the forbiddenWords list (case-insensitive). Rephrase if necessary.
- Add a note to "warnings" like "forbidden terms rephrased".

Length limits:
Use env values. If text exceeds limit → compress or trim gracefully, append "…" if space allows, and log a warning.

Tone & language:
- Write in the requested language and tone.
- Integrate notesForAi meaningfully but concisely.

Determinism:
- Concise, actionable, platform-native text.
- Output only valid JSON object.`

class AiResponseValidationError extends Error {
    constructor(
        message: string,
        public readonly cause?: unknown
    ) {
        super(message)
        this.name = 'AiResponseValidationError'
    }
}

export class AiService implements IAiService {
    private readonly apiClient: IApiClient
    private readonly logger: ILogger
    private readonly apiKey: string
    private readonly model: string
    private readonly envLimits: EnvLimits
    private readonly userService: IUserService

    constructor(
        apiClient: IApiClient,
        logger: ILogger,
        userService: IUserService,
        options?: { apiKey?: string; model?: string }
    ) {
        this.apiClient = apiClient
        this.logger = logger
        this.userService = userService
        this.apiKey = options?.apiKey || process.env.OPENAI_API_KEY || ''
        this.model = options?.model || process.env.OPENAI_CONTENT_MODEL || 'gpt-4o-mini'
        this.envLimits = this.loadEnvLimits()

        const missingLimits = Object.entries(this.envLimits)
            .filter(([, value]) => !value || value === 'null')
            .map(([key]) => key)

        if (missingLimits.length > 0) {
            this.logger.warn('Some platform limits are not configured', {
                operation: 'ai_generate_content',
                missingLimits,
            })
        }
    }

    async generateIntroductoryCopy(userId: string, payload: AiRequest): Promise<AiIntroductoryResult[]> {
        await this.ensureUserHasAiAccess(userId)

        if (!this.apiKey) {
            this.logger.error('OpenAI API key is not configured', {
                operation: 'ai_generate_content',
            })
            throw new BaseAppError('AI service is not configured', ErrorCode.UNKNOWN_ERROR, 500)
        }

        this.ensureSupportedPlatforms(payload)

        const maxAttempts = 2
        let lastValidationError: unknown = null

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const isRepairAttempt = attempt > 1

            try {
                const aiOutput = await this.fetchAndValidateResponse(payload, isRepairAttempt)
                const results = this.transformOutput(payload, aiOutput)
                this.ensureForbiddenCompliance(results, payload.forbiddenWords)

                this.logger.info('AI content generated successfully', {
                    operation: 'ai_generate_content',
                    attempt,
                    generatedItems: results.length,
                })

                return results
            } catch (error) {
                if (error instanceof BaseAppError) {
                    throw error
                }

                if (
                    error instanceof AiResponseValidationError ||
                    error instanceof SyntaxError ||
                    error instanceof ZodError
                ) {
                    lastValidationError = error

                    if (attempt < maxAttempts) {
                        this.logger.warn('AI response validation failed. Retrying with repair instruction.', {
                            operation: 'ai_generate_content',
                            attempt,
                            error: {
                                name: error instanceof Error ? error.name : 'UnknownError',
                                code:
                                    error instanceof BaseAppError
                                        ? error.code
                                        : error instanceof Error
                                          ? error.message
                                          : String(error),
                            },
                            details: error instanceof Error ? error.message : String(error),
                        })
                        continue
                    }
                }

                this.logger.error('Failed to generate AI content', {
                    operation: 'ai_generate_content',
                    attempt,
                    error: {
                        name: error instanceof Error ? error.name : 'UnknownError',
                        code:
                            error instanceof BaseAppError
                                ? error.code
                                : error instanceof Error
                                  ? error.message
                                  : String(error),
                    },
                    details: error instanceof Error ? error.message : String(error),
                })

                throw new BaseAppError('Failed to generate AI content', ErrorCode.UNKNOWN_ERROR, 502)
            }
        }

        this.logger.error('AI response validation failed after retries', {
            operation: 'ai_generate_content',
            error: {
                name: lastValidationError instanceof Error ? lastValidationError.name : 'UnknownError',
                code:
                    lastValidationError instanceof BaseAppError
                        ? lastValidationError.code
                        : lastValidationError instanceof Error
                          ? lastValidationError.message
                          : String(lastValidationError),
            },
            details: lastValidationError instanceof Error ? lastValidationError.message : String(lastValidationError),
        })

        throw new BaseAppError('Failed to generate AI content', ErrorCode.UNKNOWN_ERROR, 502)
    }

    private async ensureUserHasAiAccess(userId: string): Promise<void> {
        try {
            const plan = await this.userService.getUserPlan(userId)
            const normalizedPlanName = plan?.planName?.toUpperCase() as UserPlans | undefined

            if (normalizedPlanName !== UserPlans.PRO) {
                throw new BaseAppError('AI features are available only on the Pro plan', ErrorCode.FORBIDDEN, 403)
            }

            await this.userService.incrementAiUsage(userId)
        } catch (error) {
            if (error instanceof BaseAppError && error.code === ErrorCode.BAD_REQUEST) {
                throw new BaseAppError('AI features are available only on the Pro plan', ErrorCode.FORBIDDEN, 403)
            }

            throw error
        }
    }

    private async fetchAndValidateResponse(payload: AiRequest, isRepairAttempt: boolean): Promise<AiOutput> {
        const messages = this.buildMessages(payload, isRepairAttempt)

        const requestBody = {
            model: this.model,
            temperature: 0.2,
            top_p: 0.9,
            response_format: { type: 'json_object' as const },
            messages,
        }

        let response: OpenAiChatCompletionResponse

        try {
            response = await this.apiClient.post<OpenAiChatCompletionResponse, typeof requestBody>(
                '/chat/completions',
                requestBody,
                {
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                }
            )
        } catch (error) {
            this.logger.error('OpenAI API request failed', {
                operation: 'ai_generate_content',
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    code:
                        error instanceof BaseAppError
                            ? error.code
                            : error instanceof Error
                              ? error.message
                              : String(error),
                },
                details: error instanceof Error ? error.message : String(error),
            })

            throw new BaseAppError('Failed to contact AI provider', ErrorCode.UNKNOWN_ERROR, 502)
        }

        const rawContent = response.choices?.[0]?.message?.content

        if (!rawContent) {
            throw new AiResponseValidationError('OpenAI response did not include completion content')
        }

        try {
            return this.parseResponse(rawContent)
        } catch (error) {
            if (error instanceof ZodError) {
                throw error
            }

            throw new AiResponseValidationError('Failed to parse OpenAI response', error)
        }
    }

    private parseResponse(rawContent: string): AiOutput {
        const parsed = JSON.parse(rawContent)
        return AiOutputSchema.parse(parsed)
    }

    private buildMessages(payload: AiRequest, isRepairAttempt: boolean): OpenAiMessage[] {
        const messages: OpenAiMessage[] = [
            {
                role: 'system',
                content: AI_SYSTEM_PROMPT,
            },
            {
                role: 'user',
                content: this.buildUserPrompt(payload),
            },
        ]

        if (isRepairAttempt) {
            messages.push({
                role: 'user',
                content: `REPAIR: The previous response failed JSON schema validation. Return a valid JSON object with exactly ${payload.selectedAccounts.length} item(s) in "items", matching the provided accounts order and platforms without extra keys.`,
            })
        }

        return messages
    }

    private buildUserPrompt(payload: AiRequest): string {
        const includeHashtags = payload.includeHashtags ?? true
        const notesForAi = payload.notesForAi ?? 'null'
        const forbiddenWordsJson = JSON.stringify(payload.forbiddenWords || [])
        const selectedAccountsJson = JSON.stringify(payload.selectedAccounts, null, 2)

        const limitsLines = [
            `- TIKTOK_CAPTION_LIMIT=${this.envLimits.TIKTOK_CAPTION_LIMIT}`,
            `- INSTAGRAM_CAPTION_LIMIT=${this.envLimits.INSTAGRAM_CAPTION_LIMIT}`,
            `- THREADS_TEXT_LIMIT=${this.envLimits.THREADS_TEXT_LIMIT}`,
            `- BLUESKY_POST_CHAR_LIMIT=${this.envLimits.BLUESKY_POST_CHAR_LIMIT}`,
            `- LINKEDIN_TEXT_LIMIT=${this.envLimits.LINKEDIN_TEXT_LIMIT}`,
            `- YOUTUBE_DESCRIPTION_LIMIT=${this.envLimits.YOUTUBE_DESCRIPTION_LIMIT}`,
            `- YOUTUBE_TITLE_LIMIT=${this.envLimits.YOUTUBE_TITLE_LIMIT}`,
        ].join('\n')

        return [
            'Generate social posts for these platforms as JSON only.',
            '',
            'INPUT:',
            `- tone: ${payload.tone}`,
            `- language: ${payload.language}`,
            `- includeHashtags: ${includeHashtags}`,
            `- notesForAi: ${notesForAi}`,
            `- forbiddenWords: ${forbiddenWordsJson}`,
            `- selectedAccounts: ${selectedAccountsJson}`,
            '',
            'ENV LIMITS:',
            limitsLines,
            '',
            'TASK:',
            'For each selected account, produce one item following the schema and constraints above.',
            'Respect forbidden words, tones, platform limits, and hashtag rules.',
            'Return only the JSON object per schema.',
        ].join('\n')
    }

    private transformOutput(payload: AiRequest, aiOutput: AiOutput): AiIntroductoryResult[] {
        if (aiOutput.items.length !== payload.selectedAccounts.length) {
            throw new AiResponseValidationError(
                `AI response item count mismatch. Expected ${payload.selectedAccounts.length} but received ${aiOutput.items.length}.`
            )
        }

        return payload.selectedAccounts.map((account, index) => {
            const item = aiOutput.items[index]
            const normalizedPlatform = account.platform as PostPlatform

            if (item.platform !== normalizedPlatform) {
                this.logger.warn('AI response platform mismatch. Using request platform instead.', {
                    operation: 'ai_generate_content',
                    index,
                    requestedPlatform: normalizedPlatform,
                    receivedPlatform: item.platform,
                })
            }

            const sanitizedHashtags = this.sanitizeHashtags(
                normalizedPlatform,
                payload.includeHashtags === false ? [] : item.hashtags || []
            )

            const title = normalizedPlatform === SocilaMediaPlatform.YOUTUBE ? item.title : null
            const text = this.removeHashtagsFromText(item.text)

        const limitConfig = PLATFORM_LIMIT_KEYS[normalizedPlatform]
        const { adjustedTitle, adjustedText } = this.enforceCharLimits(limitConfig, title, text)

        const charCounts = {
            title: this.computeCharCount(adjustedTitle),
            text: Array.from(adjustedText).length,
        }

        const warnings = this.buildWarnings(item.warnings)

            return {
                id: account.id,
                platform: normalizedPlatform,
                language: item.language,
                title: adjustedTitle,
                text: adjustedText,
                hashtags: sanitizedHashtags,
                charCounts,
                warnings,
            }
        })
    }

    private enforceCharLimits(
        limitConfig: PlatformLimitConfig | undefined,
        title: string | null,
        text: string
    ): {
        adjustedTitle: string | null
        adjustedText: string
    } {
        let adjustedTitle = title
        let adjustedText = text

        if (limitConfig?.text) {
            const textLimit = this.parseLimit(limitConfig.text)
            if (textLimit !== null) {
                const chars = Array.from(adjustedText)
                if (chars.length > textLimit) {
                    adjustedText = chars.slice(0, textLimit).join('')
                }
            }
        }

        if (limitConfig?.title && adjustedTitle) {
            const titleLimit = this.parseLimit(limitConfig.title)
            if (titleLimit !== null) {
                const chars = Array.from(adjustedTitle)
                if (chars.length > titleLimit) {
                    adjustedTitle = chars.slice(0, titleLimit).join('')
                }
            }
        }

        return {
            adjustedTitle,
            adjustedText,
        }
    }

    private sanitizeHashtags(platform: PostPlatform, hashtags: string[]): string[] {
        if (!hashtags || hashtags.length === 0) return []

        if (platform === SocilaMediaPlatform.THREADS) {
            return hashtags.slice(0, 1)
        }

        return hashtags
    }

    private computeCharCount(value: string | null): number | null {
        if (value === null || typeof value !== 'string') {
            return value === '' ? 0 : null
        }

        return Array.from(value).length
    }

    private buildWarnings(baseWarnings: string[]): string[] {
        return [...(baseWarnings || [])]
    }

    private parseLimit(key: EnvLimitKey): number | null {
        const raw = this.envLimits[key]
        const parsed = Number(raw)

        if (!Number.isFinite(parsed) || parsed <= 0) {
            return null
        }

        return parsed
    }

    private ensureForbiddenCompliance(results: AiIntroductoryResult[], forbiddenWords: string[]): void {
        if (!forbiddenWords || forbiddenWords.length === 0) return

        const processedForbiddenWords: ProcessedForbiddenWord[] = forbiddenWords
            .map((word) => ({
                original: word,
                normalized: word.trim().toLowerCase(),
            }))
            .filter((item) => item.normalized.length > 0)

        if (processedForbiddenWords.length === 0) return

        for (const result of results) {
            const combinedContent = [result.title ?? '', result.text, ...(result.hashtags || [])]
                .join(' ')
                .toLowerCase()

            const offendingWords = processedForbiddenWords.filter((word) => combinedContent.includes(word.normalized))

            if (offendingWords.length > 0) {
                this.logger.warn('Generated content contains forbidden terms', {
                    operation: 'ai_generate_content',
                    forbiddenWords: offendingWords.map((word) => word.original),
                })

                throw new BaseAppError(
                    `Generated content contains forbidden terms: ${offendingWords
                        .map((word) => word.original)
                        .join(', ')}`,
                    ErrorCode.CONTENT_VALIDATION_FAILED,
                    400
                )
            }
        }
    }

    private ensureSupportedPlatforms(payload: AiRequest): void {
        const unsupported = payload.selectedAccounts
            .map((account) => account.platform as PostPlatform)
            .filter((platform) => !SUPPORTED_PLATFORMS.includes(platform))

        if (unsupported.length > 0) {
            throw new BaseAppError(
                `Unsupported platform(s) for AI generation: ${Array.from(new Set(unsupported)).join(', ')}`,
                ErrorCode.BAD_REQUEST,
                400
            )
        }
    }

    private loadEnvLimits(): EnvLimits {
        return {
            TIKTOK_CAPTION_LIMIT: process.env.TIKTOK_CAPTION_LIMIT?.trim() || 'null',
            INSTAGRAM_CAPTION_LIMIT: process.env.INSTAGRAM_CAPTION_LIMIT?.trim() || 'null',
            THREADS_TEXT_LIMIT: process.env.THREADS_TEXT_LIMIT?.trim() || 'null',
            BLUESKY_POST_CHAR_LIMIT: process.env.BLUESKY_POST_CHAR_LIMIT?.trim() || 'null',
            LINKEDIN_TEXT_LIMIT: process.env.LINKEDIN_TEXT_LIMIT?.trim() || 'null',
            YOUTUBE_DESCRIPTION_LIMIT: process.env.YOUTUBE_DESCRIPTION_LIMIT?.trim() || 'null',
            YOUTUBE_TITLE_LIMIT: process.env.YOUTUBE_TITLE_LIMIT?.trim() || 'null',
        }
    }

    private removeHashtagsFromText(originalText: string): string {
        if (!originalText) return ''

        const withoutHashtags = originalText.replace(/(^|\s)(#[^\s#]+)/g, (_match, prefix: string) => prefix)

        return withoutHashtags.replace(/\s{2,}/g, ' ').trim()
    }
}
