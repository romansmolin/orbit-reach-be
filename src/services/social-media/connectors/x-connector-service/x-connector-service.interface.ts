export interface IXConnectorService {
    connectXAccount(userId: string, code: string, codeVerifier: string): Promise<{ success: boolean }>
}
