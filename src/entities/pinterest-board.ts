export class PinterestBoard {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly socialAccountId: string,
        public readonly pinterestBoardId: string,
        public readonly name: string,
        public readonly description: string | null,
        public readonly ownerUsername: string | null,
        public readonly thumbnailUrl: string | null,
        public readonly privacy: 'PUBLIC' | 'PROTECTED' | 'SECRET',
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}
}
