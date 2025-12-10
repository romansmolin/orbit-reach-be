/**
 * OAuth2 Error Constants and Messages for Social Media Platforms
 * Based on official API documentation
 */

import { PostPlatforms, SocilaMediaPlatform } from '@/schemas/posts.schemas'
import { OAuthErrorResponse, SocialMediaPlatformOAuth } from './oauth-error-types'

// Facebook/Instagram OAuth2 Error Mappings
export const FACEBOOK_OAUTH_ERRORS: Record<string, OAuthErrorResponse> = {
    // Standard OAuth2 Errors
    access_denied: {
        errorCode: 'access_denied',
        description: 'User denied authorization request',
        userFriendlyMessage: 'You cancelled the Facebook login. Please try again if you want to connect your account.',
        urlParams: 'error=access_denied&reason=User%20cancelled%20Facebook%20login',
    },
    invalid_request: {
        errorCode: 'invalid_request',
        description: 'Invalid authorization request parameters',
        userFriendlyMessage: 'There was a problem with the Facebook connection request. Please contact support.',
        urlParams: 'error=invalid_request&reason=Invalid%20Facebook%20authorization%20parameters',
    },
    invalid_client: {
        errorCode: 'invalid_client',
        description: 'Invalid client credentials',
        userFriendlyMessage: 'Facebook app configuration error. Please contact support.',
        urlParams: 'error=invalid_client&reason=Facebook%20app%20misconfiguration',
    },
    invalid_scope: {
        errorCode: 'invalid_scope',
        description: 'Invalid or unauthorized scope requested',
        userFriendlyMessage: 'The requested Facebook permissions are not available. Please contact support.',
        urlParams: 'error=invalid_scope&reason=Invalid%20Facebook%20permissions',
    },
    server_error: {
        errorCode: 'server_error',
        description: 'Facebook server encountered an error',
        userFriendlyMessage: 'Facebook is experiencing technical difficulties. Please try again later.',
        urlParams: 'error=server_error&reason=Facebook%20server%20error',
    },
    temporarily_unavailable: {
        errorCode: 'temporarily_unavailable',
        description: 'Facebook service temporarily unavailable',
        userFriendlyMessage: 'Facebook login is temporarily unavailable. Please try again in a few minutes.',
        urlParams: 'error=temporarily_unavailable&reason=Facebook%20service%20unavailable',
    },

    // Facebook-specific SDK errors
    password_changed: {
        errorCode: 'password_changed',
        description: 'User password has changed and must log in again',
        userFriendlyMessage: 'Your Facebook password has changed. Please log in to Facebook again and retry.',
        urlParams: 'error=password_changed&reason=Facebook%20password%20changed',
    },
    user_checkpointed: {
        errorCode: 'user_checkpointed',
        description: 'User must log in to Facebook.com to restore access',
        userFriendlyMessage: 'Please log in to Facebook.com first to verify your account, then try connecting again.',
        urlParams: 'error=user_checkpointed&reason=Facebook%20account%20verification%20required',
    },
    unconfirmed_user: {
        errorCode: 'unconfirmed_user',
        description: 'User must confirm their Facebook account before logging in',
        userFriendlyMessage: 'Please confirm your Facebook account via email before connecting.',
        urlParams: 'error=unconfirmed_user&reason=Facebook%20account%20confirmation%20required',
    },
    app_disabled: {
        errorCode: 'app_disabled',
        description: 'App has been disabled in Facebook settings',
        userFriendlyMessage: 'Please enable this app in your Facebook Settings > Apps and Websites, then try again.',
        urlParams: 'error=app_disabled&reason=App%20disabled%20in%20Facebook%20settings',
    },
}

// LinkedIn OAuth2 Error Mappings
export const LINKEDIN_OAUTH_ERRORS: Record<string, OAuthErrorResponse> = {
    // Standard OAuth2 Errors
    access_denied: {
        errorCode: 'access_denied',
        description: 'User denied authorization request',
        userFriendlyMessage: 'You cancelled the LinkedIn login. Please try again if you want to connect your account.',
        urlParams: 'error=access_denied&reason=User%20cancelled%20LinkedIn%20login',
    },
    invalid_request: {
        errorCode: 'invalid_request',
        description: 'Invalid authorization request parameters',
        userFriendlyMessage: 'There was a problem with the LinkedIn connection request. Please contact support.',
        urlParams: 'error=invalid_request&reason=Invalid%20LinkedIn%20authorization%20parameters',
    },
    invalid_client: {
        errorCode: 'invalid_client',
        description: 'Invalid client credentials',
        userFriendlyMessage: 'LinkedIn app configuration error. Please contact support.',
        urlParams: 'error=invalid_client&reason=LinkedIn%20app%20misconfiguration',
    },
    invalid_scope: {
        errorCode: 'invalid_scope',
        description: 'Invalid or unauthorized scope requested',
        userFriendlyMessage: 'The requested LinkedIn permissions are not available for your account.',
        urlParams: 'error=invalid_scope&reason=Invalid%20LinkedIn%20permissions',
    },
    server_error: {
        errorCode: 'server_error',
        description: 'LinkedIn server encountered an error',
        userFriendlyMessage: 'LinkedIn is experiencing technical difficulties. Please try again later.',
        urlParams: 'error=server_error&reason=LinkedIn%20server%20error',
    },

    // LinkedIn-specific errors
    user_cancelled_login: {
        errorCode: 'user_cancelled_login',
        description: 'Member declined to log in to their LinkedIn account',
        userFriendlyMessage: 'You cancelled the LinkedIn login. Please try again if you want to connect your account.',
        urlParams: 'error=user_cancelled_login&reason=LinkedIn%20login%20cancelled',
    },
    user_cancelled_authorize: {
        errorCode: 'user_cancelled_authorize',
        description: 'Member refused to authorize the permissions request',
        userFriendlyMessage:
            'You declined to grant permissions to access your LinkedIn account. Please try again and accept the required permissions.',
        urlParams: 'error=user_cancelled_authorize&reason=LinkedIn%20permissions%20declined',
    },
    invalid_redirect_uri: {
        errorCode: 'invalid_redirect_uri',
        description: 'Redirect URI does not match registered URI',
        userFriendlyMessage: 'LinkedIn connection configuration error. Please contact support.',
        urlParams: 'error=invalid_redirect_uri&reason=LinkedIn%20redirect%20URI%20mismatch',
    },
    authorization_code_expired: {
        errorCode: 'authorization_code_expired',
        description: 'Authorization code has expired',
        userFriendlyMessage: 'The LinkedIn authorization expired. Please try connecting your account again.',
        urlParams: 'error=authorization_code_expired&reason=LinkedIn%20authorization%20expired',
    },
}

// Twitter/X OAuth2 Error Mappings
export const TWITTER_OAUTH_ERRORS: Record<string, OAuthErrorResponse> = {
    // Standard OAuth2 Errors
    access_denied: {
        errorCode: 'access_denied',
        description: 'User denied authorization request',
        userFriendlyMessage: 'You cancelled the Twitter login. Please try again if you want to connect your account.',
        urlParams: 'error=access_denied&reason=User%20cancelled%20Twitter%20login',
    },
    invalid_request: {
        errorCode: 'invalid_request',
        description: 'Invalid authorization request parameters',
        userFriendlyMessage: 'There was a problem with the Twitter connection request. Please contact support.',
        urlParams: 'error=invalid_request&reason=Invalid%20Twitter%20authorization%20parameters',
    },
    invalid_client: {
        errorCode: 'invalid_client',
        description: 'Invalid client credentials',
        userFriendlyMessage: 'Twitter app configuration error. Please contact support.',
        urlParams: 'error=invalid_client&reason=Twitter%20app%20misconfiguration',
    },
    invalid_scope: {
        errorCode: 'invalid_scope',
        description: 'Invalid or unauthorized scope requested',
        userFriendlyMessage: 'The requested Twitter permissions are not available. Please contact support.',
        urlParams: 'error=invalid_scope&reason=Invalid%20Twitter%20permissions',
    },
    server_error: {
        errorCode: 'server_error',
        description: 'Twitter server encountered an error',
        userFriendlyMessage: 'Twitter is experiencing technical difficulties. Please try again later.',
        urlParams: 'error=server_error&reason=Twitter%20server%20error',
    },

    // Twitter-specific errors
    invalid_client_id: {
        errorCode: 'invalid_client_id',
        description: 'Invalid Twitter client ID',
        userFriendlyMessage: 'Twitter app configuration error. Please contact support.',
        urlParams: 'error=invalid_client_id&reason=Invalid%20Twitter%20client%20ID',
    },
    invalid_redirect_uri: {
        errorCode: 'invalid_redirect_uri',
        description: 'Redirect URI does not match registered URI',
        userFriendlyMessage: 'Twitter connection configuration error. Please contact support.',
        urlParams: 'error=invalid_redirect_uri&reason=Twitter%20redirect%20URI%20mismatch',
    },
    suspended_app: {
        errorCode: 'suspended_app',
        description: 'Twitter app has been suspended',
        userFriendlyMessage: 'Twitter login is currently unavailable. Please contact support.',
        urlParams: 'error=suspended_app&reason=Twitter%20app%20suspended',
    },
}

// Bluesky OAuth2 Error Mappings
export const BLUESKY_OAUTH_ERRORS: Record<string, OAuthErrorResponse> = {
    access_denied: {
        errorCode: 'access_denied',
        description: 'User denied authorization request',
        userFriendlyMessage: 'You cancelled the Bluesky login. Please try again if you want to connect your account.',
        urlParams: 'error=access_denied&reason=User%20cancelled%20Bluesky%20login',
    },
    invalid_request: {
        errorCode: 'invalid_request',
        description: 'Invalid authorization request parameters',
        userFriendlyMessage: 'There was a problem with the Bluesky connection request. Please contact support.',
        urlParams: 'error=invalid_request&reason=Invalid%20Bluesky%20authorization%20parameters',
    },
    invalid_client: {
        errorCode: 'invalid_client',
        description: 'Invalid client credentials',
        userFriendlyMessage: 'Bluesky app configuration error. Please contact support.',
        urlParams: 'error=invalid_client&reason=Bluesky%20app%20misconfiguration',
    },
    invalid_scope: {
        errorCode: 'invalid_scope',
        description: 'Invalid or unauthorized scope requested',
        userFriendlyMessage: 'The requested Bluesky permissions are not available. Please contact support.',
        urlParams: 'error=invalid_scope&reason=Invalid%20Bluesky%20permissions',
    },
    unauthorized_client: {
        errorCode: 'unauthorized_client',
        description: 'Client is not authorized to request an authorization code',
        userFriendlyMessage:
            'Bluesky client is not authorized for this action. Please verify your app configuration before retrying.',
        urlParams: 'error=unauthorized_client&reason=Bluesky%20client%20not%20authorized',
    },
    server_error: {
        errorCode: 'server_error',
        description: 'Bluesky server encountered an error',
        userFriendlyMessage: 'Bluesky is experiencing technical difficulties. Please try again later.',
        urlParams: 'error=server_error&reason=Bluesky%20server%20error',
    },
    temporarily_unavailable: {
        errorCode: 'temporarily_unavailable',
        description: 'Bluesky service temporarily unavailable',
        userFriendlyMessage: 'Bluesky login is temporarily unavailable. Please try again in a few minutes.',
        urlParams: 'error=temporarily_unavailable&reason=Bluesky%20service%20unavailable',
    },
}

// Google OAuth2 Error Mappings (for YouTube)
export const GOOGLE_OAUTH_ERRORS: Record<string, OAuthErrorResponse> = {
    // Standard OAuth2 Errors
    access_denied: {
        errorCode: 'access_denied',
        description: 'User denied authorization request',
        userFriendlyMessage: 'You cancelled the Google login. Please try again if you want to connect your account.',
        urlParams: 'error=access_denied&reason=User%20cancelled%20Google%20login',
    },
    invalid_request: {
        errorCode: 'invalid_request',
        description: 'Invalid authorization request parameters',
        userFriendlyMessage: 'There was a problem with the Google connection request. Please contact support.',
        urlParams: 'error=invalid_request&reason=Invalid%20Google%20authorization%20parameters',
    },
    invalid_client: {
        errorCode: 'invalid_client',
        description: 'Invalid client credentials',
        userFriendlyMessage: 'Google app configuration error. Please contact support.',
        urlParams: 'error=invalid_client&reason=Google%20app%20misconfiguration',
    },
    invalid_scope: {
        errorCode: 'invalid_scope',
        description: 'Invalid or unauthorized scope requested',
        userFriendlyMessage: 'The requested Google permissions are not available. Please contact support.',
        urlParams: 'error=invalid_scope&reason=Invalid%20Google%20permissions',
    },
    server_error: {
        errorCode: 'server_error',
        description: 'Google server encountered an error',
        userFriendlyMessage: 'Google is experiencing technical difficulties. Please try again later.',
        urlParams: 'error=server_error&reason=Google%20server%20error',
    },
    temporarily_unavailable: {
        errorCode: 'temporarily_unavailable',
        description: 'Google service temporarily unavailable',
        userFriendlyMessage: 'Google login is temporarily unavailable. Please try again in a few minutes.',
        urlParams: 'error=temporarily_unavailable&reason=Google%20service%20unavailable',
    },

    // Google-specific errors
    invalid_grant: {
        errorCode: 'invalid_grant',
        description: 'Authorization code expired or invalid',
        userFriendlyMessage: 'The Google authorization expired. Please try connecting your account again.',
        urlParams: 'error=invalid_grant&reason=Google%20authorization%20expired',
    },
    redirect_uri_mismatch: {
        errorCode: 'redirect_uri_mismatch',
        description: 'Redirect URI does not match registered URI',
        userFriendlyMessage: 'Google connection configuration error. Please contact support.',
        urlParams: 'error=redirect_uri_mismatch&reason=Google%20redirect%20URI%20mismatch',
    },
    unsupported_response_type: {
        errorCode: 'unsupported_response_type',
        description: 'Unsupported response type',
        userFriendlyMessage: 'Google connection configuration error. Please contact support.',
        urlParams: 'error=unsupported_response_type&reason=Unsupported%20Google%20response%20type',
    },
}

// Pinterest OAuth2 Error Mappings
export const PINTEREST_OAUTH_ERRORS: Record<string, OAuthErrorResponse> = {
    // Standard OAuth2 Errors
    access_denied: {
        errorCode: 'access_denied',
        description: 'User denied authorization request',
        userFriendlyMessage: 'You cancelled the Pinterest login. Please try again if you want to connect your account.',
        urlParams: 'error=access_denied&reason=User%20cancelled%20Pinterest%20login',
    },
    invalid_request: {
        errorCode: 'invalid_request',
        description: 'Invalid authorization request parameters',
        userFriendlyMessage: 'There was a problem with the Pinterest connection request. Please contact support.',
        urlParams: 'error=invalid_request&reason=Invalid%20Pinterest%20authorization%20parameters',
    },
    invalid_client: {
        errorCode: 'invalid_client',
        description: 'Invalid client credentials',
        userFriendlyMessage: 'Pinterest app configuration error. Please contact support.',
        urlParams: 'error=invalid_client&reason=Pinterest%20app%20misconfiguration',
    },
    invalid_scope: {
        errorCode: 'invalid_scope',
        description: 'Invalid or unauthorized scope requested',
        userFriendlyMessage: 'The requested Pinterest permissions are not available. Please contact support.',
        urlParams: 'error=invalid_scope&reason=Invalid%20Pinterest%20permissions',
    },
    server_error: {
        errorCode: 'server_error',
        description: 'Pinterest server encountered an error',
        userFriendlyMessage: 'Pinterest is experiencing technical difficulties. Please try again later.',
        urlParams: 'error=server_error&reason=Pinterest%20server%20error',
    },

    // Pinterest-specific errors
    invalid_redirect_uri: {
        errorCode: 'invalid_redirect_uri',
        description: 'Redirect URI does not match registered URI',
        userFriendlyMessage: 'Pinterest connection configuration error. Please contact support.',
        urlParams: 'error=invalid_redirect_uri&reason=Pinterest%20redirect%20URI%20mismatch',
    },
    unsupported_response_type: {
        errorCode: 'unsupported_response_type',
        description: 'Unsupported response type',
        userFriendlyMessage: 'Pinterest connection configuration error. Please contact support.',
        urlParams: 'error=unsupported_response_type&reason=Unsupported%20Pinterest%20response%20type',
    },
}

// TikTok OAuth2 Error Mappings
export const TIKTOK_OAUTH_ERRORS: Record<string, OAuthErrorResponse> = {
    // Standard OAuth2 Errors
    access_denied: {
        errorCode: 'access_denied',
        description: 'User denied authorization request',
        userFriendlyMessage: 'You cancelled the TikTok login. Please try again if you want to connect your account.',
        urlParams: 'error=access_denied&reason=User%20cancelled%20TikTok%20login',
    },
    invalid_request: {
        errorCode: 'invalid_request',
        description: 'Invalid authorization request parameters',
        userFriendlyMessage: 'There was a problem with the TikTok connection request. Please contact support.',
        urlParams: 'error=invalid_request&reason=Invalid%20TikTok%20authorization%20parameters',
    },
    invalid_client: {
        errorCode: 'invalid_client',
        description: 'Invalid client credentials',
        userFriendlyMessage: 'TikTok app configuration error. Please contact support.',
        urlParams: 'error=invalid_client&reason=TikTok%20app%20misconfiguration',
    },
    invalid_scope: {
        errorCode: 'invalid_scope',
        description: 'Invalid or unauthorized scope requested',
        userFriendlyMessage: 'The requested TikTok permissions are not available. Please contact support.',
        urlParams: 'error=invalid_scope&reason=Invalid%20TikTok%20permissions',
    },
    server_error: {
        errorCode: 'server_error',
        description: 'TikTok server encountered an error',
        userFriendlyMessage: 'TikTok is experiencing technical difficulties. Please try again later.',
        urlParams: 'error=server_error&reason=TikTok%20server%20error',
    },

    // TikTok-specific errors
    invalid_redirect_uri: {
        errorCode: 'invalid_redirect_uri',
        description: 'Redirect URI does not match registered URI',
        userFriendlyMessage: 'TikTok connection configuration error. Please contact support.',
        urlParams: 'error=invalid_redirect_uri&reason=TikTok%20redirect%20URI%20mismatch',
    },
    rate_limit_exceeded: {
        errorCode: 'rate_limit_exceeded',
        description: 'Too many authorization requests',
        userFriendlyMessage: 'Too many TikTok login attempts. Please wait a few minutes and try again.',
        urlParams: 'error=rate_limit_exceeded&reason=TikTok%20rate%20limit%20exceeded',
    },
}

// Generic fallback errors for platforms without specific mappings
export const GENERIC_OAUTH_ERRORS: Record<string, OAuthErrorResponse> = {
    access_denied: {
        errorCode: 'access_denied',
        description: 'User denied authorization request',
        userFriendlyMessage: 'You cancelled the login. Please try again if you want to connect your account.',
        urlParams: 'error=access_denied&reason=User%20cancelled%20login',
    },
    invalid_request: {
        errorCode: 'invalid_request',
        description: 'Invalid authorization request parameters',
        userFriendlyMessage: 'There was a problem with the connection request. Please contact support.',
        urlParams: 'error=invalid_request&reason=Invalid%20authorization%20parameters',
    },
    server_error: {
        errorCode: 'server_error',
        description: 'Server encountered an error',
        userFriendlyMessage: 'The service is experiencing technical difficulties. Please try again later.',
        urlParams: 'error=server_error&reason=Server%20error',
    },
    network_error: {
        errorCode: 'network_error',
        description: 'Network connection failed',
        userFriendlyMessage: 'Connection failed. Please check your internet connection and try again.',
        urlParams: 'error=network_error&reason=Network%20connection%20failed',
    },
    timeout: {
        errorCode: 'timeout',
        description: 'Request timed out',
        userFriendlyMessage: 'The connection took too long. Please try again.',
        urlParams: 'error=timeout&reason=Connection%20timeout',
    },
    unknown_error: {
        errorCode: 'unknown_error',
        description: 'An unknown error occurred',
        userFriendlyMessage: 'An unexpected error occurred. Please try again or contact support.',
        urlParams: 'error=unknown_error&reason=Unknown%20error%20occurred',
    },
    duplicates_error: {
        errorCode: 'duplicates_error',
        description: 'Duplicated social media account',
        userFriendlyMessage: 'You cannot connect single account several times.',
        urlParams: 'error=duplicates&reason=The%20account%20is%20already%20conected',
    },
}

// Platform-specific error mappings
export const PLATFORM_ERROR_MAPPINGS = {
    [SocilaMediaPlatform.FACEBOOK]: FACEBOOK_OAUTH_ERRORS,
    [SocilaMediaPlatform.INSTAGRAM]: FACEBOOK_OAUTH_ERRORS, // Instagram uses Facebook OAuth
    [SocilaMediaPlatform.THREADS]: FACEBOOK_OAUTH_ERRORS,
    [SocilaMediaPlatform.LINKEDIN]: LINKEDIN_OAUTH_ERRORS,
    [SocilaMediaPlatform.GOOGLE]: GOOGLE_OAUTH_ERRORS,
    [SocilaMediaPlatform.YOUTUBE]: GOOGLE_OAUTH_ERRORS, // YouTube uses Google OAuth
    [SocilaMediaPlatform.PINTEREST]: PINTEREST_OAUTH_ERRORS,
    [SocilaMediaPlatform.TIKTOK]: TIKTOK_OAUTH_ERRORS,
    [SocilaMediaPlatform.X]: TWITTER_OAUTH_ERRORS,
    [SocilaMediaPlatform.BLUESKY]: BLUESKY_OAUTH_ERRORS,
}
