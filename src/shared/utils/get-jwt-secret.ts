import { getEnvVar } from './get-env-var'

let cachedSecret: string | null = null

export function getJwtSecret(): string {
    if (cachedSecret) {
        return cachedSecret
    }

    cachedSecret = getEnvVar('JWT_SECRET')
    return cachedSecret
}
