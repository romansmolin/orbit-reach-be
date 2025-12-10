export interface IPostWorker {
    start(): void
    stop(): Promise<void>
    setOnJobFailureCallback(callback: (userId: string, postId: string) => Promise<void>): void
}
