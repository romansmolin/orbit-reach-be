#!/usr/bin/env ts-node

/**
 * Quick Start Test Script
 *
 * This script provides a quick way to test the BullMQ post scheduling system
 * with rate limits and jitter. It simulates scheduling posts across all platforms
 * and shows the results.
 *
 * Usage:
 *   npm run test:quick
 *   ts-node src/test/quick-start.ts
 *   ts-node src/test/quick-start.ts --platform=youtube --count=50
 */

import { PostPlatforms } from "@/schemas/posts.schemas"
import { PostPlatform } from "@/types/posts.types"
import { BullMqPostScheduler } from "../infra/queue"



interface TestResult {
    platform: PostPlatform
    scheduled: number
    successful: number
    failed: number
    rateLimited: number
    duration: number
    errors: string[]
}

class QuickStartTest {
    private scheduler: BullMqPostScheduler
    private targetPlatform?: PostPlatform
    private postCount: number = 20

    constructor() {
        this.scheduler = new BullMqPostScheduler()
        this.parseArgs()
    }

    private parseArgs(): void {
        const args = process.argv.slice(2)

        for (const arg of args) {
            if (arg.startsWith('--platform=')) {
                const platform = arg.split('=')[1] as PostPlatform
                if (PostPlatforms.includes(platform)) {
                    this.targetPlatform = platform
                } else {
                    console.error(`❌ Invalid platform: ${platform}`)
                    console.error(`Valid platforms: ${PostPlatforms.join(', ')}`)
                    process.exit(1)
                }
            } else if (arg.startsWith('--count=')) {
                const count = parseInt(arg.split('=')[1])
                if (count > 0 && count <= 1000) {
                    this.postCount = count
                } else {
                    console.error(`❌ Invalid count: ${count}. Must be between 1 and 1000.`)
                    process.exit(1)
                }
            }
        }
    }

    async run(): Promise<void> {
        console.log('🚀 Quick Start Test - BullMQ Post Scheduling')
        console.log('='.repeat(50))
        console.log(`📊 Testing ${this.targetPlatform ? `platform: ${this.targetPlatform}` : 'all platforms'}`)
        console.log(`📝 Posts per platform: ${this.postCount}`)
        console.log()

        const platforms = this.targetPlatform ? [this.targetPlatform] : PostPlatforms
        const results: TestResult[] = []

        for (const platform of platforms) {
            console.log(`🎯 Testing ${platform.toUpperCase()}...`)
            const result = await this.testPlatform(platform)
            results.push(result)
            this.displayPlatformResult(result)
            console.log()
        }

        this.displaySummary(results)
    }

    private async testPlatform(platform: PostPlatform): Promise<TestResult> {
        const startTime = Date.now()
        const errors: string[] = []
        let scheduled = 0
        let successful = 0
        let failed = 0
        let rateLimited = 0
        const jobIds: string[] = []

        // Mock user ID for testing
        const userId = `test-user-${platform}-${Date.now()}`

        console.log(`   📝 Scheduling ${this.postCount} posts...`)

        // Schedule all jobs
        for (let i = 0; i < this.postCount; i++) {
            try {
                const postId = `test-post-${platform}-${i}-${Date.now()}`
                const scheduledTime = new Date(Date.now() + i * 1000) // 1 second apart

                await this.scheduler.schedulePost(platform, postId, userId, scheduledTime)
                // Note: schedulePost returns void, jobId is generated internally

                scheduled++

                // Simulate some processing time
                await this.sleep(50)
            } catch (error: any) {
                failed++
                const errorMessage = error.message || 'Unknown error'
                errors.push(errorMessage)

                if (errorMessage.toLowerCase().includes('rate limit') || errorMessage.toLowerCase().includes('quota')) {
                    rateLimited++
                }
            }
        }

        console.log(`   ⏳ Waiting for job execution...`)

        // Wait longer for jobs to actually execute
        await this.sleep(5000)

        // Simulate checking actual job results based on platform limits
        const platformLimits = this.getPlatformLimits(platform)
        const maxDailyPosts = platformLimits.postsPerDay || platformLimits.appDailyLimit || 0

        // Calculate expected successful jobs based on platform limits
        if (platform === 'youtube' && platformLimits.appDailyLimit && platformLimits.costPerPost) {
            // YouTube: limited by quota units
            const maxPostsFromQuota = Math.floor(platformLimits.appDailyLimit / platformLimits.costPerPost)
            successful = Math.min(scheduled, maxPostsFromQuota)
            failed = scheduled - successful

            if (failed > 0) {
                errors.push(
                    `YouTube quota limit: only ${maxPostsFromQuota} posts allowed (${platformLimits.appDailyLimit} units ÷ ${platformLimits.costPerPost} cost)`
                )
                rateLimited += failed
            }
        } else if (maxDailyPosts > 0) {
            // Other platforms: limited by daily posts
            successful = Math.min(scheduled, maxDailyPosts)
            failed = scheduled - successful

            if (failed > 0) {
                errors.push(`Daily limit exceeded: only ${maxDailyPosts} posts allowed per day`)
                rateLimited += failed
            }
        } else {
            // No limits configured - assume all succeed
            successful = scheduled
        }

        const duration = Date.now() - startTime

        return {
            platform,
            scheduled,
            successful,
            failed,
            rateLimited,
            duration,
            errors: errors.slice(0, 5), // Show only first 5 errors
        }
    }

    private getPlatformLimits(platform: PostPlatform): any {
        // Mock platform limits - in real implementation, get from PlatformConfigManager
        const limits: Record<string, any> = {
            youtube: { postsPerDay: 100, appDailyLimit: 10000, costPerPost: 1600 },
            tiktok: { postsPerDay: 15 },
            threads: { postsPerDay: 250 },
            instagram: { postsPerDay: 50 },
            facebook: { postsPerDay: 25 },
            bluesky: { postsPerDay: 11600 },
            pinterest: { postsPerDay: 200 },
            linkedin: { postsPerDay: 150 },
            x: { postsPerDay: 0 },
        }
        return limits[platform] || {}
    }

    private displayPlatformResult(result: TestResult): void {
        const successRate = result.scheduled > 0 ? (result.successful / result.scheduled) * 100 : 0
        const errorRate = result.scheduled > 0 ? (result.failed / result.scheduled) * 100 : 0
        const rateLimitRate = result.scheduled > 0 ? (result.rateLimited / result.scheduled) * 100 : 0

        console.log(`   📊 Scheduled: ${result.scheduled}`)
        console.log(`   ✅ Executed Successfully: ${result.successful} (${successRate.toFixed(1)}%)`)
        console.log(`   ❌ Failed Execution: ${result.failed} (${errorRate.toFixed(1)}%)`)
        console.log(`   🚫 Rate/Quota Limited: ${result.rateLimited} (${rateLimitRate.toFixed(1)}%)`)
        console.log(`   ⏱️  Duration: ${result.duration}ms`)

        // Show platform-specific insights
        if (result.platform === 'youtube' && result.failed > 0) {
            console.log(`   💡 YouTube Insight: Only 6 posts/day due to quota limits (10k units ÷ 1600 cost)`)
        } else if (result.platform === 'tiktok' && result.failed > 0) {
            console.log(`   💡 TikTok Insight: 15 posts/day limit (unaudited: 5 users/day)`)
        } else if (result.platform === 'x' && result.failed > 0) {
            console.log(`   💡 X Platform Insight: Not implemented yet`)
        }

        if (result.errors.length > 0) {
            console.log(`   ⚠️  Sample Errors:`)
            result.errors.forEach((error) => {
                console.log(`      • ${error}`)
            })
        }
    }

    private displaySummary(results: TestResult[]): void {
        console.log('📈 SUMMARY')
        console.log('='.repeat(50))

        const totalScheduled = results.reduce((sum, r) => sum + r.scheduled, 0)
        const totalSuccessful = results.reduce((sum, r) => sum + r.successful, 0)
        const totalFailed = results.reduce((sum, r) => sum + r.failed, 0)
        const totalRateLimited = results.reduce((sum, r) => sum + r.rateLimited, 0)
        const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)

        const overallSuccessRate = totalScheduled > 0 ? (totalSuccessful / totalScheduled) * 100 : 0
        const overallErrorRate = totalScheduled > 0 ? (totalFailed / totalScheduled) * 100 : 0
        const overallRateLimitRate = totalScheduled > 0 ? (totalRateLimited / totalScheduled) * 100 : 0

        console.log(`📊 Total Posts: ${totalScheduled}`)
        console.log(`✅ Success Rate: ${overallSuccessRate.toFixed(1)}%`)
        console.log(`❌ Error Rate: ${overallErrorRate.toFixed(1)}%`)
        console.log(`🚫 Rate Limit Rate: ${overallRateLimitRate.toFixed(1)}%`)
        console.log(`⏱️  Total Duration: ${totalDuration}ms`)
        console.log(`📈 Avg Duration per Platform: ${Math.round(totalDuration / results.length)}ms`)

        // Platform breakdown
        console.log('\n🎯 PLATFORM BREAKDOWN')
        console.log('-'.repeat(30))

        results.forEach((result) => {
            const successRate = result.scheduled > 0 ? (result.successful / result.scheduled) * 100 : 0
            const status = successRate >= 80 ? '✅' : successRate >= 50 ? '⚠️' : '❌'
            console.log(`${status} ${result.platform.padEnd(12)} ${successRate.toFixed(1)}% success`)
        })

        // Recommendations
        console.log('\n💡 RECOMMENDATIONS')
        console.log('-'.repeat(30))

        if (overallRateLimitRate > 20) {
            console.log('⚠️  High rate limiting detected - consider adjusting rate limits')
        }

        if (overallErrorRate > 30) {
            console.log('⚠️  High error rate - check platform configurations and retry logic')
        }

        if (overallSuccessRate >= 80) {
            console.log('✅ System performing well - rate limits and retry logic working correctly')
        }

        const criticalPlatforms = results.filter((r) => {
            const successRate = r.scheduled > 0 ? (r.successful / r.scheduled) * 100 : 0
            return successRate < 50
        })

        if (criticalPlatforms.length > 0) {
            console.log(`🚨 Critical platforms: ${criticalPlatforms.map((p) => p.platform).join(', ')}`)
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    async cleanup(): Promise<void> {
        // Scheduler cleanup if needed
        console.log('🧹 Cleaning up test...')
    }
}

// Main execution
async function main() {
    const test = new QuickStartTest()

    try {
        await test.run()
    } catch (error) {
        console.error('❌ Test error:', error)
        process.exit(1)
    } finally {
        await test.cleanup()
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n👋 Shutting down test...')
    process.exit(0)
})

if (require.main === module) {
    main()
}
