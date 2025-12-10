export interface OAuthErrorResponse {
    errorCode: string
    description: string
    userFriendlyMessage: string
    urlParams: string
}

export enum SocialMediaPlatformOAuth {
    FACEBOOK = 'facebook',
    INSTAGRAM = 'instagram',
    TWITTER = 'twitter',
    LINKEDIN = 'linkedin',
    GOOGLE = 'google',
    PINTEREST = 'pinterest',
    TIKTOK = 'tiktok',
    YOUTUBE = 'youtube',
    THREADS = 'threads',
    BLUESKY = 'bluesky',
}

// Facebook/Instagram OAuth2 Errors (Graph API)
export interface FacebookOAuthError {
    error: string
    error_description: string
    error_reason?: string
    error_code?: number
    error_subcode?: number
    error_user_title?: string
    error_user_msg?: string
    state?: string
}

// LinkedIn OAuth2 Errors
export interface LinkedInOAuthError {
    error: string
    error_description: string
    state?: string
}

// Twitter/X OAuth2 Errors
export interface TwitterOAuthError {
    error: string
    error_description?: string
    state?: string
}

// Google OAuth2 Errors
export interface GoogleOAuthError {
    error: string
    error_description?: string
    error_uri?: string
    state?: string
}

// Pinterest OAuth2 Errors
export interface PinterestOAuthError {
    error: string
    error_description?: string
    error_uri?: string
    state?: string
}

// TikTok OAuth2 Errors
export interface TikTokOAuthError {
    error: string
    error_description?: string
    state?: string
}

// YouTube OAuth2 Errors (same as Google since it uses Google OAuth)
export type YouTubeOAuthError = GoogleOAuthError

export type PlatformOAuthError =
    | FacebookOAuthError
    | LinkedInOAuthError
    | TwitterOAuthError
    | GoogleOAuthError
    | PinterestOAuthError
    | TikTokOAuthError
    | YouTubeOAuthError
