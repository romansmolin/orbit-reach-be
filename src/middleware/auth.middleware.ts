import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { ErrorCode } from '../shared/consts/error-codes.const'
import { BaseAppError } from '../shared/errors/base-error'
import { getJwtSecret } from '@/shared/utils/get-jwt-secret'

const JWT_SECRET = getJwtSecret()
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string
            }
        }
    }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    try {
        let token = req.cookies?.token

        if (!token && req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.split(' ')[1]

        if (!token) throw new BaseAppError('No token provided', ErrorCode.UNAUTHORIZED, 401)

        const decoded = jwt.verify(token, JWT_SECRET) as { userId?: string; id?: string }

        const userId = decoded.userId || decoded.id
        if (!userId) {
            throw new BaseAppError('Invalid token payload', ErrorCode.UNAUTHORIZED, 401)
        }

        req.user = { id: userId }

        next()
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            next(new BaseAppError('Token has expired', ErrorCode.TOKEN_EXPIRED, 401))
        } else if (error instanceof jwt.JsonWebTokenError) {
            next(new BaseAppError('Invalid token', ErrorCode.UNAUTHORIZED, 401))
        } else if (error instanceof BaseAppError) {
            next(error)
        } else {
            next(new BaseAppError('Authentication failed', ErrorCode.UNKNOWN_ERROR, 500))
        }
    }
}
