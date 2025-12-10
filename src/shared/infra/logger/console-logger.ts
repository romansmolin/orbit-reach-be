import { ILogger, LogMetadata } from './logger.interface'

export class ConsoleLogger implements ILogger {
    private formatMessage(level: string, message: string, meta?: LogMetadata): string {
        const timestamp = new Date().toISOString()
        const metaWithTimestamp = {
            timestamp,
            ...meta,
        }

        return `[${timestamp}] ${level}: ${message}`
    }

    private formatMeta(meta?: LogMetadata) {
        if (!meta) return ''

        // Handle error objects specially
        if (meta.error) {
            return {
                ...meta,
                error: {
                    name: meta.error.name,
                    code: meta.error.code,
                    stack: meta.error.stack,
                },
            }
        }

        return meta
    }

    info(message: string, meta?: LogMetadata): void {
        console.info(this.formatMessage('INFO', message), this.formatMeta(meta))
    }

    warn(message: string, meta?: LogMetadata): void {
        console.warn(this.formatMessage('WARN', message), this.formatMeta(meta))
    }

    error(message: string, meta?: LogMetadata): void {
        console.error(this.formatMessage('ERROR', message), this.formatMeta(meta))
    }

    debug(message: string, meta?: LogMetadata): void {
        console.debug(this.formatMessage('DEBUG', message), this.formatMeta(meta))
    }
}
