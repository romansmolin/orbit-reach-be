import { PostPlatform } from '@/schemas/posts.schemas'

export interface ISocialMediaTokenRefresherService {
    findExpiringAccessTokensAndUpdate(): Promise<{ accountIds: string[] }>
    updateAccessToken(
        accountId: string,
        platform: PostPlatform,
        accessToken: string,
        refreshToken?: string
    ): Promise<void>

    updateInstagramAccessToken(accountId: string, accessToken: string): Promise<void>
    updateThreadsAccessToken(accountId: string, accessToken: string): Promise<void>
    updatePinterestAccessToken(accountId: string, accessToken: string, refreshToken: string): Promise<void>
    updateTikTokAccessToken(accountId: string, accessToken: string, refreshToken: string): Promise<void>
    updateYouTubeAccessToken(accountId: string, accessToken: string, refreshToken: string): Promise<void>
    updateXAccessToken(accountId: string, accessToken: string, refreshToken: string): Promise<void>
    updateFacebookAccessToken(accountId: string, accessToken: string): Promise<void>
}
