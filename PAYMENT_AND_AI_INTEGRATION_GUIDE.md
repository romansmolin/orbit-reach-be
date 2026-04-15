# Payment Gateway and AI Integration Guide

This guide provides instructions and code examples for integrating Secure Processor payment gateway and OpenAI AI service into your project.

## Table of Contents

1. [Payment Gateway Integration (Secure Processor)](#payment-gateway-integration)
2. [AI Integration (OpenAI)](#ai-integration)
3. [Database Setup](#database-setup)
4. [Environment Variables](#environment-variables)
5. [Complete Code Examples](#complete-code-examples)

---

## Payment Gateway Integration

### Overview

The payment gateway uses **Secure Processor** as the payment provider. It supports:
- Plan subscriptions (monthly/yearly)
- Add-on purchases (one-time usage packages)
- Flexible top-up purchases (custom amounts)
- Promo code support
- Webhook handling for payment status updates

### Architecture

The integration follows clean architecture principles:
- **Controller**: Handles HTTP requests/responses
- **Service**: Business logic for payment processing
- **Repository**: Database operations for payment tokens
- **Entity**: Payment token data structure

### Key Components

#### 1. Payment Token Entity

```typescript
// src/entities/payment-token.ts
import { UserPlans } from '@/shared/consts/plans'

export type PaymentTokenStatus = 'created' | 'pending' | 'successful' | 'failed' | 'declined' | 'expired' | 'error'
export type PaymentTokenItemType = 'plan' | 'addon'

export type UsageDeltas = {
    sentPosts?: number
    scheduledPosts?: number
    aiRequests?: number
}

export class PaymentToken {
    constructor(
        public readonly id: string,
        public readonly token: string,
        public readonly tenantId: string,
        public readonly planCode: UserPlans,
        public readonly billingPeriod: 'monthly' | 'yearly',
        public readonly amount: number,
        public readonly currency: string,
        public readonly description: string | null,
        public readonly testMode: boolean,
        public readonly status: PaymentTokenStatus,
        public readonly gatewayUid: string | null,
        public readonly trackingId: string | null,
        public readonly rawPayload: unknown | null,
        public readonly errorMessage: string | null,
        public readonly createdAt: Date,
        public readonly updatedAt: Date,
        public readonly itemType: PaymentTokenItemType,
        public readonly addonCode: string | null,
        public readonly usageDeltas: UsageDeltas | null,
        public readonly promoCodeId: string | null,
        public readonly originalAmount: number | null,
        public readonly discountAmount: number
    ) {}
}
```

#### 2. Service Interface

```typescript
// src/services/secure-processor-service/secure-processor.service.interface.ts
import { PaymentTokenStatus } from '@/entities/payment-token'

export type SecureProcessorPlanCode = 'STARTER' | 'PRO'
export type SecureProcessorBillingPeriod = 'monthly' | 'yearly'
export type SecureProcessorItemType = 'plan' | 'addon'
export type SecureProcessorAddonCode = 'EXTRA_SMALL' | 'EXTRA_MEDIUM' | 'EXTRA_LARGE' | 'FLEX_TOP_UP'

export interface CheckoutTokenResponse {
    token: string
    checkout: {
        token: string
    }
}

export interface ReturnHandlingResult {
    status: PaymentTokenStatus
    redirectUrl: string
}

export type CreatePlanCheckoutParams = {
    itemType?: 'plan'
    userId: string
    planCode: SecureProcessorPlanCode
    billingPeriod: SecureProcessorBillingPeriod
}

export type CreateAddonCheckoutParams = {
    itemType: 'addon'
    userId: string
    addonCode: 'EXTRA_SMALL' | 'EXTRA_MEDIUM' | 'EXTRA_LARGE'
    promoCode?: string
} | {
    itemType: 'addon'
    userId: string
    addonCode: 'FLEX_TOP_UP'
    amount: number
    currency?: 'EUR'
    promoCode?: string
}

export type CreateCheckoutParams = CreatePlanCheckoutParams | CreateAddonCheckoutParams

export interface ISecureProcessorPaymentService {
    createCheckoutToken(params: CreateCheckoutParams): Promise<CheckoutTokenResponse>
    handleReturn(params: {
        token: string
        status?: string | null
        uid?: string | null
    }): Promise<ReturnHandlingResult>
    processWebhook(rawPayload: Buffer, headers: { authorization?: string; contentSignature?: string }): Promise<void>
}
```

#### 3. Repository Interface

```typescript
// src/repositories/payment-tokens-repository/payment-tokens.repository.interface.ts
import { PaymentToken, PaymentTokenItemType, PaymentTokenStatus, UsageDeltas } from '@/entities/payment-token'
import { UserPlans } from '@/shared/consts/plans'

export interface PaymentTokenCreateInput {
    token: string
    tenantId: string
    planCode: UserPlans
    billingPeriod: 'monthly' | 'yearly'
    amount: number
    currency: string
    description?: string | null
    testMode: boolean
    status?: PaymentTokenStatus
    gatewayUid?: string | null
    trackingId?: string | null
    rawPayload?: unknown | null
    itemType?: PaymentTokenItemType
    addonCode?: string | null
    usageDeltas?: UsageDeltas | null
    promoCodeId?: string | null
    originalAmount?: number | null
    discountAmount?: number
}

export interface PaymentTokenUpdateInput {
    status?: PaymentTokenStatus
    gatewayUid?: string | null
    rawPayload?: unknown | null
    errorMessage?: string | null
    testMode?: boolean
    usageDeltas?: UsageDeltas | null
}

export interface IPaymentTokensRepository {
    create(data: PaymentTokenCreateInput): Promise<PaymentToken>
    findByToken(token: string): Promise<PaymentToken | null>
    updateByToken(token: string, updates: PaymentTokenUpdateInput): Promise<PaymentToken | null>
    findByTenantId(tenantId: string, filters?: { status?: PaymentTokenStatus; itemType?: PaymentTokenItemType }): Promise<PaymentToken[]>
}
```

#### 4. Controller Example

```typescript
// src/controllers/secure-processor.controller.ts
import { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { ISecureProcessorPaymentService } from '@/services/secure-processor-service'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { ILogger } from '@/shared/infra/logger/logger.interface'

const planTokenSchema = z.object({
    itemType: z.literal('plan').optional(),
    planCode: z.enum(['STARTER', 'PRO']),
    billingPeriod: z.enum(['monthly', 'yearly']),
})

const addonTokenSchema = z.object({
    itemType: z.literal('addon'),
    addonCode: z.enum(['EXTRA_SMALL', 'EXTRA_MEDIUM', 'EXTRA_LARGE']),
    promoCode: z.string().optional(),
})

const flexibleAddonTokenSchema = z.object({
    itemType: z.literal('addon'),
    addonCode: z.literal('FLEX_TOP_UP'),
    amount: z.number().min(1).max(1000).multipleOf(0.01),
    currency: z.literal('EUR').optional(),
    promoCode: z.string().optional(),
})

const createTokenSchema = z.union([planTokenSchema, addonTokenSchema, flexibleAddonTokenSchema])

export class SecureProcessorController {
    constructor(
        private readonly paymentService: ISecureProcessorPaymentService,
        private readonly logger: ILogger
    ) {}

    async createToken(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const parsed = createTokenSchema.safeParse(req.body)

            if (!parsed.success) {
                throw new BaseAppError('Invalid payment request payload', ErrorCode.BAD_REQUEST, 400)
            }

            if (!req.user?.id) {
                throw new BaseAppError('Unauthorized', ErrorCode.UNAUTHORIZED, 401)
            }

            const payload = parsed.data
            const itemType = (payload as { itemType?: 'plan' | 'addon' }).itemType ?? 'plan'

            if (itemType === 'addon') {
                const addonPayload = payload as { addonCode: string; amount?: number; currency?: 'EUR'; promoCode?: string }

                if (addonPayload.addonCode === 'FLEX_TOP_UP') {
                    const result = await this.paymentService.createCheckoutToken({
                        itemType: 'addon',
                        userId: req.user.id,
                        addonCode: 'FLEX_TOP_UP',
                        amount: addonPayload.amount as number,
                        currency: addonPayload.currency ?? 'EUR',
                        promoCode: addonPayload.promoCode,
                    })

                    res.status(200).json(result)
                    return
                }

                const result = await this.paymentService.createCheckoutToken({
                    itemType: 'addon',
                    userId: req.user.id,
                    addonCode: addonPayload.addonCode as any,
                    promoCode: addonPayload.promoCode,
                })

                res.status(200).json(result)
                return
            }

            const planPayload = payload as { planCode: string; billingPeriod: string }
            const result = await this.paymentService.createCheckoutToken({
                itemType: 'plan',
                userId: req.user.id,
                planCode: planPayload.planCode as any,
                billingPeriod: planPayload.billingPeriod as any,
            })

            res.status(200).json(result)
        } catch (error) {
            next(error)
        }
    }

    async handleReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const token = req.query.token as string
            const status = req.query.status as string | undefined
            const uid = req.query.uid as string | undefined

            if (!token) {
                throw new BaseAppError('Invalid return parameters', ErrorCode.BAD_REQUEST, 400)
            }

            const result = await this.paymentService.handleReturn({
                token,
                status,
                uid,
            })

            res.redirect(result.redirectUrl)
        } catch (error) {
            if (error instanceof Error) {
                this.logger.error('Failed to handle Secure Processor return', {
                    error: { name: error.name, message: error.message },
                })
            }

            if (!res.headersSent) {
                const fallbackBase = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0]?.trim() || 'http://localhost:3000'
                const normalizedBase = fallbackBase.replace(/\/$/, '')
                const params = new URLSearchParams({
                    status: 'error',
                })

                if (typeof req.query.token === 'string') {
                    params.append('token', req.query.token)
                }

                return res.redirect(`${normalizedBase}/payments/secure-processor/failed?${params.toString()}`)
            }

            next(error)
        }
    }

    async handleWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!Buffer.isBuffer(req.body)) {
                throw new BaseAppError('Webhook payload must be a raw buffer', ErrorCode.BAD_REQUEST, 400)
            }

            const authorizationHeader = Array.isArray(req.headers.authorization)
                ? req.headers.authorization[0]
                : req.headers.authorization
            const signatureHeader = req.headers['content-signature']
            const contentSignature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader

            await this.paymentService.processWebhook(req.body, {
                authorization: authorizationHeader ?? undefined,
                contentSignature: contentSignature ?? undefined,
            })

            res.status(200).json({ received: true })
        } catch (error) {
            if (error instanceof Error) {
                this.logger.error('Secure Processor webhook handling failed', {
                    error: { name: error.name, message: error.message },
                })
            }
            next(error)
        }
    }
}
```

#### 5. Routes Setup

```typescript
// src/routes/payments.routes.ts
import express, { Router } from 'express'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { SecureProcessorController } from '@/controllers/secure-processor.controller'
import { authMiddleware } from '@/middleware/auth.middleware'

const createPaymentsRoutes = (logger: ILogger, paymentService: ISecureProcessorPaymentService) => {
    const router = Router()
    const secureProcessorController = new SecureProcessorController(paymentService, logger)

    router.post(
        '/payments/secure-processor/token',
        authMiddleware,
        secureProcessorController.createToken.bind(secureProcessorController)
    )

    router.get('/payments/secure-processor/return', secureProcessorController.handleReturn.bind(secureProcessorController))

    router.post(
        '/payments/secure-processor/webhook',
        express.raw({ type: '*/*' }),
        secureProcessorController.handleWebhook.bind(secureProcessorController)
    )

    return router
}

export default createPaymentsRoutes
```

### Service Implementation Key Points

1. **Checkout Token Creation**: Creates a checkout session with Secure Processor API
2. **Return Handling**: Processes payment return callbacks and reconciles status
3. **Webhook Processing**: Verifies webhook signatures and updates payment status
4. **Fulfillment**: Applies purchased plans/add-ons to user accounts

### Pricing Configuration

The service includes predefined pricing:

```typescript
// Plan pricing (in cents)
STARTER: {
    monthly: { amount: 1000, currency: 'EUR' },
    yearly: { amount: 7300, currency: 'EUR' }
}
PRO: {
    monthly: { amount: 1700, currency: 'EUR' },
    yearly: { amount: 12000, currency: 'EUR' }
}

// Add-on pricing
EXTRA_SMALL: { amount: 100, currency: 'EUR', usageDeltas: { sentPosts: 20, scheduledPosts: 10, aiRequests: 10 } }
EXTRA_MEDIUM: { amount: 500, currency: 'EUR', usageDeltas: { sentPosts: 100, scheduledPosts: 80, aiRequests: 30 } }
EXTRA_LARGE: { amount: 1000, currency: 'EUR', usageDeltas: { sentPosts: 500, scheduledPosts: 450, aiRequests: 100 } }
```

---

## AI Integration

### Overview

The AI integration uses **OpenAI** (GPT models) to generate social media content. It supports:
- Multi-platform content generation
- Custom tones and languages
- Forbidden word filtering
- Platform-specific character limits
- Hashtag generation
- Retry logic with validation

### Architecture

- **Controller**: Handles HTTP requests/responses
- **Service**: Business logic for AI content generation
- **Schema**: Request/response validation with Zod

### Key Components

#### 1. AI Service Interface

```typescript
// src/services/ai-service/ai-service.interface.ts
import { PostPlatform } from '@/schemas/posts.schemas'
import { AiRequest } from '../../schemas/ai.schema'

export interface AiIntroductoryResult {
    id: string
    platform: PostPlatform
    language: string
    title: string | null
    text: string
    hashtags: string[]
    charCounts: {
        title: number | null
        text: number
    }
    warnings: string[]
}

export interface IAiService {
    generateIntroductoryCopy(userId: string, payload: AiRequest): Promise<AiIntroductoryResult[]>
}
```

#### 2. Request Schema

```typescript
// src/schemas/ai.schema.ts
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
    platform: z.enum(SocilaMediaPlatform, 'We can except only tiktok,threads, x, instagram, facebook, pinterest, bluesky, youtube'),
})

export const aiApiPayloadSchema = z.object({
    tone: z.enum(AiTone, 'We expect the following values: friendly, professional,informative,humorous,inspirational ,empathetic, authoritative, playful, educational, urgent'),
    language: z.string(),
    includeHashtags: z.boolean().optional(),
    notesForAi: z.string().trim().min(10, 'The minimal lenght is 10 characters').max(500, 'The maximal lenght is 500 symbols').optional(),
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
```

#### 3. Controller Example

```typescript
// src/controllers/ai.controller.ts
import { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { aiApiPayloadSchema } from '@/schemas/ai.schema'
import { IAiService } from '@/services/ai-service'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'

export class AiController {
    constructor(
        private readonly aiService: IAiService,
        private readonly logger: ILogger
    ) {}

    async generateIntroductoryCopy(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!req.user?.id) {
                throw new BaseAppError('User is not authenticated', ErrorCode.UNAUTHORIZED, 401)
            }

            const payload = aiApiPayloadSchema.parse(req.body)
            const items = await this.aiService.generateIntroductoryCopy(req.user.id, payload)

            res.status(200).json({ items })
        } catch (error: unknown) {
            if (error instanceof ZodError) {
                this.logger.warn('AI request validation failed', {
                    operation: 'ai_generate_content',
                    error: {
                        name: error.name,
                        code: error.message,
                    },
                })

                res.status(400).json({
                    message: 'Validation error',
                    errors: error.issues.map((issue) => ({
                        path: issue.path.join('.'),
                        message: issue.message,
                    })),
                })
                return
            }

            next(error)
        }
    }
}
```

#### 4. Routes Setup

```typescript
// src/routes/ai.routes.ts
import { Router } from 'express'
import { authMiddleware } from '@/middleware/auth.middleware'
import { AiController } from '@/controllers/ai.controller'
import { IAiService } from '@/services/ai-service'
import { ILogger } from '@/shared/infra/logger'

const createAiRoutes = (logger: ILogger, aiService: IAiService) => {
    const router = Router()
    const controller = new AiController(aiService, logger)

    router.use(authMiddleware)

    router.post('/ai/content', controller.generateIntroductoryCopy.bind(controller))

    return router
}

export default createAiRoutes
```

### AI Service Implementation Key Points

1. **System Prompt**: Defines strict JSON output format and platform constraints
2. **Platform Limits**: Enforces character limits per platform (from environment variables)
3. **Forbidden Words**: Validates and filters forbidden terms
4. **Retry Logic**: Attempts up to 2 times with repair instructions on validation failure
5. **Usage Tracking**: Increments AI usage counter for user (requires Pro plan)
6. **Response Validation**: Validates OpenAI response against Zod schema

### Supported Platforms

- TikTok (caption only)
- Instagram (caption only)
- Threads (text only, max 1 hashtag)
- Bluesky (text only)
- LinkedIn (text only)
- YouTube (title + description)

### System Prompt Structure

The AI service uses a detailed system prompt that:
- Enforces JSON-only output
- Specifies platform capabilities
- Defines hashtag rules
- Handles forbidden words
- Respects character limits

---

## Database Setup

### Payment Tokens Table

```sql
-- migrations/022_add_secure_processor_payment_tokens.sql
CREATE TABLE payment_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token TEXT NOT NULL UNIQUE,
    tenant_id UUID NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
    plan_code TEXT NOT NULL,
    billing_period TEXT NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
    amount INTEGER NOT NULL CHECK (amount >= 0),
    currency TEXT NOT NULL,
    description TEXT,
    test_mode BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'created' CHECK (
        status IN ('created', 'pending', 'successful', 'failed', 'declined', 'expired', 'error')
    ),
    gateway_uid TEXT,
    tracking_id TEXT,
    raw_payload JSONB,
    error_message TEXT,
    item_type TEXT DEFAULT 'plan' CHECK (item_type IN ('plan', 'addon')),
    addon_code TEXT,
    usage_deltas JSONB,
    promo_code_id UUID,
    original_amount INTEGER,
    discount_amount INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payment_tokens_tenant_id ON payment_tokens (tenant_id);
CREATE INDEX idx_payment_tokens_status ON payment_tokens (status);
```

### Required Database Functions

```sql
-- Ensure you have the update_updated_at_column() function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for payment_tokens
CREATE TRIGGER update_payment_tokens_updated_at
    BEFORE UPDATE ON payment_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

---

## Environment Variables

### Payment Gateway (Secure Processor)

```bash
# Secure Processor Configuration
SECURE_PROCESSOR_SHOP_ID=your_shop_id
SECURE_PROCESSOR_SECRET_KEY=your_secret_key
SECURE_PROCESSOR_PUBLIC_KEY=your_public_key

# Test mode flag (for frontend)
NEXT_PUBLIC_SECURE_PROCESSOR_TEST_MODE=true

# Base URLs
BACKEND_URL=https://api.yourdomain.com
FRONTEND_URL=https://yourdomain.com
```

### AI Integration (OpenAI)

```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-your-api-key
OPENAI_API_BASE_URL=https://api.openai.com/v1  # Optional, defaults to OpenAI
OPENAI_CONTENT_MODEL=gpt-4.1  # Optional, defaults to gpt-4.1

# Platform Character Limits
TIKTOK_CAPTION_LIMIT=2200
INSTAGRAM_CAPTION_LIMIT=2200
THREADS_TEXT_LIMIT=500
BLUESKY_POST_CHAR_LIMIT=300
LINKEDIN_TEXT_LIMIT=3000
YOUTUBE_DESCRIPTION_LIMIT=5000
YOUTUBE_TITLE_LIMIT=100
```

---

## Complete Code Examples

### Service Initialization

```typescript
// src/config/services.config.ts (excerpt)
import { AxiosApiClient } from '@/shared/infra/api'
import { SecureProcessorPaymentService } from '@/services/secure-processor-service'
import { AiService } from '@/services/ai-service'
import { PaymentTokensRepository } from '@/repositories/payment-tokens-repository'
import { IUserService } from '@/services/users-service/user.service.interface'

export function initializeServices(
    logger: ILogger,
    userService: IUserService
) {
    // Payment Gateway Setup
    const paymentTokensRepository = new PaymentTokensRepository()
    const secureProcessorPaymentService = new SecureProcessorPaymentService(
        paymentTokensRepository,
        userService,
        logger,
        new AxiosApiClient('https://checkout.secure-processor.com')
    )

    // AI Service Setup
    const openAiBaseUrl = process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1'
    const openAiClient = new AxiosApiClient(openAiBaseUrl)
    const aiService = new AiService(openAiClient, logger, userService)

    return {
        secureProcessorPaymentService,
        aiService,
        paymentTokensRepository,
        // ... other services
    }
}
```

### API Client Implementation

```typescript
// src/shared/infra/api/api-client.ts
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'
import { ApiRequestOptions, IApiClient } from './api-client.interface'

const DEFAULT_TIMEOUT = 30_000

export class AxiosApiClient implements IApiClient {
    private readonly client: AxiosInstance

    constructor(baseURL?: string, defaultHeaders?: Record<string, string>) {
        this.client = axios.create({
            baseURL,
            timeout: DEFAULT_TIMEOUT,
            headers: defaultHeaders,
        })
    }

    async post<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse> {
        const response = await this.client.post<TResponse>(apiUrl, body, this.buildConfig(options))
        return response.data
    }

    async get<TResponse = unknown>(apiUrl: string, options?: ApiRequestOptions): Promise<TResponse> {
        const response = await this.client.get<TResponse>(apiUrl, this.buildConfig(options))
        return response.data
    }

    // ... other methods (put, patch, delete)
}
```

### Frontend Integration Example

#### Payment Gateway Frontend

```typescript
// Frontend: Creating a checkout token
async function createCheckoutToken(itemType: 'plan' | 'addon', data: any) {
    const response = await fetch('/api/payments/secure-processor/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // Include auth token
        },
        body: JSON.stringify({
            itemType,
            ...data, // planCode, billingPeriod OR addonCode, amount, etc.
        }),
    })

    const { token, checkout } = await response.json()
    
    // Use token with Secure Processor widget
    // Widget script: https://js.secure-processor.com/widget/be_gateway.js
    return { token, checkout }
}
```

#### AI Frontend

```typescript
// Frontend: Generating AI content
async function generateAIContent(payload: {
    tone: string
    language: string
    selectedAccounts: Array<{ id: string; platform: string }>
    notesForAi?: string
    forbiddenWords: string[]
    includeHashtags?: boolean
}) {
    const response = await fetch('/api/ai/content', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // Include auth token
        },
        body: JSON.stringify(payload),
    })

    const { items } = await response.json()
    return items // Array of AiIntroductoryResult
}
```

---

## Security Considerations

### Payment Gateway

1. **Webhook Verification**: Always verify webhook signatures using RSA-SHA256
2. **Basic Auth**: Use Basic Authentication for webhook endpoints
3. **HTTPS**: Ensure all payment callbacks use HTTPS in production
4. **Token Validation**: Validate all payment tokens before processing

### AI Integration

1. **API Key Security**: Store OpenAI API keys securely (environment variables)
2. **Rate Limiting**: Implement rate limiting for AI endpoints
3. **Usage Tracking**: Track AI usage to prevent abuse
4. **Input Validation**: Validate all user inputs with Zod schemas
5. **Forbidden Words**: Always validate generated content against forbidden words

---

## Testing

### Payment Gateway Testing

1. Use test mode: `NEXT_PUBLIC_SECURE_PROCESSOR_TEST_MODE=true`
2. Test all payment statuses: successful, pending, failed, declined
3. Test webhook signature verification
4. Test return URL handling

### AI Integration Testing

1. Test with different tones and languages
2. Test forbidden word filtering
3. Test platform-specific character limits
4. Test retry logic with invalid responses
5. Test usage tracking and plan restrictions

---

## Troubleshooting

### Payment Gateway Issues

- **Token creation fails**: Check Secure Processor credentials and API connectivity
- **Webhook not received**: Verify webhook URL is accessible and signature verification passes
- **Status not updating**: Check database connection and webhook processing logs

### AI Integration Issues

- **API key errors**: Verify `OPENAI_API_KEY` is set correctly
- **Validation errors**: Check request payload matches schema
- **Rate limits**: Implement exponential backoff for rate limit errors
- **Content quality**: Adjust system prompt or model parameters

---

## Additional Resources

- Secure Processor Documentation: https://docs.secure-processor.com
- OpenAI API Documentation: https://platform.openai.com/docs
- Widget Integration: https://docs.secure-processor.com/en/integration/widget/payment_page/

---

## Notes

- Both integrations follow clean architecture principles
- Use dependency injection for testability
- All database operations use raw SQL (no ORM)
- Error handling uses custom error classes with error codes
- Logging is comprehensive for debugging and monitoring

