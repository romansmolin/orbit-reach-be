export function getEnvVar(name: string): string {
	const value = process.env[name]

	if (value === undefined) {
		throw new Error(`Missing required environment variable: ${name}`)
	}

	const trimmedValue = value.trim()

	if (!trimmedValue) {
		throw new Error(`Environment variable is empty or whitespace: ${name}`)
	}

	return trimmedValue
}
