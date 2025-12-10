export class TenantSettings {
    constructor(
        public readonly id: string,
        public readonly tenantId: string,
        public readonly timezone: string,
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}
}
