export interface IEmailService {
	sendEmail(name: string, email: string, message: string): Promise<void>
	sendPasswordResetEmail(params: { to: string; name?: string; resetLink: string; token: string }): Promise<void>
}
