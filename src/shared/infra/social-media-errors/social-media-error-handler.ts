import { IPostsRepository } from '@/repositories/posts-repository'
import { BaseAppError } from '@/shared/errors/base-error'
import { AxiosError } from 'axios'
import { ILogger } from '../logger/logger.interface'
import { ErrorCode } from '@/shared/consts/error-codes.const'
import { PostStatus } from '@/types/posts.types'
export interface SocialMediaError {
    status: number
    code: string
    message: string
    isRetryable: boolean
    platform: string
}

export interface ErrorHandlingResult {
    shouldUpdateTargetStatus: boolean
    targetStatus: PostStatus
    errorMessage: string
    error: BaseAppError
}

export class SocialMediaErrorHandler {
    private logger: ILogger
    private postRepository: IPostsRepository

    constructor(logger: ILogger, postRepository: IPostsRepository) {
        this.logger = logger
        this.postRepository = postRepository
    }

    async handleSocialMediaError(
        error: unknown,
        platform: string,
        userId: string,
        postId: string,
        socialAccountId: string
    ): Promise<ErrorHandlingResult> {
        let errorMessage: string
        let errorToThrow: BaseAppError

        if (error instanceof AxiosError) {
            const axiosResult = this.handleAxiosError(error, platform)
            errorMessage = axiosResult.message
            errorToThrow = axiosResult.error
        } else if (error instanceof BaseAppError) {
            errorMessage = error.message
            errorToThrow = error
        } else {
            errorMessage = `Unknown error occurred while sending post to ${platform}`
            errorToThrow = new BaseAppError(errorMessage, ErrorCode.UNKNOWN_ERROR, 500)
        }

        try {
            await this.postRepository.updatePostTarget(userId, postId, socialAccountId, PostStatus.FAILED, errorMessage)
        } catch (updateError) {
            this.logger.error('Failed to update post target status after error', {
                operation: 'handleSocialMediaError',
                userId,
                postId,
                socialAccountId,
                platform,
                originalError: errorMessage,
                updateError: {
                    name: updateError instanceof Error ? updateError.name : 'UnknownError',
                    code: updateError instanceof Error ? updateError.message : 'Unknown error',
                    stack: updateError instanceof Error ? updateError.stack : undefined,
                },
            })
        }

        return {
            shouldUpdateTargetStatus: true,
            targetStatus: PostStatus.FAILED,
            errorMessage,
            error: errorToThrow,
        }
    }

    private handleAxiosError(
        error: AxiosError,
        platform: string
    ): {
        message: string
        error: BaseAppError
    } {
        const status = error.response?.status || 500
        const responseData = error.response?.data as any

        // Log the error for debugging
        this.logger.debug('Axios Response Error:', {
            status,
            data: responseData,
            message: responseData?.message || responseData?.error || responseData?.detail,
            code: responseData?.code || responseData?.error_code,
            headers: error.response?.headers,
            platform,
        })

        switch (platform.toLowerCase()) {
            case 'tiktok':
                return this.handleTikTokError(status, responseData)
            case 'instagram':
                return this.handleInstagramError(status, responseData)
            case 'facebook':
                return this.handleFacebookError(status, responseData)
            case 'pinterest':
                return this.handlePinterestError(status, responseData)
            case 'youtube':
                return this.handleYouTubeError(status, responseData)
            case 'x':
            case 'twitter':
                return this.handleXError(status, responseData)
            case 'threads':
                return this.handleThreadsError(status, responseData)
            case 'bluesky':
                return this.handleBlueskyError(status, responseData)
            default:
                return this.handleGenericError(status, responseData, platform)
        }
    }

    private handleTikTokError(
        status: number,
        responseData: any
    ): {
        message: string
        error: BaseAppError
    } {
        switch (status) {
            case 401:
                return {
                    message: 'TikTok access token is invalid or expired. Please reconnect your TikTok account.',
                    error: new BaseAppError(
                        'TikTok access token is invalid or expired. Please reconnect your TikTok account to continue posting.',
                        ErrorCode.UNAUTHORIZED,
                        401
                    ),
                }
            case 403:
                return {
                    message:
                        'TikTok access forbidden - insufficient permissions. Please reconnect your TikTok account.',
                    error: new BaseAppError(
                        'TikTok access forbidden - insufficient permissions. Please reconnect your TikTok account to continue posting.',
                        ErrorCode.FORBIDDEN,
                        403
                    ),
                }
            case 429:
                return {
                    message: 'TikTok rate limit exceeded. Please try again later.',
                    error: new BaseAppError(
                        'TikTok rate limit exceeded. Please try again later.',
                        ErrorCode.RATE_LIMIT_EXCEEDED,
                        429
                    ),
                }
            case 400:
                const errorCode = responseData?.error?.code
                const errorMessage = responseData?.error?.message || 'TikTok API error'

                if (errorCode === 'access_token_invalid') {
                    return {
                        message: 'TikTok access token is invalid or expired. Please reconnect your TikTok account.',
                        error: new BaseAppError(
                            'TikTok access token is invalid or expired. Please reconnect your TikTok account to continue posting.',
                            ErrorCode.UNAUTHORIZED,
                            401
                        ),
                    }
                }

                // Handle other common TikTok API errors
                if (errorCode === 'invalid_access_token') {
                    return {
                        message: 'TikTok access token is invalid. Please reconnect your TikTok account.',
                        error: new BaseAppError(
                            'TikTok access token is invalid. Please reconnect your TikTok account to continue posting.',
                            ErrorCode.UNAUTHORIZED,
                            401
                        ),
                    }
                }

                if (errorCode === 'token_expired') {
                    return {
                        message: 'TikTok access token has expired. Please reconnect your TikTok account.',
                        error: new BaseAppError(
                            'TikTok access token has expired. Please reconnect your TikTok account to continue posting.',
                            ErrorCode.UNAUTHORIZED,
                            401
                        ),
                    }
                }

                return {
                    message: `TikTok API error: ${errorMessage}`,
                    error: new BaseAppError(`TikTok API error: ${errorMessage}`, ErrorCode.BAD_REQUEST, 400),
                }
            default:
                return {
                    message: `TikTok API error: ${status}`,
                    error: new BaseAppError(`TikTok API error: ${status}`, ErrorCode.UNKNOWN_ERROR, status),
                }
        }
    }

    private handleInstagramError(
        status: number,
        responseData: any
    ): {
        message: string
        error: BaseAppError
    } {
        switch (status) {
            case 401:
                return {
                    message: 'Instagram access token is invalid or expired',
                    error: new BaseAppError(
                        'Instagram access token is invalid or expired',
                        ErrorCode.UNAUTHORIZED,
                        401
                    ),
                }
            case 403:
                return {
                    message: 'Instagram access forbidden - insufficient permissions',
                    error: new BaseAppError(
                        'Instagram access forbidden - insufficient permissions',
                        ErrorCode.FORBIDDEN,
                        403
                    ),
                }
            case 429:
                return {
                    message: 'Instagram rate limit exceeded',
                    error: new BaseAppError('Instagram rate limit exceeded', ErrorCode.RATE_LIMIT_EXCEEDED, 429),
                }
            case 400:
                const errorCode = responseData?.error?.code
                const errorMessage = responseData?.error?.message || 'Instagram API error'

                // Handle specific Instagram error codes
                if (errorCode === 36000) {
                    return {
                        message: 'Instagram image size is too large',
                        error: new BaseAppError('Instagram image size is too large', ErrorCode.FILE_TOO_LARGE, 400),
                    }
                }

                if (errorCode === 36001) {
                    return {
                        message: 'Instagram image format is not supported',
                        error: new BaseAppError(
                            'Instagram image format is not supported',
                            ErrorCode.UNSUPPORTED_FILE_TYPE,
                            400
                        ),
                    }
                }

                return {
                    message: `Instagram API error: ${errorMessage}`,
                    error: new BaseAppError(`Instagram API error: ${errorMessage}`, ErrorCode.BAD_REQUEST, 400),
                }
            default:
                return {
                    message: `Instagram API error: ${status}`,
                    error: new BaseAppError(`Instagram API error: ${status}`, ErrorCode.UNKNOWN_ERROR, status),
                }
        }
    }

    private handleFacebookError(
        status: number,
        responseData: any
    ): {
        message: string
        error: BaseAppError
    } {
        switch (status) {
            case 401:
                return {
                    message: 'Facebook access token is invalid or expired',

                    error: new BaseAppError('Facebook access token is invalid or expired', ErrorCode.UNAUTHORIZED, 401),
                }
            case 403:
                return {
                    message: 'Facebook access forbidden - insufficient permissions',

                    error: new BaseAppError(
                        'Facebook access forbidden - insufficient permissions',
                        ErrorCode.FORBIDDEN,
                        403
                    ),
                }
            case 429:
                return {
                    message: 'Facebook rate limit exceeded',

                    error: new BaseAppError('Facebook rate limit exceeded', ErrorCode.RATE_LIMIT_EXCEEDED, 429),
                }
            default:
                return {
                    message: `Facebook API error: ${status}`,

                    error: new BaseAppError(`Facebook API error: ${status}`, ErrorCode.UNKNOWN_ERROR, status),
                }
        }
    }

    private handlePinterestError(
        status: number,
        responseData: any
    ): {
        message: string
        error: BaseAppError
    } {
        switch (status) {
            case 401:
                return {
                    message: 'Pinterest access token is invalid or expired',

                    error: new BaseAppError(
                        'Pinterest access token is invalid or expired',
                        ErrorCode.UNAUTHORIZED,
                        401
                    ),
                }
            case 403:
                return {
                    message: 'Pinterest access forbidden - insufficient permissions',

                    error: new BaseAppError(
                        'Pinterest access forbidden - insufficient permissions',
                        ErrorCode.FORBIDDEN,
                        403
                    ),
                }
            case 429:
                return {
                    message: 'Pinterest rate limit exceeded',

                    error: new BaseAppError('Pinterest rate limit exceeded', ErrorCode.RATE_LIMIT_EXCEEDED, 429),
                }
            default:
                return {
                    message: `Pinterest API error: ${status}`,

                    error: new BaseAppError(`Pinterest API error: ${status}`, ErrorCode.UNKNOWN_ERROR, status),
                }
        }
    }

    private handleYouTubeError(
        status: number,
        responseData: any
    ): {
        message: string
        error: BaseAppError
    } {
        switch (status) {
            case 401:
                return {
                    message: 'YouTube access token is invalid or expired',

                    error: new BaseAppError('YouTube access token is invalid or expired', ErrorCode.UNAUTHORIZED, 401),
                }
            case 403:
                return {
                    message: 'YouTube access forbidden - insufficient permissions',

                    error: new BaseAppError(
                        'YouTube access forbidden - insufficient permissions',
                        ErrorCode.FORBIDDEN,
                        403
                    ),
                }
            case 429:
                return {
                    message: 'YouTube rate limit exceeded',

                    error: new BaseAppError('YouTube rate limit exceeded', ErrorCode.RATE_LIMIT_EXCEEDED, 429),
                }
            default:
                return {
                    message: `YouTube API error: ${status}`,

                    error: new BaseAppError(`YouTube API error: ${status}`, ErrorCode.UNKNOWN_ERROR, status),
                }
        }
    }

    private handleXError(
        status: number,
        responseData: any
    ): {
        message: string
        error: BaseAppError
    } {
        switch (status) {
            case 401:
                return {
                    message: 'X (Twitter) access token is invalid or expired',

                    error: new BaseAppError(
                        'X (Twitter) access token is invalid or expired',
                        ErrorCode.UNAUTHORIZED,
                        401
                    ),
                }
            case 403:
                return {
                    message: 'X (Twitter) access forbidden - insufficient permissions',

                    error: new BaseAppError(
                        'X (Twitter) access forbidden - insufficient permissions',
                        ErrorCode.FORBIDDEN,
                        403
                    ),
                }
            case 429:
                return {
                    message: 'X (Twitter) rate limit exceeded',

                    error: new BaseAppError('X (Twitter) rate limit exceeded', ErrorCode.RATE_LIMIT_EXCEEDED, 429),
                }
            default:
                return {
                    message: `X (Twitter) API error: ${status}`,

                    error: new BaseAppError(`X (Twitter) API error: ${status}`, ErrorCode.UNKNOWN_ERROR, status),
                }
        }
    }

    private handleThreadsError(
        status: number,
        responseData: any
    ): {
        message: string
        error: BaseAppError
    } {
        const threadsError = responseData?.error
        const rawMessage =
            responseData?.message ||
            threadsError?.message ||
            threadsError?.error_user_msg ||
            threadsError?.error_user_title ||
            responseData?.error ||
            responseData?.error_message
        const errorCode = responseData?.code || responseData?.error_code || threadsError?.code
        const errorDetail = responseData?.detail || responseData?.details || threadsError?.error_subcode
        const normalizedMessage = [rawMessage, errorCode, errorDetail]
            .filter(Boolean)
            .map((val) => (typeof val === 'object' ? JSON.stringify(val) : String(val)))
            .join(' | ')

        switch (status) {
            case 401:
                return {
                    message: 'Threads access token is invalid or expired',

                    error: new BaseAppError('Threads access token is invalid or expired', ErrorCode.UNAUTHORIZED, 401),
                }
            case 403:
                return {
                    message: 'Threads access forbidden - insufficient permissions',

                    error: new BaseAppError(
                        'Threads access forbidden - insufficient permissions',
                        ErrorCode.FORBIDDEN,
                        403
                    ),
                }
            case 429:
                return {
                    message: 'Threads rate limit exceeded',

                    error: new BaseAppError('Threads rate limit exceeded', ErrorCode.RATE_LIMIT_EXCEEDED, 429),
                }

            case 400:
                return {
                    message: `Threads API error: ${normalizedMessage || status}`,
                    error: new BaseAppError(
                        `Threads API error: ${normalizedMessage || status}`,
                        ErrorCode.BAD_REQUEST,
                        400
                    ),
                }
            default:
                return {
                    message: `Threads API error: ${normalizedMessage || status}`,
                    error: new BaseAppError(
                        `Threads API error: ${normalizedMessage || status}`,
                        ErrorCode.UNKNOWN_ERROR,
                        status
                    ),
                }
        }
    }

    private handleBlueskyError(
        status: number,
        responseData: any
    ): {
        message: string
        error: BaseAppError
    } {
        const errorMessage = responseData?.message || responseData?.error || `Bluesky API error: ${status}`

        switch (status) {
            case 401:
                return {
                    message: 'Bluesky access token is invalid or expired',

                    error: new BaseAppError('Bluesky access token is invalid or expired', ErrorCode.UNAUTHORIZED, 401),
                }
            case 403:
                return {
                    message: 'Bluesky access forbidden - insufficient permissions',

                    error: new BaseAppError(
                        'Bluesky access forbidden - insufficient permissions',
                        ErrorCode.FORBIDDEN,
                        403
                    ),
                }
            case 429:
                return {
                    message: 'Bluesky rate limit exceeded',

                    error: new BaseAppError('Bluesky rate limit exceeded', ErrorCode.RATE_LIMIT_EXCEEDED, 429),
                }
            case 400:
            case 413:
            case 414:
                return {
                    message: `Bluesky API error: ${errorMessage}`,

                    error: new BaseAppError(`Bluesky API error: ${errorMessage}`, ErrorCode.BAD_REQUEST, 400),
                }
            default:
                return {
                    message: `Bluesky API error: ${status}`,

                    error: new BaseAppError(`Bluesky API error: ${status}`, ErrorCode.UNKNOWN_ERROR, status),
                }
        }
    }

    private handleGenericError(
        status: number,
        responseData: any,
        platform: string
    ): {
        message: string
        error: BaseAppError
    } {
        switch (status) {
            case 401:
                return {
                    message: `${platform} access token is invalid or expired`,

                    error: new BaseAppError(
                        `${platform} access token is invalid or expired`,
                        ErrorCode.UNAUTHORIZED,
                        401
                    ),
                }
            case 403:
                return {
                    message: `${platform} access forbidden - insufficient permissions`,

                    error: new BaseAppError(
                        `${platform} access forbidden - insufficient permissions`,
                        ErrorCode.FORBIDDEN,
                        403
                    ),
                }
            case 429:
                return {
                    message: `${platform} rate limit exceeded`,

                    error: new BaseAppError(`${platform} rate limit exceeded`, ErrorCode.RATE_LIMIT_EXCEEDED, 429),
                }
            default:
                return {
                    message: `${platform} API error: ${status}`,

                    error: new BaseAppError(`${platform} API error: ${status}`, ErrorCode.UNKNOWN_ERROR, status),
                }
        }
    }
}
