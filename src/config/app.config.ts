import bodyParser from 'body-parser'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import express from 'express'
import { ILogger } from '@/shared/infra/logger/logger.interface'

const normalizeOrigin = (origin: string) => origin.trim().replace(/\/$/, '').toLowerCase()

export function createApp(logger: ILogger) {
    void logger
    const app = express()

    app.set('trust proxy', 1)

    app.use('/webhooks/stripe', express.raw({ type: 'application/json' }))
    app.use('/payments/secure-processor/webhook', express.raw({ type: '*/*' }))

    app.use(express.json())
    app.use(bodyParser.urlencoded({ extended: true }))
    app.use(bodyParser.json())

    app.use(cookieParser())

    const defaultOrigins = [
        'http://localhost:3000',
        'http://127.0.0.1:4040',
        'https://obitreach.com',
        'https://www.obitreach.com',
    ]

    const envOrigins = [process.env.FRONTEND_URL].filter(Boolean).flatMap((value) =>
        value!
            .split(',')
            .map((origin) => normalizeOrigin(origin))
            .filter(Boolean)
    )

    const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins].map(normalizeOrigin)))

    app.use(
        cors({
            origin: (requestOrigin, callback) => {
                if (!requestOrigin) {
                    return callback(null, true)
                }

                const normalizedOrigin = normalizeOrigin(requestOrigin)

                if (allowedOrigins.includes(normalizedOrigin)) {
                    return callback(null, true)
                }

                return callback(null, false)
            },
            credentials: true,
        })
    )

    return app
}
