import bodyParser from 'body-parser'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import express from 'express'
import { ILogger } from '@/shared/infra/logger/logger.interface'

export function createApp(logger: ILogger) {
    void logger
    const app = express()

    app.set('trust proxy', 1)

    app.use('/webhooks/stripe', express.raw({ type: 'application/json' }))

    app.use(express.json())
    app.use(bodyParser.urlencoded({ extended: true }))
    app.use(bodyParser.json())

    app.use(cookieParser())

    const defaultOrigins = ['http://localhost:3000', 'http://127.0.0.1:4040']

    const envOrigins = [process.env.FRONTEND_URL].filter(Boolean).flatMap((value) =>
        value!
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
    )

    const allowedOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]))

    app.use(
        cors({
            origin: allowedOrigins,
            credentials: true,
        })
    )

    return app
}
