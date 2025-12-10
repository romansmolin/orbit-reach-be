// errors/RequestValidationError.ts
import { ErrorCode } from '../consts/error-codes.const'
import { BaseAppError } from './base-error'

export class RequestValidationError extends BaseAppError {
    constructor(message: string, code: ErrorCode = ErrorCode.BAD_REQUEST) {
        super(message, code, 400)
    }
}
