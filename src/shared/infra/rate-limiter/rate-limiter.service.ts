import type { Request, Response, NextFunction, RequestHandler } from 'express'
import Redis from 'ioredis'
import {
    RateLimiterRedis,
    RateLimiterMemory,
    RateLimiterAbstract,
    RateLimiterRes,
} from 'rate-limiter-flexible'

import { redisConnection } from '@/shared/infra/queue/scheduler/redis'
import { ILogger } from '@/shared/infra/logger/logger.interface'

function normalizeIp(ip?: string | null): string {
    if (!ip) return ''
    if (ip === '::1') return '127.0.0.1'
    if (ip.startsWith('::ffff:')) return ip.slice(7)
    return ip
}

function parseTrustedProxyEnv(): string[] {
    return (process.env.RATE_LIMIT_TRUSTED_PROXY_IPS || '')
        .split(',')
        .map((ip) => normalizeIp(ip.trim()))
        .filter(Boolean)
}

export interface RateLimiterConfig {
    keyPrefix: string
    points: number
    duration: number
    blockDuration?: number
    customResponseMessage?: string
    /**
     * Allows skipping specific requests (e.g. health checks or webhooks)
     */
    skip?: (req: Request) => boolean
    /**
     * Custom key resolver (defaults to client IP)
     */
    getKey?: (req: Request) => string
}

export class RateLimiterService {
    private readonly logger: ILogger
    private readonly redisClient?: Redis
    private readonly trustedProxyIps: Set<string>

    constructor(logger: ILogger, redisClient?: Redis, trustedProxies: string[] = parseTrustedProxyEnv()) {
        this.logger = logger
        this.redisClient = redisClient
        this.trustedProxyIps = new Set(trustedProxies.map((ip) => normalizeIp(ip)))
    }

    private createLimiter(config: RateLimiterConfig): RateLimiterAbstract {
        if (this.redisClient) {
            return new RateLimiterRedis({
                storeClient: this.redisClient,
                keyPrefix: config.keyPrefix,
                points: config.points,
                duration: config.duration,
                blockDuration: config.blockDuration,
            })
        }

        // Fallback to in-memory limiter if Redis is not available
        return new RateLimiterMemory({
            keyPrefix: config.keyPrefix,
            points: config.points,
            duration: config.duration,
            blockDuration: config.blockDuration,
        })
    }

    createMiddleware(config: RateLimiterConfig): RequestHandler {
        const limiter = this.createLimiter(config)

        return async (req: Request, res: Response, next: NextFunction) => {
            try {
                if (config.skip?.(req)) {
                    return next()
                }

                const key = config.getKey?.(req) ?? this.resolveClientKey(req)
                const result = await limiter.consume(key)

                res.setHeader('X-RateLimit-Remaining', String(result.remainingPoints))
                res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.msBeforeNext / 1000)))

                next()
            } catch (error) {
                if (error instanceof RateLimiterRes) {
                    res.setHeader('Retry-After', String(Math.ceil(error.msBeforeNext / 1000)))
                    res.status(429).json({
                        code: 'RATE_LIMIT_EXCEEDED',
                        message: config.customResponseMessage || 'Too many requests. Please try again later.',
                        status: 429,
                    })
                    return
                }

                const formattedError =
                    error instanceof Error
                        ? { name: error.name, message: error.message, stack: error.stack }
                        : { name: 'UnknownError', message: 'Rate limiter middleware failed' }

                this.logger.error('Rate limiter middleware failed', {
                    error: formattedError,
                })

                next(error)
            }
        }
    }

    private resolveClientKey(req: Request): string {
        const remoteAddress = normalizeIp(req.socket.remoteAddress) || normalizeIp(req.ip)

        if (this.trustedProxyIps.size > 0 && this.trustedProxyIps.has(remoteAddress)) {
            const forwarded = this.extractForwardedClient(req.headers['x-forwarded-for'])
            if (forwarded) {
                return forwarded
            }
        }

        return remoteAddress || 'unknown'
    }

    private extractForwardedClient(forwardedHeader: string | string[] | undefined): string | null {
        if (!forwardedHeader) {
            return null
        }

        const rawValue = Array.isArray(forwardedHeader) ? forwardedHeader[0] : forwardedHeader
        if (!rawValue) {
            return null
        }

        const firstIp = rawValue.split(',')[0]?.trim()
        if (!firstIp) {
            return null
        }

        return normalizeIp(firstIp)
    }
}

export function createDefaultRateLimiterService(logger: ILogger): RateLimiterService {
    const redisClient = new Redis(redisConnection)
    return new RateLimiterService(logger, redisClient)
}
