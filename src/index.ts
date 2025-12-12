import { createApp, initializeServices, configureRoutes } from '@/config'
import { createErrorMiddleware } from '@/middleware/errors.middleware'

async function startServer() {
    const services = initializeServices()
    const app = createApp(services.logger)

    app.use(
        services.rateLimiterService.createMiddleware({
            keyPrefix: process.env.API_RATE_LIMIT_PREFIX || 'global_api',
            points: Number(process.env.API_RATE_LIMIT_POINTS || 300),
            duration: Number(process.env.API_RATE_LIMIT_DURATION || 60),
            blockDuration: Number(process.env.API_RATE_LIMIT_BLOCK_DURATION || 60),
            skip: (req) =>
                req.path.startsWith('/webhooks/stripe') ||
                req.path.startsWith('/payments/secure-processor/webhook'),
            customResponseMessage: 'Too many requests from this IP. Please slow down.',
        })
    )

    configureRoutes(app, services)

    app.use(createErrorMiddleware(services.logger))

    const port = process.env.PORT || 4000

    app.listen(port, () => {
        services.logger.info(`API server is running on port ${port}`)
        services.logger.info('BullMQ workers are expected to run via the separate worker entry point.')
    })
}

startServer().catch((error) => {
    console.error('Failed to start server:', error)
    process.exit(1)
})
