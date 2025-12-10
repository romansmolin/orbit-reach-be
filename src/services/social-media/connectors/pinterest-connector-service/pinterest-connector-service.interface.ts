export interface IPinterestConnectorService {
    connectPinterestAccount(userId: string, code: string): Promise<{ success: boolean }>
}
