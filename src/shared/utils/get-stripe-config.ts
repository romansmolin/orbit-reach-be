const isProduction = process.env.STRIPE_ENV === 'production'

export function getStripeConfigVar(baseName: string): string | undefined {
    if (isProduction) {
        return process.env[baseName]
    }

    return process.env[`${baseName}_DEV`] ?? process.env[baseName]
}
