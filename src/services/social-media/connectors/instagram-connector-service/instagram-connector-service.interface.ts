export interface IInstagramConnectorService {
    connectInstagramAccount(userId: string, code: string): Promise<{ success: boolean }>
}
