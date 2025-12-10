export interface ISocilaMediaConnectorService {
    connectFacebookAccount(userId: string, code: string): Promise<{ success: boolean }>
    connectInstagramAccount(userId: string, code: string): Promise<{ success: boolean }>
    connectThreadsAccount(userId: string, code: string): Promise<{ success: boolean }>
    connectTikTokAccount(userId: string, code: string): Promise<{ success: boolean }>
    connectYouTubeAccount(userId: string, code: string): Promise<{ success: boolean }>
    connectBlueskyAccount(userId: string, identifier: string, appPassword: string): Promise<{ success: boolean }>
    connectXAccount(userId: string, code: string, codeVerifier: string): Promise<{ success: boolean }>
    connectPinterestAccount(userId: string, code: string): Promise<{ success: boolean }>
    connectLinkedinAccount(userId: string, code: string): Promise<{ success: boolean }>
}
