export interface IAccessTokenWorker {
    start(): void
    stop(): Promise<void>
}
