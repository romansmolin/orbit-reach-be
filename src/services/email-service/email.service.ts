import { ILogger } from "@/shared/infra/logger";
import { IEmailService } from "./email-service.interface";
import { BaseAppError } from "@/shared/errors/base-error";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import { getEnvVar } from "@/shared/utils/get-env-var";
import nodemailer, { Transporter } from 'nodemailer';
import SMTPConnection from 'nodemailer/lib/smtp-connection';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on'])
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off'])

const parseBooleanEnv = (value: string): boolean => {
	const normalized = value.trim().toLowerCase()

	if (TRUE_VALUES.has(normalized)) return true
	if (FALSE_VALUES.has(normalized)) return false

	throw new Error(`Invalid boolean environment value: ${value}`)
}

const parsePortEnv = (value: string): number => {
	const port = Number(value)

	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(`Invalid NODEMAILER_PORT value: ${value}`)
	}

	return port
}

export class NodemailerEmailService implements IEmailService {
	private logger: ILogger
	private transporter: Transporter
	private senderEmail: string
	private transportConfig: Pick<SMTPConnection.Options, 'host' | 'port' | 'secure'>

	constructor(logger: ILogger) {
		this.logger = logger
		this.senderEmail = getEnvVar('NODEMAILER_EMAIL')

		const transportOptions: SMTPConnection.Options = {
			host: getEnvVar('NODEMAILER_HOST'),
			port: parsePortEnv(getEnvVar('NODEMAILER_PORT')),
			secure: parseBooleanEnv(getEnvVar('NODEMAILER_SECURE')),
			auth: {
				user: this.senderEmail,
				pass: getEnvVar('NODEMAILER_EMAIL_PASS'),
			},
		}

		this.transportConfig = {
			host: transportOptions.host,
			port: transportOptions.port,
			secure: transportOptions.secure,
		}

		this.transporter = nodemailer.createTransport(transportOptions)
	}

	private generateEmailTemplate(name: string, message: string, email: string) {
		return `
			<html>
				<body>
					<h1>Message From ${name || 'Not provided'}</h1>
					<p><strong>Email:</strong> ${email || 'Not provided'}</p>
					<p><strong>Message:</strong> ${message || 'Not provided'}</p>
				</body>
			</html>
		`;
	};


	async sendEmail(name: string, email: string, message: string): Promise<void> {
		try {
			const html = this.generateEmailTemplate(name, message, email)

			await this.transporter.sendMail({
				from: `"ZapShipr" <${this.senderEmail}>`,
				to: this.senderEmail,
            	subject: `New Request Via Contact Form from ${email}`,
				html
			});

		} catch (error: unknown) {
			this.logger.error('Failed to send email', {
				error: {
					name: error instanceof Error ? error.name : 'Unknown',
					stack: error instanceof Error ? error.stack : undefined,
					code: error instanceof BaseAppError ? error.code : ErrorCode.UNKNOWN_ERROR,
				},
			})

			if (error instanceof BaseAppError) throw error

			throw new BaseAppError(`Failed to send email`, ErrorCode.UNKNOWN_ERROR, 500)
		}
	}

	async sendPasswordResetEmail(params: { to: string; name?: string; resetLink: string; token: string }): Promise<void> {
		const { to, name, resetLink, token } = params
		const tokenReference = token.split('.')?.[0] ?? token
		try {
			this.logger.info('Attempting to send password reset email', {
				operation: 'sendPasswordResetEmail',
				to,
				tokenReference,
				transport: this.transportConfig,
			})

			const html = `
				<html>
					<body>
						<p>Hi ${name || 'there'},</p>
						<p>We received a request to reset your ZapShipr password. Click the button below to choose a new password:</p>
						<p style="text-align:center;">
							<a href="${resetLink}" style="display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;">Reset Password</a>
						</p>
						<p>If the button doesn’t work, copy and paste this link into your browser:</p>
						<p><a href="${resetLink}">${resetLink}</a></p>
						<p>For security, your reset link is valid for the next hour. If you didn’t request this, you can safely ignore this email.</p>
						<hr />
						<p style="font-size:12px;color:#6b7280;">Token reference: ${token}</p>
					</body>
				</html>
			`

			await this.transporter.sendMail({
				from: `"ZapShipr" <${this.senderEmail}>`,
				to,
				subject: 'Reset your ZapShipr password',
				html,
			})

			this.logger.info('Password reset email sent successfully', {
				operation: 'sendPasswordResetEmail',
				to,
				tokenReference,
			})
		} catch (error: unknown) {
			this.logger.error('Failed to send password reset email', {
				operation: 'sendPasswordResetEmail',
				to,
				tokenReference,
				transport: this.transportConfig,
				error: {
					name: error instanceof Error ? error.name : 'Unknown',
					stack: error instanceof Error ? error.stack : undefined,
					code: error instanceof BaseAppError ? error.code : ErrorCode.UNKNOWN_ERROR,
				},
			})

			if (error instanceof BaseAppError) throw error

			throw new BaseAppError(`Failed to send password reset email`, ErrorCode.UNKNOWN_ERROR, 500)
		}
	}


}
