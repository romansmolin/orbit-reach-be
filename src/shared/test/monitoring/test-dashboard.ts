#!/usr/bin/env ts-node

/**
 * Monitoring Dashboard CLI
 *
 * This script provides a comprehensive monitoring dashboard for the BullMQ post scheduling system.
 * It displays real-time metrics, quota status, and system health across all platforms.
 *
 * Usage:
 *   npm run test:monitoring
 *   ts-node src/test/monitoring/test-dashboard.ts
 *   ts-node src/test/monitoring/test-dashboard.ts --platform=youtube
 *   ts-node src/test/monitoring/test-dashboard.ts --watch
 */

import { PostPlatforms, SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { PlatformConfigManager } from '@/shared/infra/queue/config/platform-config'
import { PlatformRateLimiter } from '@/shared/infra/queue/utils/rate-limiter'
import { YouTubeQuotaManager } from '@/shared/infra/queue/utils/youtube-quota-manager'
import { PostPlatform } from '@/types/posts.types'
import { Redis } from 'ioredis'


interface DashboardData {
    timestamp: string
    platforms: Array<{
        platform: PostPlatform
        status: 'healthy' | 'degraded' | 'critical'
        metrics: {
            successRate: number
            errorRate: number
            totalJobs: number
            avgProcessingTime: number
        }
        quotas: {
            perAccount: any
            perApp: any
        }
        warnings: string[]
    }>
    systemHealth: {
        redis: 'connected' | 'disconnected'
        totalPlatforms: number
        healthyPlatforms: number
        degradedPlatforms: number
        criticalPlatforms: number
    }
}

class MonitoringDashboard {
    private redis: Redis
    private rateLimiter: PlatformRateLimiter
    private youtubeQuotaManager: YouTubeQuotaManager
    private isWatchMode: boolean = false
    private targetPlatform?: PostPlatform

    constructor() {
        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD,
        })

        this.rateLimiter = new PlatformRateLimiter(this.redis)
        this.youtubeQuotaManager = new YouTubeQuotaManager(this.redis)

        // Parse command line arguments
        this.parseArgs()
    }

    private parseArgs(): void {
        const args = process.argv.slice(2)

        for (const arg of args) {
            if (arg === '--watch') {
                this.isWatchMode = true
            } else if (arg.startsWith('--platform=')) {
                const platform = arg.split('=')[1] as PostPlatform
                if (PostPlatforms.includes(platform)) {
                    this.targetPlatform = platform
                } else {
                    console.error(`❌ Invalid platform: ${platform}`)
                    console.error(`Valid platforms: ${PostPlatforms.join(', ')}`)
                    process.exit(1)
                }
            }
        }
    }

    async run(): Promise<void> {
        console.log('🚀 Starting Monitoring Dashboard...\n')

        if (this.isWatchMode) {
            await this.watchMode()
        } else {
            await this.displayDashboard()
        }
    }

    private async watchMode(): Promise<void> {
        console.log('👀 Watch mode enabled - refreshing every 5 seconds...\n')

        while (true) {
            // Clear screen
            console.clear()

            await this.displayDashboard()

            console.log('\n⏰ Refreshing in 5 seconds... (Ctrl+C to exit)')
            await this.sleep(5000)
        }
    }

    private async displayDashboard(): Promise<void> {
        try {
            const data = await this.collectDashboardData()
            this.renderDashboard(data)
        } catch (error) {
            console.error('❌ Error collecting dashboard data:', error)
        }
    }

    private async collectDashboardData(): Promise<DashboardData> {
        const platforms = this.targetPlatform ? [this.targetPlatform] : PostPlatforms
        const platformData = []

        for (const platform of platforms) {
            try {
                const config = PlatformConfigManager.getConfig(platform)
                const metrics = await this.getPlatformMetrics(platform)
                const quotas = await this.getPlatformQuotas(platform)
                const warnings = this.generateWarnings(platform, metrics, quotas)

                platformData.push({
                    platform,
                    status: this.determinePlatformStatus(metrics, quotas, warnings),
                    metrics,
                    quotas,
                    warnings,
                })
            } catch (error) {
                console.warn(`⚠️  Failed to collect data for ${platform}:`, error)
                platformData.push({
                    platform,
                    status: 'critical' as const,
                    metrics: {
                        successRate: 0,
                        errorRate: 100,
                        totalJobs: 0,
                        avgProcessingTime: 0,
                    },
                    quotas: { perAccount: null, perApp: null },
                    warnings: [`Failed to collect data: ${error}`],
                })
            }
        }

        const systemHealth = await this.getSystemHealth(platformData)

        return {
            timestamp: new Date().toISOString(),
            platforms: platformData,
            systemHealth,
        }
    }

    private async getPlatformMetrics(platform: PostPlatform): Promise<{
        successRate: number
        errorRate: number
        totalJobs: number
        avgProcessingTime: number
    }> {
        // Mock metrics for now - you can integrate with your actual metrics collection
        const now = Date.now()
        const hourKey = Math.floor(now / (60 * 60 * 1000))

        const successKey = `metrics:${platform}:success:hourly:${hourKey}`
        const errorKey = `metrics:${platform}:error:hourly:${hourKey}`
        const totalKey = `metrics:${platform}:total:hourly:${hourKey}`
        const durationKey = `metrics:${platform}:duration_sum:hourly:${hourKey}`
        const countKey = `metrics:${platform}:duration_count:hourly:${hourKey}`

        const [successCount, errorCount, totalCount, durationSum, durationCount] = await Promise.all([
            this.redis.get(successKey).then((v) => parseInt(v || '0')),
            this.redis.get(errorKey).then((v) => parseInt(v || '0')),
            this.redis.get(totalKey).then((v) => parseInt(v || '0')),
            this.redis.get(durationKey).then((v) => parseInt(v || '0')),
            this.redis.get(countKey).then((v) => parseInt(v || '0')),
        ])

        const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0
        const errorRate = totalCount > 0 ? (errorCount / totalCount) * 100 : 0
        const avgProcessingTime = durationCount > 0 ? durationSum / durationCount : 0

        return {
            successRate: Math.round(successRate * 100) / 100,
            errorRate: Math.round(errorRate * 100) / 100,
            totalJobs: totalCount,
            avgProcessingTime: Math.round(avgProcessingTime),
        }
    }

    private async getPlatformQuotas(platform: PostPlatform): Promise<{
        perAccount: any
        perApp: any
    }> {
        try {
            // Mock user ID for demo
            const userId = 'demo-user-123'

            const perAccount = await this.rateLimiter.checkRateLimit(platform, userId)

            let perApp = null
            if (platform === SocilaMediaPlatform.YOUTUBE) {
                perApp = await this.youtubeQuotaManager.getQuotaBudget(platform)
            } else {
                // For other platforms, get app-level daily limit
                const config = PlatformConfigManager.getConfig(platform)
                const limits = config.limits
                if (limits.appDailyLimit) {
                    const now = Date.now()
                    const dayStart = new Date(now)
                    dayStart.setHours(0, 0, 0, 0)
                    const key = `app_rate_limit:${platform}:daily:${dayStart.getTime()}`
                    const used = await this.redis.get(key)
                    perApp = {
                        used: parseInt(used || '0'),
                        limit: limits.appDailyLimit,
                        remaining: Math.max(0, limits.appDailyLimit - parseInt(used || '0')),
                    }
                }
            }

            return { perAccount, perApp }
        } catch (error) {
            return { perAccount: null, perApp: null }
        }
    }

    private generateWarnings(platform: PostPlatform, metrics: any, quotas: any): string[] {
        const warnings: string[] = []

        if (metrics.errorRate > 20) {
            warnings.push(`High error rate: ${metrics.errorRate}%`)
        }

        if (metrics.successRate < 80) {
            warnings.push(`Low success rate: ${metrics.successRate}%`)
        }

        if (quotas.perApp && quotas.perApp.remaining !== undefined) {
            const usagePercent = ((quotas.perApp.limit - quotas.perApp.remaining) / quotas.perApp.limit) * 100
            if (usagePercent > 90) {
                warnings.push(`App quota nearly exhausted: ${usagePercent.toFixed(1)}% used`)
            }
        }

        if (quotas.perAccount && quotas.perAccount.remainingQuota !== undefined) {
            if (quotas.perAccount.remainingQuota < 5) {
                warnings.push(`Low per-account quota: ${quotas.perAccount.remainingQuota} remaining`)
            }
        }

        return warnings
    }

    private determinePlatformStatus(
        metrics: any,
        quotas: any,
        warnings: string[]
    ): 'healthy' | 'degraded' | 'critical' {
        if (metrics.errorRate > 50 || warnings.some((w) => w.includes('exhausted'))) {
            return 'critical'
        }

        if (metrics.errorRate > 20 || metrics.successRate < 80 || warnings.length > 0) {
            return 'degraded'
        }

        return 'healthy'
    }

    private async getSystemHealth(platformData: any[]): Promise<{
        redis: 'connected' | 'disconnected'
        totalPlatforms: number
        healthyPlatforms: number
        degradedPlatforms: number
        criticalPlatforms: number
    }> {
        let redisStatus: 'connected' | 'disconnected' = 'disconnected'

        try {
            await this.redis.ping()
            redisStatus = 'connected'
        } catch (error) {
            // Redis disconnected
        }

        const healthyPlatforms = platformData.filter((p) => p.status === 'healthy').length
        const degradedPlatforms = platformData.filter((p) => p.status === 'degraded').length
        const criticalPlatforms = platformData.filter((p) => p.status === 'critical').length

        return {
            redis: redisStatus,
            totalPlatforms: platformData.length,
            healthyPlatforms,
            degradedPlatforms,
            criticalPlatforms,
        }
    }

    private renderDashboard(data: DashboardData): void {
        console.log('📊 BULLMQ POST SCHEDULING DASHBOARD')
        console.log('='.repeat(50))
        console.log(`🕐 ${data.timestamp}`)
        console.log()

        // System Health
        this.renderSystemHealth(data.systemHealth)
        console.log()

        // Platform Status
        this.renderPlatformStatus(data.platforms)
        console.log()

        // Summary
        this.renderSummary(data)
    }

    private renderSystemHealth(health: any): void {
        console.log('🏥 SYSTEM HEALTH')
        console.log('-'.repeat(20))

        const redisIcon = health.redis === 'connected' ? '✅' : '❌'
        console.log(`${redisIcon} Redis: ${health.redis.toUpperCase()}`)
        console.log(`📊 Platforms: ${health.totalPlatforms} total`)
        console.log(`✅ Healthy: ${health.healthyPlatforms}`)
        console.log(`⚠️  Degraded: ${health.degradedPlatforms}`)
        console.log(`❌ Critical: ${health.criticalPlatforms}`)
    }

    private renderPlatformStatus(platforms: any[]): void {
        console.log('🎯 PLATFORM STATUS')
        console.log('-'.repeat(20))

        for (const platform of platforms) {
            const statusIcon = platform.status === 'healthy' ? '✅' : platform.status === 'degraded' ? '⚠️' : '❌'

            console.log(`\n${statusIcon} ${platform.platform.toUpperCase()}`)
            console.log(`   Success Rate: ${platform.metrics.successRate}%`)
            console.log(`   Error Rate: ${platform.metrics.errorRate}%`)
            console.log(`   Total Jobs: ${platform.metrics.totalJobs}`)
            console.log(`   Avg Time: ${platform.metrics.avgProcessingTime}ms`)

            if (platform.quotas.perApp) {
                console.log(`   App Quota: ${platform.quotas.perApp.remaining || 'N/A'} remaining`)
            }

            if (platform.warnings.length > 0) {
                console.log(`   ⚠️  Warnings:`)
                platform.warnings.forEach((warning: string) => {
                    console.log(`      • ${warning}`)
                })
            }
        }
    }

    private renderSummary(data: DashboardData): void {
        console.log('📈 SUMMARY')
        console.log('-'.repeat(20))

        const totalJobs = data.platforms.reduce((sum, p) => sum + p.metrics.totalJobs, 0)
        const avgSuccessRate = data.platforms.reduce((sum, p) => sum + p.metrics.successRate, 0) / data.platforms.length
        const criticalPlatforms = data.platforms.filter((p) => p.status === 'critical').length

        console.log(`📊 Total Jobs Processed: ${totalJobs}`)
        console.log(`📈 Average Success Rate: ${avgSuccessRate.toFixed(1)}%`)
        console.log(`🚨 Critical Platforms: ${criticalPlatforms}`)

        if (data.systemHealth.redis === 'disconnected') {
            console.log(`\n❌ WARNING: Redis is disconnected!`)
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    async cleanup(): Promise<void> {
        await this.redis.quit()
    }
}

// Main execution
async function main() {
    const dashboard = new MonitoringDashboard()

    try {
        await dashboard.run()
    } catch (error) {
        console.error('❌ Dashboard error:', error)
        process.exit(1)
    } finally {
        await dashboard.cleanup()
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down dashboard...')
    process.exit(0)
})

if (require.main === module) {
    main()
}
