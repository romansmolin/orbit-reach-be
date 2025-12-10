import { SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { OAuthErrorResponse, SocialMediaPlatformOAuth } from './oauth-error-types'

export interface IOAuthErrorHandler {
    extractFromQueryParams(
        queryParams: Record<string, any>,
        platform: SocilaMediaPlatform,
        state?: string
    ): OAuthErrorResponse | null

    extractFromApiResponse(error: unknown, platform: SocilaMediaPlatform): OAuthErrorResponse
    formatErrorForRedirect(
        error: OAuthErrorResponse,
        platform: SocilaMediaPlatform,
        additionalParams?: Record<string, string>
    ): string

    handleOAuthError(
        error: unknown,
        platform: SocilaMediaPlatform,
        queryParams?: Record<string, any>,
        state?: string
    ): string
}
