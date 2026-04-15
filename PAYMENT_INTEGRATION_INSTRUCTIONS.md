# Payment Integration Instructions - Secure Processor

This guide provides step-by-step instructions for integrating Secure Processor payment gateway into your project.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Database Setup](#step-1-database-setup)
3. [Step 2: Install Dependencies](#step-2-install-dependencies)
4. [Step 3: Environment Configuration](#step-3-environment-configuration)
5. [Step 4: Create Core Files](#step-4-create-core-files)
6. [Step 5: Implement Repository](#step-5-implement-repository)
7. [Step 6: Implement Service](#step-6-implement-service)
8. [Step 7: Create Controller](#step-7-create-controller)
9. [Step 8: Setup Routes](#step-8-setup-routes)
10. [Step 9: Initialize Service](#step-9-initialize-service)
11. [Step 10: Testing](#step-10-testing)
12. [Frontend Integration](#frontend-integration)

---

## Prerequisites

- Node.js project with Express.js
- PostgreSQL database
- Secure Processor account with API credentials
- User authentication system in place

---

## Step 1: Database Setup

### 1.1 Create Migration File

Create a migration file: `migrations/001_create_payment_tokens.sql`

```sql
-- Create payment_tokens table
BEGIN;

CREATE TABLE IF NOT EXISTS payment_tokens (
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

CREATE INDEX IF NOT EXISTS idx_payment_tokens_tenant_id ON payment_tokens (tenant_id);
CREATE INDEX IF NOT EXISTS idx_payment_tokens_status ON payment_tokens (status);
CREATE INDEX IF NOT EXISTS idx_payment_tokens_token ON payment_tokens (token);

-- Create update trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger
DROP TRIGGER IF EXISTS update_payment_tokens_updated_at ON payment_tokens;
CREATE TRIGGER update_payment_tokens_updated_at
    BEFORE UPDATE ON payment_tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;
```

### 1.2 Run Migration

Execute the migration against your database:

```bash
psql -U your_user -d your_database -f migrations/001_create_payment_tokens.sql
```

---

## Step 2: Install Dependencies

Install required npm packages:

```bash
npm install axios crypto
npm install --save-dev @types/node
```

---

## Step 3: Environment Configuration

Add these environment variables to your `.env` file:

```bash
# Secure Processor Configuration
SECURE_PROCESSOR_SHOP_ID=your_shop_id_here
SECURE_PROCESSOR_SECRET_KEY=your_secret_key_here
SECURE_PROCESSOR_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----\nYour public key here\n-----END PUBLIC KEY-----

# Test mode (set to 'true' for testing)
NEXT_PUBLIC_SECURE_PROCESSOR_TEST_MODE=true

# Base URLs
BACKEND_URL=https://api.yourdomain.com
FRONTEND_URL=https://yourdomain.com
```

**Important Notes:**
- Get credentials from your Secure Processor dashboard
- The public key should include the `-----BEGIN PUBLIC KEY-----` and `-----END PUBLIC KEY-----` markers
- Use `NEXT_PUBLIC_SECURE_PROCESSOR_TEST_MODE=true` for testing
- Ensure `BACKEND_URL` uses HTTPS in production

---

## Step 4: Create Core Files

### 4.1 Create Entity

Create `src/entities/payment-token.ts`:

```typescript
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
        public readonly planCode: string,
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

### 4.2 Create API Client Interface

Create `src/shared/infra/api/api-client.interface.ts`:

```typescript
export interface ApiRequestOptions {
    headers?: Record<string, string>
    params?: Record<string, string | number | boolean>
    responseType?: 'json' | 'arraybuffer' | 'document' | 'text' | 'stream'
    timeoutMs?: number
    raw?: Record<string, unknown>
}

export interface IApiClient {
    post<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse>
    get<TResponse = unknown>(apiUrl: string, options?: ApiRequestOptions): Promise<TResponse>
    delete<TResponse = unknown>(apiUrl: string, options?: ApiRequestOptions): Promise<TResponse>
    put<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse>
    patch<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse>
}
```

### 4.3 Create API Client Implementation

Create `src/shared/infra/api/api-client.ts`:

```typescript
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

    async delete<TResponse = unknown>(apiUrl: string, options?: ApiRequestOptions): Promise<TResponse> {
        const response = await this.client.delete<TResponse>(apiUrl, this.buildConfig(options))
        return response.data
    }

    async put<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse> {
        const response = await this.client.put<TResponse>(apiUrl, body, this.buildConfig(options))
        return response.data
    }

    async patch<TResponse = unknown, TBody = unknown>(
        apiUrl: string,
        body?: TBody,
        options?: ApiRequestOptions
    ): Promise<TResponse> {
        const response = await this.client.patch<TResponse>(apiUrl, body, this.buildConfig(options))
        return response.data
    }

    private buildConfig(options?: ApiRequestOptions): AxiosRequestConfig {
        if (!options) return {}

        const config: AxiosRequestConfig = {}

        if (options.headers) {
            config.headers = { ...options.headers }
        }

        if (options.params) {
            config.params = { ...options.params }
        }

        if (options.responseType) {
            config.responseType = options.responseType
        }

        if (typeof options.timeoutMs === 'number') {
            config.timeout = options.timeoutMs
        }

        if (options.raw && typeof options.raw === 'object' && options.raw !== null) {
            Object.assign(config, options.raw as AxiosRequestConfig)
        }

        return config
    }
}
```

### 4.4 Create Utility for Environment Variables

Create `src/shared/utils/get-env-var.ts`:

```typescript
export function getEnvVar(name: string): string {
    const value = process.env[name]
    if (!value) {
        throw new Error(`Environment variable ${name} is not set`)
    }
    return value
}
```

---

## Step 5: Implement Repository

### 5.1 Create Repository Interface

Create `src/repositories/payment-tokens-repository/payment-tokens.repository.interface.ts`:

```typescript
import { PaymentToken, PaymentTokenItemType, PaymentTokenStatus, UsageDeltas } from '@/entities/payment-token'

export interface PaymentTokenCreateInput {
    token: string
    tenantId: string
    planCode: string
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

### 5.2 Create Repository Implementation

Create `src/repositories/payment-tokens-repository/payment-tokens.repository.ts`:

```typescript
import { Pool } from 'pg'
import { PaymentToken, PaymentTokenStatus, PaymentTokenItemType } from '@/entities/payment-token'
import {
    IPaymentTokensRepository,
    PaymentTokenCreateInput,
    PaymentTokenUpdateInput,
} from './payment-tokens.repository.interface'

// Import your database connection
// import { pgClient } from '@/db-connection'

export class PaymentTokensRepository implements IPaymentTokensRepository {
    private readonly client: Pool

    constructor(client: Pool) {
        this.client = client
    }

    private mapRow(row: any): PaymentToken {
        return new PaymentToken(
            row.id,
            row.token,
            row.tenant_id,
            row.plan_code,
            row.billing_period,
            Number(row.amount),
            row.currency,
            row.description ?? null,
            Boolean(row.test_mode),
            row.status as PaymentTokenStatus,
            row.gateway_uid ?? null,
            row.tracking_id ?? null,
            row.raw_payload ?? null,
            row.error_message ?? null,
            row.created_at,
            row.updated_at,
            row.item_type ?? 'plan',
            row.addon_code ?? null,
            row.usage_deltas ?? null,
            row.promo_code_id ?? null,
            row.original_amount !== null ? Number(row.original_amount) : null,
            row.discount_amount !== null ? Number(row.discount_amount) : 0
        )
    }

    async create(data: PaymentTokenCreateInput): Promise<PaymentToken> {
        try {
            const result = await this.client.query(
                `
                INSERT INTO payment_tokens (
                    token, tenant_id, plan_code, billing_period, amount, currency,
                    description, test_mode, status, gateway_uid, tracking_id,
                    raw_payload, item_type, addon_code, usage_deltas,
                    promo_code_id, original_amount, discount_amount
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                RETURNING *
                `,
                [
                    data.token,
                    data.tenantId,
                    data.planCode,
                    data.billingPeriod,
                    data.amount,
                    data.currency,
                    data.description ?? null,
                    data.testMode,
                    data.status ?? 'created',
                    data.gatewayUid ?? null,
                    data.trackingId ?? null,
                    data.rawPayload ? JSON.stringify(data.rawPayload) : null,
                    data.itemType ?? 'plan',
                    data.addonCode ?? null,
                    data.usageDeltas ? JSON.stringify(data.usageDeltas) : null,
                    data.promoCodeId ?? null,
                    data.originalAmount ?? null,
                    data.discountAmount ?? 0,
                ]
            )

            return this.mapRow(result.rows[0])
        } catch (error: any) {
            throw new Error(`Failed to store payment token: ${error.message ?? 'unknown error'}`)
        }
    }

    async findByToken(token: string): Promise<PaymentToken | null> {
        try {
            const result = await this.client.query(`SELECT * FROM payment_tokens WHERE token = $1`, [token])
            if (!result.rows[0]) {
                return null
            }

            return this.mapRow(result.rows[0])
        } catch (error: any) {
            throw new Error(`Failed to fetch payment token: ${error.message ?? 'unknown error'}`)
        }
    }

    async updateByToken(token: string, updates: PaymentTokenUpdateInput): Promise<PaymentToken | null> {
        const fields: string[] = []
        const values: any[] = []

        if (updates.status) {
            fields.push(`status = $${fields.length + 1}`)
            values.push(updates.status)
        }

        if (updates.gatewayUid !== undefined) {
            fields.push(`gateway_uid = $${fields.length + 1}`)
            values.push(updates.gatewayUid)
        }

        if (updates.rawPayload !== undefined) {
            fields.push(`raw_payload = $${fields.length + 1}`)
            values.push(updates.rawPayload ? JSON.stringify(updates.rawPayload) : null)
        }

        if (updates.errorMessage !== undefined) {
            fields.push(`error_message = $${fields.length + 1}`)
            values.push(updates.errorMessage)
        }

        if (updates.testMode !== undefined) {
            fields.push(`test_mode = $${fields.length + 1}`)
            values.push(updates.testMode)
        }

        if (updates.usageDeltas !== undefined) {
            fields.push(`usage_deltas = $${fields.length + 1}`)
            values.push(updates.usageDeltas ? JSON.stringify(updates.usageDeltas) : null)
        }

        if (fields.length === 0) {
            return this.findByToken(token)
        }

        const updateQuery = `
            UPDATE payment_tokens
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE token = $${fields.length + 1}
            RETURNING *
        `

        try {
            const result = await this.client.query(updateQuery, [...values, token])
            if (!result.rows[0]) {
                return null
            }

            return this.mapRow(result.rows[0])
        } catch (error: any) {
            throw new Error(`Failed to update payment token: ${error.message ?? 'unknown error'}`)
        }
    }

    async findByTenantId(tenantId: string, filters?: { status?: PaymentTokenStatus; itemType?: PaymentTokenItemType }): Promise<PaymentToken[]> {
        try {
            let query = 'SELECT * FROM payment_tokens WHERE tenant_id = $1'
            const params: any[] = [tenantId]
            let paramCount = 1

            if (filters?.status) {
                paramCount++
                query += ` AND status = $${paramCount}`
                params.push(filters.status)
            }

            if (filters?.itemType) {
                paramCount++
                query += ` AND item_type = $${paramCount}`
                params.push(filters.itemType)
            }

            query += ' ORDER BY created_at DESC'

            const result = await this.client.query(query, params)

            return result.rows.map((row) => this.mapRow(row))
        } catch (error: any) {
            throw new Error(`Failed to fetch payment tokens: ${error.message ?? 'unknown error'}`)
        }
    }
}
```

---

## Step 6: Implement Service

### 6.1 Create Service Interface

Create `src/services/secure-processor-service/secure-processor.service.interface.ts`:

```typescript
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

### 6.2 Create Service Implementation

Create `src/services/secure-processor-service/secure-processor.service.ts`:

**Note:** This is a simplified version. For the complete implementation with all methods, refer to the full codebase.

```typescript
import crypto from 'crypto'
import { AxiosApiClient, IApiClient } from '@/shared/infra/api'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { getEnvVar } from '@/shared/utils/get-env-var'
import { IPaymentTokensRepository } from '@/repositories/payment-tokens-repository'
import { PaymentToken, PaymentTokenStatus } from '@/entities/payment-token'
import {
    CheckoutTokenResponse,
    CreateCheckoutParams,
    ISecureProcessorPaymentService,
    ReturnHandlingResult,
    SecureProcessorPlanCode,
    SecureProcessorBillingPeriod,
} from './secure-processor.service.interface'

type PlanPricing = { amount: number; currency: string; description: string }

export class SecureProcessorPaymentService implements ISecureProcessorPaymentService {
    private static readonly PLAN_PRICING: Record<SecureProcessorPlanCode, { monthly: PlanPricing; yearly: PlanPricing }> = {
        STARTER: {
            monthly: { amount: 1000, currency: 'EUR', description: 'Starter monthly subscription' },
            yearly: { amount: 7300, currency: 'EUR', description: 'Starter yearly subscription' },
        },
        PRO: {
            monthly: { amount: 1700, currency: 'EUR', description: 'Pro monthly subscription' },
            yearly: { amount: 12000, currency: 'EUR', description: 'Pro yearly subscription' },
        },
    }

    private readonly repository: IPaymentTokensRepository
    private readonly logger: ILogger
    private readonly apiClient: IApiClient
    private readonly shopId: string
    private readonly secretKey: string
    private readonly publicKey: string
    private readonly testMode: boolean
    private readonly backendBaseUrl: string
    private readonly frontendBaseUrl: string
    private readonly authHeader: string

    constructor(
        repository: IPaymentTokensRepository,
        logger: ILogger,
        apiClient: IApiClient = new AxiosApiClient('https://checkout.secure-processor.com')
    ) {
        this.repository = repository
        this.logger = logger
        this.apiClient = apiClient
        this.shopId = getEnvVar('SECURE_PROCESSOR_SHOP_ID')
        this.secretKey = getEnvVar('SECURE_PROCESSOR_SECRET_KEY')
        this.publicKey = this.formatPublicKey(getEnvVar('SECURE_PROCESSOR_PUBLIC_KEY'))
        this.testMode = process.env.NEXT_PUBLIC_SECURE_PROCESSOR_TEST_MODE === 'true'
        this.backendBaseUrl = this.resolveBackendBaseUrl()
        this.frontendBaseUrl = this.resolveFrontendBaseUrl()
        this.authHeader = `Basic ${Buffer.from(`${this.shopId}:${this.secretKey}`).toString('base64')}`
    }

    async createCheckoutToken(params: CreateCheckoutParams): Promise<CheckoutTokenResponse> {
        // Implementation for creating checkout token
        // See full implementation in the codebase
        throw new Error('Method not implemented - see full codebase')
    }

    async handleReturn(params: { token: string; status?: string | null; uid?: string | null }): Promise<ReturnHandlingResult> {
        // Implementation for handling return
        // See full implementation in the codebase
        throw new Error('Method not implemented - see full codebase')
    }

    async processWebhook(rawPayload: Buffer, headers: { authorization?: string; contentSignature?: string }): Promise<void> {
        // Implementation for processing webhook
        // See full implementation in the codebase
        throw new Error('Method not implemented - see full codebase')
    }

    private formatPublicKey(key: string): string {
        const normalized = key
            .replace(/-----BEGIN PUBLIC KEY-----/g, '')
            .replace(/-----END PUBLIC KEY-----/g, '')
            .replace(/\r?\n/g, '')
            .replace(/\\n/g, '')
            .trim()

        const wrapped = normalized.match(/.{1,64}/g)?.join('\n') ?? normalized

        return `-----BEGIN PUBLIC KEY-----\n${wrapped}\n-----END PUBLIC KEY-----`
    }

    private resolveBackendBaseUrl(): string {
        const base = getEnvVar('BACKEND_URL').replace(/\/$/, '')
        if (process.env.NODE_ENV === 'production' && base.startsWith('http://')) {
            throw new Error('BACKEND_URL must use HTTPS in production for payment callbacks')
        }
        return base
    }

    private resolveFrontendBaseUrl(): string {
        const raw = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0]?.trim()
        return (raw || 'http://localhost:3000').replace(/\/$/, '')
    }
}
```

**Important:** For the complete service implementation with all methods (createCheckoutToken, handleReturn, processWebhook, etc.), you'll need to copy the full implementation from the codebase or implement them based on Secure Processor API documentation.

---

## Step 7: Create Controller

Create `src/controllers/secure-processor.controller.ts`:

```typescript
import { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { ISecureProcessorPaymentService } from '@/services/secure-processor-service'
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

const returnQuerySchema = z.object({
    token: z.string().min(1),
    status: z.string().optional(),
    uid: z.string().optional(),
})

export class SecureProcessorController {
    constructor(
        private readonly paymentService: ISecureProcessorPaymentService,
        private readonly logger: ILogger
    ) {}

    async createToken(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const parsed = createTokenSchema.safeParse(req.body)

            if (!parsed.success) {
                return res.status(400).json({ message: 'Invalid payment request payload', errors: parsed.error.errors })
            }

            if (!req.user?.id) {
                return res.status(401).json({ message: 'Unauthorized' })
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

                    return res.status(200).json(result)
                }

                const result = await this.paymentService.createCheckoutToken({
                    itemType: 'addon',
                    userId: req.user.id,
                    addonCode: addonPayload.addonCode as any,
                    promoCode: addonPayload.promoCode,
                })

                return res.status(200).json(result)
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
            const parsed = returnQuerySchema.safeParse({
                token: req.query.token,
                status: req.query.status,
                uid: req.query.uid,
            })

            if (!parsed.success) {
                return res.status(400).json({ message: 'Invalid return parameters' })
            }

            const result = await this.paymentService.handleReturn({
                token: parsed.data.token,
                status: parsed.data.status,
                uid: parsed.data.uid,
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
                const params = new URLSearchParams({ status: 'error' })

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
                return res.status(400).json({ message: 'Webhook payload must be a raw buffer' })
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

---

## Step 8: Setup Routes

Create `src/routes/payments.routes.ts`:

```typescript
import express, { Router } from 'express'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { SecureProcessorController } from '@/controllers/secure-processor.controller'
import { ISecureProcessorPaymentService } from '@/services/secure-processor-service'
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

Add routes to your main app:

```typescript
// In your main app file (e.g., src/index.ts or src/app.ts)
import createPaymentsRoutes from '@/routes/payments.routes'

// ... other imports

app.use(createPaymentsRoutes(logger, secureProcessorPaymentService))
```

---

## Step 9: Initialize Service

In your services configuration file (e.g., `src/config/services.config.ts`):

```typescript
import { PaymentTokensRepository } from '@/repositories/payment-tokens-repository'
import { SecureProcessorPaymentService } from '@/services/secure-processor-service'
import { AxiosApiClient } from '@/shared/infra/api'
import { ILogger } from '@/shared/infra/logger/logger.interface'
// Import your database client
// import { pgClient } from '@/db-connection'

export function initializeServices(logger: ILogger, dbClient: Pool) {
    // Initialize repository
    const paymentTokensRepository = new PaymentTokensRepository(dbClient)

    // Initialize payment service
    const secureProcessorPaymentService = new SecureProcessorPaymentService(
        paymentTokensRepository,
        logger,
        new AxiosApiClient('https://checkout.secure-processor.com')
    )

    return {
        secureProcessorPaymentService,
        paymentTokensRepository,
        // ... other services
    }
}
```

---

## Step 10: Testing

### 10.1 Test Token Creation

```bash
curl -X POST http://localhost:4000/payments/secure-processor/token \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -d '{
    "itemType": "plan",
    "planCode": "STARTER",
    "billingPeriod": "monthly"
  }'
```

### 10.2 Test Webhook (Local)

Use a tool like ngrok to expose your local server:

```bash
ngrok http 4000
```

Then configure the webhook URL in Secure Processor dashboard:
`https://your-ngrok-url.ngrok.io/payments/secure-processor/webhook`

### 10.3 Test Return URL

After payment, Secure Processor redirects to:
`/payments/secure-processor/return?token=TOKEN&status=successful`

---

## Frontend Integration

### Frontend: Create Checkout Token

```typescript
async function createCheckoutToken(itemType: 'plan' | 'addon', data: any) {
    const response = await fetch('/api/payments/secure-processor/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
            itemType,
            ...data,
        }),
    })

    if (!response.ok) {
        throw new Error('Failed to create checkout token')
    }

    const { token, checkout } = await response.json()
    return { token, checkout }
}
```

### Frontend: Initialize Secure Processor Widget

```html
<script src="https://js.secure-processor.com/widget/be_gateway.js"></script>
```

```typescript
// After getting token from backend
const widget = new SecureProcessorWidget({
    token: checkout.token,
    testMode: process.env.NEXT_PUBLIC_SECURE_PROCESSOR_TEST_MODE === 'true',
    onSuccess: (data) => {
        // Handle success
        window.location.href = '/payments/success'
    },
    onError: (error) => {
        // Handle error
        console.error('Payment error:', error)
    }
})

widget.open()
```

---

## Security Checklist

- [ ] Webhook signature verification is implemented
- [ ] Basic Authentication is used for webhooks
- [ ] HTTPS is enforced in production
- [ ] Payment tokens are validated before processing
- [ ] User authentication is required for token creation
- [ ] Environment variables are secured
- [ ] Test mode is disabled in production

---

## Troubleshooting

### Common Issues

1. **Token creation fails**
   - Check Secure Processor credentials
   - Verify API connectivity
   - Check logs for detailed error messages

2. **Webhook not received**
   - Verify webhook URL is accessible
   - Check signature verification
   - Ensure webhook endpoint accepts raw body

3. **Payment status not updating**
   - Check database connection
   - Verify webhook processing logs
   - Check for errors in fulfillment logic

---

## Next Steps

1. Implement fulfillment logic (apply purchased plans/add-ons to users)
2. Add promo code support (optional)
3. Add usage tracking
4. Implement flexible top-up calculator
5. Add payment history endpoint
6. Implement refund handling (if needed)

---

## Additional Resources

- Secure Processor Documentation: https://docs.secure-processor.com
- Widget Integration Guide: https://docs.secure-processor.com/en/integration/widget/payment_page/
- API Reference: https://docs.secure-processor.com/en/api/

---

## Notes

- This integration follows clean architecture principles
- All database operations use raw SQL (no ORM)
- Error handling should use your project's error handling pattern
- Logging should be comprehensive for debugging
- The service implementation shown is simplified - refer to the full codebase for complete implementation

