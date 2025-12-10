export interface ILinkedinConnectorService {
    connectLinkedinAccount(userId: string, code: string): Promise<{ success: boolean }>
}
