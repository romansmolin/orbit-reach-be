import { BaseAppError } from '@/shared/errors/base-error'
import { AxiosError } from 'axios'
import { ErrorCode } from '../../consts/error-codes.const'
import { ILogger } from '../logger/logger.interface'
import { PLATFORM_ERROR_MAPPINGS, GENERIC_OAUTH_ERRORS } from './oauth-error-constants'
import { IOAuthErrorHandler } from './oauth-error-handler.interface'
import { OAuthErrorResponse, PlatformOAuthError, FacebookOAuthError } from './oauth-error-types'
import { SocilaMediaPlatform } from '@/schemas/posts.schemas'

export class OAuthErrorHandler implements IOAuthErrorHandler {
    constructor(private logger: ILogger) {}

    extractFromQueryParams(
        queryParams: Record<string, any>,
        platform: SocilaMediaPlatform,
        state?: string
    ): OAuthErrorResponse | null {
        const { error, error_description, error_reason } = queryParams

        if (!error) {
            return null
        }

        this.logger.warn('OAuth authorization error detected', {
            operation: 'extractFromQueryParams',
            platform,
            error,
            error_description,
            error_reason,
            state,
        })

        const platformErrors = PLATFORM_ERROR_MAPPINGS[platform] || GENERIC_OAUTH_ERRORS
        const errorMapping = platformErrors[error] || this.createFallbackError(error, error_description, platform)

        return errorMapping
    }

    extractFromApiResponse(error: unknown, platform: SocilaMediaPlatform): OAuthErrorResponse {
        this.logger.error('OAuth API error occurred', {
            operation: 'extractFromApiResponse',
            platform,
            error: {
                name: error instanceof Error ? error.name : 'Unknown',
                stack: error instanceof Error ? error.stack : undefined,
            },
        })

        if (error instanceof AxiosError && error.response?.data) {
            const responseData = error.response.data as PlatformOAuthError
            return this.extractFromResponseData(responseData, platform)
        }

        if (error instanceof AxiosError && !error.response) {
            return GENERIC_OAUTH_ERRORS.network_error
        }

        if (error instanceof Error && error.message.toLowerCase().includes('timeout')) {
            return GENERIC_OAUTH_ERRORS.timeout
        }

        if (error instanceof BaseAppError && error.code === ErrorCode.DUPLICATES) {
            return GENERIC_OAUTH_ERRORS.duplicates_error
        }

        return GENERIC_OAUTH_ERRORS.unknown_error
    }

    private extractFromResponseData(
        responseData: PlatformOAuthError,
        platform: SocilaMediaPlatform
    ): OAuthErrorResponse {
        const platformErrors = PLATFORM_ERROR_MAPPINGS[platform] || GENERIC_OAUTH_ERRORS

        // Facebook/Instagram Graph API error format
        if ('error' in responseData && typeof responseData.error === 'string') {
            const errorCode = responseData.error
            const errorDescription = responseData.error_description || ''

            return platformErrors[errorCode] || this.createFallbackError(errorCode, errorDescription, platform)
        }

        // Facebook Graph API nested error format
        if ('error' in responseData && typeof responseData.error === 'object') {
            const fbError = responseData as FacebookOAuthError
            if (fbError.error_user_title && fbError.error_user_msg) {
                return {
                    errorCode: fbError.error || 'facebook_error',
                    description: `${fbError.error_user_title}: ${fbError.error_user_msg}`,
                    userFriendlyMessage: fbError.error_user_msg,
                    urlParams: `error=${fbError.error}&reason=${encodeURIComponent(fbError.error_user_msg)}`,
                }
            }
        }

        return GENERIC_OAUTH_ERRORS.unknown_error
    }

    private createFallbackError(
        errorCode: string,
        errorDescription: string,
        platform: SocilaMediaPlatform
    ): OAuthErrorResponse {
        const platformName = platform.charAt(0).toUpperCase() + platform.slice(1)

        return {
            errorCode,
            description: errorDescription || `${platformName} OAuth error: ${errorCode}`,
            userFriendlyMessage: errorDescription
                ? `${platformName} login failed: ${errorDescription}`
                : `${platformName} login failed. Please try again or contact support.`,
            urlParams: `error=${errorCode}&reason=${encodeURIComponent(`${platformName} login error`)}&platform=${platform}`,
        }
    }

    formatErrorForRedirect(
        error: OAuthErrorResponse,
        platform: SocilaMediaPlatform,
        additionalParams?: Record<string, string>
    ): string {
        const baseParams = error.urlParams
        const platformParam = `platform=${platform}`

        let allParams = `${baseParams}&${platformParam}`

        if (additionalParams) {
            const additionalParamsString = Object.entries(additionalParams)
                .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
                .join('&')
            allParams += `&${additionalParamsString}`
        }

        return allParams
    }

    handleOAuthError(
        error: unknown,
        platform: SocilaMediaPlatform,
        queryParams?: Record<string, any>,
        state?: string
    ): string {
        let oauthError: OAuthErrorResponse

        if (queryParams) {
            const callbackError = this.extractFromQueryParams(queryParams, platform, state)
            if (callbackError) {
                oauthError = callbackError
            } else {
                oauthError = this.extractFromApiResponse(error, platform)
            }
        } else {
            oauthError = this.extractFromApiResponse(error, platform)
        }

        return this.formatErrorForRedirect(oauthError, platform, { timestamp: Date.now().toString() })
    }
}
