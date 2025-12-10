export class Plan {
    constructor(
        public readonly planName: string,
        public readonly monthlyPrice: number,
        public readonly yearlyPrice: number,
        public readonly popular: boolean,
        public readonly description: string,
        public readonly buttonText: string,
        public readonly benefitList: string[],
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}
}
