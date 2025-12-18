export class PromoCode {
    constructor(
        public readonly id: string,
        public readonly code: string,
        public readonly discountPercentage: number,
        public readonly isActive: boolean,
        public readonly maxUses: number | null,
        public readonly currentUses: number,
        public readonly validFrom: Date,
        public readonly validUntil: Date | null,
        public readonly createdAt: Date,
        public readonly updatedAt: Date
    ) {}

    isValid(): boolean {
        if (!this.isActive) {
            return false
        }

        const now = new Date()
        if (now < this.validFrom) {
            return false
        }

        if (this.validUntil && now > this.validUntil) {
            return false
        }

        if (this.maxUses !== null && this.currentUses >= this.maxUses) {
            return false
        }

        return true
    }

    calculateDiscount(amount: number): number {
        if (!this.isValid()) {
            return 0
        }
        return Math.floor((amount * this.discountPercentage) / 100)
    }
}

