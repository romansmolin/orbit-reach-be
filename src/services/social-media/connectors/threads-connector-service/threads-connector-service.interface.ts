export interface IThreadsConnectorService {
    connectThreadsAccount(userId: string, code: string): Promise<{ success: boolean }>
}
