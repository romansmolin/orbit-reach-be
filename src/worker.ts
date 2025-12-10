import { initializeServices, initializeWorkers } from '@/config'

async function startWorkers() {
    const services = initializeServices()

    await initializeWorkers(
        services.logger,
        services.socialMediaPostSender,
        services.socialMediaTokenRefresher,
        services.postsService,
        services.userService
    )

    services.logger.info('BullMQ workers started successfully')
}

startWorkers().catch((error) => {
    console.error('Failed to start workers:', error)
    process.exit(1)
})
