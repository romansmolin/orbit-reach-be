export interface ITikTokConnectorService {
    connectTikTokAccount(userId: string, code: string): Promise<{ success: boolean }>
}
