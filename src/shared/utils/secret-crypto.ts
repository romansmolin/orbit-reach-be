import crypto from 'crypto'
import { BaseAppError } from '@/shared/errors/base-error'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { getEnvVar } from './get-env-var'

const ENCRYPTION_PREFIX = 'enc:'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

let cachedKey: Buffer | null = null

function getEncryptionKey(): Buffer {
    if (cachedKey) {
        return cachedKey
    }

    const secret = getEnvVar('SOCIAL_TOKEN_ENCRYPTION_KEY')
    const buffer =
        secret.length === 44 && secret.endsWith('=')
            ? Buffer.from(secret, 'base64')
            : Buffer.from(secret, 'utf8')

    if (buffer.length !== 32) {
        throw new BaseAppError(
            'SOCIAL_TOKEN_ENCRYPTION_KEY must resolve to a 32 byte value',
            ErrorCode.UNKNOWN_ERROR,
            500
        )
    }

    cachedKey = buffer
    return cachedKey
}

export function encryptSecret(value?: string | null): string | null {
    if (!value) return value ?? null

    const key = getEncryptionKey()
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    const payload = Buffer.concat([iv, authTag, encrypted]).toString('base64')
    return `${ENCRYPTION_PREFIX}${payload}`
}

export function decryptSecret(value?: string | null): string | null {
    if (!value) return value ?? null
    if (!value.startsWith(ENCRYPTION_PREFIX)) {
        return value
    }

    const raw = Buffer.from(value.slice(ENCRYPTION_PREFIX.length), 'base64')
    if (raw.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
        throw new BaseAppError('Encrypted payload is malformed', ErrorCode.UNKNOWN_ERROR, 500)
    }

    const iv = raw.subarray(0, IV_LENGTH)
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
    const key = getEncryptionKey()
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
}
