export class Tenant {
    constructor(
        public readonly id: string,
        public readonly name: string,
        public readonly email: string,
        public readonly googleAuth: boolean,
        public readonly password: string,
        public readonly avatar: string,
        public readonly refreshToken: string | null,
        public readonly createdAt: Date
    ) {}
}

// Keep the User export for backward compatibility during transition
export class User extends Tenant {
    constructor(
        id: string,
        name: string,
        email: string,
        googleAuth: boolean,
        password: string,
        avatar: string,
        refreshToken: string | null,
        createdAt: Date
    ) {
        super(id, name, email, googleAuth, password, avatar, refreshToken, createdAt)
    }

    // Legacy properties for compatibility
    get googleId(): string {
        return this.googleAuth ? 'google-authenticated' : ''
    }

    get passwordHash(): string {
        return this.password
    }

    get picture(): string {
        return this.avatar
    }

    // Mock trialEndsAt for backward compatibility
    get trialEndsAt(): Date {
        return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000) // 14 days from now
    }
}
