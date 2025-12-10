export interface ITokenRefreshScheduler {
    scheduleDailyAccessTokenRefresh(): Promise<void>
}
