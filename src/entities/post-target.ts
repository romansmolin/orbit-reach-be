export class PostTargetEntity {
    constructor(
        public readonly postId: string,
        public readonly socialAccountId: string,
        public readonly platform: string,
        public readonly status: string,
        public readonly errorMessage?: string,
        public readonly text?: string,
        public readonly title?: string,
        public readonly pinterestBoardId?: string,
        public readonly tenantId?: string
    ) {}
}
