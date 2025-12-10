import { Request, Response, NextFunction, ErrorRequestHandler } from 'express'
import { ErrorCode } from '../shared/consts/error-codes.const'
import { BaseAppError } from '../shared/errors/base-error'
import { ILogger } from '../shared/infra/logger/logger.interface'

export const createErrorMiddleware = (logger: ILogger): ErrorRequestHandler => {
    return (err, req, res, next) => {
        const logMessage =
            err instanceof BaseAppError ? `Application error: ${err.message} (${err.code})` : 'Unhandled error occurred'

        logger.error(logMessage, {
            error: {
                name: err instanceof Error ? err.name : 'UnknownError',
                code:
                    err instanceof BaseAppError
                        ? err.code
                        : err instanceof Error
                          ? err.message
                          : 'Unknown error occurred',
                stack: err instanceof Error ? err.stack : undefined,
            },
            request: {
                method: req.method,
                url: req.url,
                userAgent: req.get('User-Agent'),
                ip: req.ip,
            },
        })

        if (err instanceof BaseAppError) {
            res.status(err.status).json({
                code: err.code,
                message: err.message,
                status: err.status,
            })
        } else {
            res.status(500).json({
                code: ErrorCode.UNKNOWN_ERROR,
                message: 'Unexpected error occurred',
                status: 500,
            })
        }
    }
}
