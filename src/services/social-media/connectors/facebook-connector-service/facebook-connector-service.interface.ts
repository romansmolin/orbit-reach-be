export interface IFacebookConnectorService {
    connectFacebookAccount(userId: string, code: string): Promise<{ success: boolean }>
}
