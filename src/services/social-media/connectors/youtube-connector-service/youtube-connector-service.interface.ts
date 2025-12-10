export interface IYouTubeConnectorService {
    connectYouTubeAccount(userId: string, code: string): Promise<{ success: boolean }>
}
