export interface LogMetadata {
    timestamp?: string
    correlationId?: string
    userId?: string
    operation?: string
    entity?: string
    duration?: number
    error?: {
        name?: string
        code?: string | number
        stack?: string
		message?: string
    }
    [key: string]: any // for additional custom metadata
}

export interface ILogger {
    info(message: string, meta?: LogMetadata): void
    warn(message: string, meta?: LogMetadata): void
    error(message: string, meta?: LogMetadata): void
    debug(message: string, meta?: LogMetadata): void
}
