import crypto from 'crypto'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { getEnvVar } from '@/shared/utils/get-env-var'

const STATE_VERSION = 1

export interface OAuthStatePayload {
    userId: string
    platform: string
    reconnect?: boolean
    codeVerifier?: string
    metadata?: Record<string, unknown>
}

interface OAuthStateTokenPayload extends OAuthStatePayload {
    nonce: string
    issuedAt: number
    expiresAt: number
    version: number
}

export interface IOAuthStateService {
    issueState(payload: OAuthStatePayload): string
    verifyState(token: string): OAuthStatePayload
}

export class OAuthStateService implements IOAuthStateService {
    private readonly logger: ILogger
    private readonly secret: string
    private readonly ttlMs: number

    constructor(logger: ILogger, ttlSeconds = Number(process.env.OAUTH_STATE_TTL_SECONDS || 600)) {
        this.logger = logger
        this.secret = getEnvVar('OAUTH_STATE_SECRET')
        this.ttlMs = Math.max(ttlSeconds, 60) * 1000
    }

    issueState(payload: OAuthStatePayload): string {
        const tokenPayload: OAuthStateTokenPayload = {
            ...payload,
            nonce: crypto.randomUUID(),
            issuedAt: Date.now(),
            expiresAt: Date.now() + this.ttlMs,
            version: STATE_VERSION,
        }

        const serializedPayload = JSON.stringify(tokenPayload)
        const signature = this.sign(serializedPayload)
        const encodedPayload = Buffer.from(serializedPayload).toString('base64url')

        return `${encodedPayload}.${signature}`
    }

    verifyState(token: string): OAuthStatePayload {
        const [encodedPayload, providedSignature] = token.split('.')

        if (!encodedPayload || !providedSignature) {
            throw new BaseAppError('Invalid OAuth state parameter', ErrorCode.BAD_REQUEST, 400)
        }

        const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8')
        const expectedSignature = this.sign(payloadJson)

        if (!this.isSignatureValid(providedSignature, expectedSignature)) {
            this.logger.warn('OAuth state signature mismatch detected')
            throw new BaseAppError('Invalid OAuth state signature', ErrorCode.BAD_REQUEST, 400)
        }

        let payload: OAuthStateTokenPayload
        try {
            payload = JSON.parse(payloadJson) as OAuthStateTokenPayload
        } catch {
            throw new BaseAppError('Malformed OAuth state payload', ErrorCode.BAD_REQUEST, 400)
        }

        if (payload.version !== STATE_VERSION) {
            throw new BaseAppError('Unsupported OAuth state token version', ErrorCode.BAD_REQUEST, 400)
        }

        if (payload.expiresAt < Date.now()) {
            throw new BaseAppError('OAuth state has expired', ErrorCode.BAD_REQUEST, 400)
        }

        return {
            userId: payload.userId,
            platform: payload.platform,
            reconnect: payload.reconnect,
            codeVerifier: payload.codeVerifier,
            metadata: payload.metadata,
        }
    }

    private sign(value: string): string {
        return crypto.createHmac('sha256', this.secret).update(value).digest('base64url')
    }

    private isSignatureValid(provided: string, expected: string): boolean {
        const providedBuffer = Buffer.from(provided)
        const expectedBuffer = Buffer.from(expected)

        if (providedBuffer.length !== expectedBuffer.length) {
            return false
        }

        return crypto.timingSafeEqual(providedBuffer, expectedBuffer)
    }
}
