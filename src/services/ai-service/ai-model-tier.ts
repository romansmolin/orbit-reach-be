import { AiModelTier } from '@/schemas/ai.schema'

interface AiModelTierConfig {
    envKey: 'OPENAI_API_MODEL_CHEAP' | 'OPENAI_API_MODEL_DEFAULT' | 'OPENAI_API_MODEL_COMPLEX_REASONING'
    creditsPerPost: number
}

export const AI_MODEL_TIERS: Record<AiModelTier, AiModelTierConfig> = {
    cheap: { envKey: 'OPENAI_API_MODEL_CHEAP', creditsPerPost: 1 },
    default: { envKey: 'OPENAI_API_MODEL_DEFAULT', creditsPerPost: 2 },
    complex: { envKey: 'OPENAI_API_MODEL_COMPLEX_REASONING', creditsPerPost: 4 },
}

export const calculateGenerationCost = (tier: AiModelTier, postsCount: number): number =>
    AI_MODEL_TIERS[tier].creditsPerPost * postsCount
