#!/usr/bin/env ts-node

/**
 * Audit Metrics Calculator
 *
 * This script calculates detailed metrics for audit purposes, including
 * how many days it will take to publish all posts for each platform.
 *
 * Usage:
 *   npx ts-node src/test/audit-metrics.ts
 */

import { PostPlatforms, SocilaMediaPlatform } from "@/schemas/posts.schemas"
import { PostPlatform } from "@/types/posts.types"
import { PlatformConfigManager } from "../infra/queue/config/platform-config"



interface PlatformMetrics {
    platform: PostPlatform
    dailyLimit: number
    postsToPublish: number
    daysToComplete: number
    postsPerDay: number
    efficiency: number
    auditStatus: 'READY' | 'NEEDS_REVIEW' | 'NOT_READY'
    restrictionType: 'per-account' | 'per-app' | 'both'
    recommendations: string[]
}

class AuditMetricsCalculator {
    private platforms = PostPlatforms.filter((p) => p !== SocilaMediaPlatform.X) // Exclude X platform

    calculateMetrics(): PlatformMetrics[] {
        const results: PlatformMetrics[] = []

        for (const platform of this.platforms) {
            const config = PlatformConfigManager.getConfig(platform)
            const limits = config.limits

            // Get daily limits
            let dailyLimit = limits.postsPerDay || limits.appDailyLimit || 0

            // Special case for YouTube: calculate based on quota units
            if (platform === SocilaMediaPlatform.YOUTUBE && limits.appDailyLimit && limits.costPerPost) {
                dailyLimit = Math.floor(limits.appDailyLimit / limits.costPerPost)
            }

            const postsToPublish = 2 // Test scenario

            // Calculate days to complete
            const daysToComplete = dailyLimit > 0 ? Math.ceil(postsToPublish / dailyLimit) : Infinity
            const postsPerDay = dailyLimit
            const efficiency = dailyLimit > 0 ? (postsToPublish / (daysToComplete * dailyLimit)) * 100 : 0

            // Determine audit status
            let auditStatus: 'READY' | 'NEEDS_REVIEW' | 'NOT_READY' = 'READY'
            const recommendations: string[] = []

            if (daysToComplete === Infinity) {
                auditStatus = 'NOT_READY'
                recommendations.push('No daily limit configured')
            } else if (daysToComplete > 30) {
                auditStatus = 'NEEDS_REVIEW'
                recommendations.push(`Takes ${daysToComplete} days to publish 100 posts`)
            } else if (daysToComplete > 7) {
                recommendations.push(`Will take ${daysToComplete} days to complete all posts`)
            } else {
                recommendations.push(`Efficient: Only ${daysToComplete} days needed`)
            }

            // Determine restriction type
            let restrictionType: 'per-account' | 'per-app' | 'both' = 'per-account'
            if (limits.appDailyLimit && limits.postsPerDay) {
                restrictionType = 'both'
            } else if (limits.appDailyLimit && !limits.postsPerDay) {
                restrictionType = 'per-app'
            }

            // Platform-specific recommendations and audit status
            if (platform === SocilaMediaPlatform.TIKTOK && !config.auditApproved) {
                recommendations.push('TikTok unaudited - will use 5 users/day limit')
                auditStatus = 'NEEDS_REVIEW'
            }

            if (platform === SocilaMediaPlatform.LINKEDIN && !config.auditApproved) {
                recommendations.push('LinkedIn needs Marketing Developer Platform approval')
                auditStatus = 'NEEDS_REVIEW'
            }

            // YouTube needs quota increase approval
            if (platform === SocilaMediaPlatform.YOUTUBE && limits.appDailyLimit && limits.appDailyLimit < 100000) {
                recommendations.push(
                    `YouTube using demo quota: ${limits.appDailyLimit} units/day (needs quota increase to 300k+)`
                )
                auditStatus = 'NEEDS_REVIEW'
            }

            if (platform === SocilaMediaPlatform.YOUTUBE && limits.costPerPost && limits.costPerPost > 1000) {
                recommendations.push(`High cost per post: ${limits.costPerPost} units`)
            }

            if (platform === SocilaMediaPlatform.LINKEDIN && limits.appRps && limits.appRps < 2) {
                recommendations.push(`Low RPS limit: ${limits.appRps} requests/second`)
            }

            results.push({
                platform,
                dailyLimit,
                postsToPublish,
                daysToComplete,
                postsPerDay,
                efficiency,
                auditStatus,
                restrictionType,
                recommendations,
            })
        }

        return results
    }

    displayResults(): void {
        console.log('📊 AUDIT METRICS - PUBLICATION TIMELINE ANALYSIS')
        console.log('='.repeat(80))
        console.log()

        const metrics = this.calculateMetrics()

        // Summary table
        console.log('📋 PLATFORM PUBLICATION TIMELINE')
        console.log('-'.repeat(100))
        console.log(
            '| Platform   | Daily Limit | Posts | Days to Complete | Efficiency | Restriction Type | Status      |'
        )
        console.log(
            '|------------|-------------|-------|------------------|------------|------------------|-------------|'
        )

        for (const metric of metrics) {
            const platform = metric.platform.padEnd(10)
            const dailyLimit = metric.dailyLimit.toString().padEnd(11)
            const posts = metric.postsToPublish.toString().padEnd(5)
            const days =
                metric.daysToComplete === Infinity ? '∞'.padEnd(16) : metric.daysToComplete.toString().padEnd(16)
            const efficiency = metric.efficiency.toFixed(1).padEnd(10)
            const restrictionType = metric.restrictionType.padEnd(16)
            const status = metric.auditStatus.padEnd(11)

            console.log(
                `| ${platform} | ${dailyLimit} | ${posts} | ${days} | ${efficiency} | ${restrictionType} | ${status} |`
            )
        }

        console.log()

        // Detailed analysis
        console.log('🔍 DETAILED ANALYSIS')
        console.log('-'.repeat(80))

        for (const metric of metrics) {
            const statusIcon =
                metric.auditStatus === 'READY' ? '✅' : metric.auditStatus === 'NEEDS_REVIEW' ? '⚠️' : '❌'

            console.log(`\n${statusIcon} ${metric.platform.toUpperCase()}`)
            console.log(`   📊 Daily Limit: ${metric.dailyLimit} posts`)
            console.log(`   📝 Posts to Publish: ${metric.postsToPublish}`)
            console.log(
                `   ⏱️  Days to Complete: ${metric.daysToComplete === Infinity ? 'Never (no limit)' : metric.daysToComplete}`
            )
            console.log(`   📈 Efficiency: ${metric.efficiency.toFixed(1)}%`)
            console.log(`   🎯 Status: ${metric.auditStatus}`)

            if (metric.recommendations.length > 0) {
                console.log(`   💡 Recommendations:`)
                metric.recommendations.forEach((rec) => {
                    console.log(`      • ${rec}`)
                })
            }
        }

        // Overall summary
        console.log('\n📈 OVERALL SUMMARY')
        console.log('-'.repeat(80))

        const readyPlatforms = metrics.filter((m) => m.auditStatus === 'READY').length
        const needsReviewPlatforms = metrics.filter((m) => m.auditStatus === 'NEEDS_REVIEW').length
        const notReadyPlatforms = metrics.filter((m) => m.auditStatus === 'NOT_READY').length

        const avgDaysToComplete =
            metrics.filter((m) => m.daysToComplete !== Infinity).reduce((sum, m) => sum + m.daysToComplete, 0) /
            metrics.filter((m) => m.daysToComplete !== Infinity).length

        const fastestPlatform = metrics
            .filter((m) => m.daysToComplete !== Infinity)
            .sort((a, b) => a.daysToComplete - b.daysToComplete)[0]

        const slowestPlatform = metrics
            .filter((m) => m.daysToComplete !== Infinity)
            .sort((a, b) => b.daysToComplete - a.daysToComplete)[0]

        console.log(`✅ Ready for Audit: ${readyPlatforms}/${metrics.length} platforms`)
        console.log(`⚠️  Needs Review: ${needsReviewPlatforms}/${metrics.length} platforms`)
        console.log(`❌ Not Ready: ${notReadyPlatforms}/${metrics.length} platforms`)
        console.log(`📊 Average Days to Complete: ${avgDaysToComplete.toFixed(1)} days`)

        if (fastestPlatform) {
            console.log(`🚀 Fastest Platform: ${fastestPlatform.platform} (${fastestPlatform.daysToComplete} days)`)
        }

        if (slowestPlatform) {
            console.log(`🐌 Slowest Platform: ${slowestPlatform.platform} (${slowestPlatform.daysToComplete} days)`)
        }

        // Audit readiness assessment
        console.log('\n🏆 AUDIT READINESS ASSESSMENT')
        console.log('-'.repeat(80))

        if (readyPlatforms === metrics.length) {
            console.log('🎉 EXCELLENT: All platforms ready for audit!')
        } else if (readyPlatforms >= metrics.length * 0.8) {
            console.log('✅ GOOD: Most platforms ready, minor issues to address')
        } else if (readyPlatforms >= metrics.length * 0.5) {
            console.log('⚠️  FAIR: Some platforms ready, several need attention')
        } else {
            console.log('❌ POOR: Most platforms need significant work before audit')
        }

        // Production recommendations
        console.log('\n💼 PRODUCTION RECOMMENDATIONS')
        console.log('-'.repeat(80))

        const highVolumePlatforms = metrics.filter((m) => m.dailyLimit >= 100)
        const mediumVolumePlatforms = metrics.filter((m) => m.dailyLimit >= 10 && m.dailyLimit < 100)
        const lowVolumePlatforms = metrics.filter((m) => m.dailyLimit < 10)

        console.log(`📈 High Volume Platforms (100+ posts/day): ${highVolumePlatforms.length}`)
        highVolumePlatforms.forEach((p) => console.log(`   • ${p.platform}: ${p.dailyLimit} posts/day`))

        console.log(`📊 Medium Volume Platforms (10-99 posts/day): ${mediumVolumePlatforms.length}`)
        mediumVolumePlatforms.forEach((p) => console.log(`   • ${p.platform}: ${p.dailyLimit} posts/day`))

        console.log(`📉 Low Volume Platforms (<10 posts/day): ${lowVolumePlatforms.length}`)
        lowVolumePlatforms.forEach((p) => console.log(`   • ${p.platform}: ${p.dailyLimit} posts/day`))

        if (lowVolumePlatforms.length > 0) {
            console.log('\n⚠️  Consider requesting higher limits for low-volume platforms:')
            lowVolumePlatforms.forEach((p) => {
                console.log(`   • ${p.platform}: Request increase from ${p.dailyLimit} to 50+ posts/day`)
            })
        }
    }
}

// Main execution
async function main() {
    const calculator = new AuditMetricsCalculator()
    calculator.displayResults()
}

if (require.main === module) {
    main()
}
