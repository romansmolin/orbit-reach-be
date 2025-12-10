import { ErrorCode } from '../consts/error-codes.const'

export class BaseAppError extends Error {
    public readonly code: ErrorCode
    public readonly status: number

    constructor(message: string, code: ErrorCode, status: number) {
        super(message)
        this.name = this.constructor.name
        this.code = code
        this.status = status
        Error.captureStackTrace(this, this.constructor)
    }
}
