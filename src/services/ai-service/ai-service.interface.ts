import { PostPlatform } from '@/schemas/posts.schemas'
import { AiRequest } from '../../schemas/ai.schema'
export interface AiIntroductoryResult {
    id: string
    platform: PostPlatform
    language: string
    title: string | null
    text: string
    hashtags: string[]
    charCounts: {
        title: number | null
        text: number
    }
    warnings: string[]
}

export interface IAiService {
    generateIntroductoryCopy(userId: string, payload: AiRequest): Promise<AiIntroductoryResult[]>
}
