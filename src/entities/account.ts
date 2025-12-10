import { PostPlatform } from '../schemas/posts.schemas'

export class SocialAccount {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly platform: string,
        public readonly username: string,
        public readonly accessToken: string,
        public readonly connectedAt: Date | string,
        public readonly pageId: string,
        public readonly picture?: string,
        public readonly refreshToken?: string,
        public readonly expiresIn?: Date,
        public readonly refreshExpiresIn?: Date,
        public readonly maxVideoPostDurationSec?: number | null,
        public readonly privacyLevelOptions?: string[] | null
    ) {}
}

// Keep the Account export for backward compatibility during transition
export class Account extends SocialAccount {
    constructor(
        id: string,
        tenantId: string,
        platform: string,
        username: string,
        accessToken: string,
        // Legacy parameters for backward compatibility
        connectedAt: string | Date,
        pageId: string,
        picture?: string,
        refreshToken?: string,
        expiresIn?: Date,
        refreshExpiresIn?: Date,
        maxVideoPostDurationSec?: number | null,
        privacyLevelOptions?: string[] | null
    ) {
        super(
            id,
            tenantId,
            platform,
            username,
            accessToken,
            connectedAt,
            pageId,
            picture,
            refreshToken,
            expiresIn,
            refreshExpiresIn,
            maxVideoPostDurationSec,
            privacyLevelOptions
        )
    }
}

export class SocialTokenSnapshot {
    constructor(
        public readonly id: string,
        public readonly platform: PostPlatform,
        public readonly accessToken: string,
        public readonly refreshToken: string | null
    ) {}
}
