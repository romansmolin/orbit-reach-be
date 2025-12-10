import { ErrorCode } from "@/shared/consts/error-codes.const";
import { BaseAppError } from "@/shared/errors/base-error";
import { IMediaUploader } from "@/shared/infra/media";
import axios from "axios";


const getprofileImageAsBuffer = async (        
	imageUrl: string,
	accessToken?: string
): Promise<{ buffer: Buffer; contentType: string }> => {
	const headers: Record<string, string> = {
		'User-Agent':
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
	}
	if (accessToken) {
		headers.Authorization = `Bearer ${accessToken}`
	}

	const response = await axios.get(imageUrl, {
		responseType: 'arraybuffer',
		headers,
	})

	const buffer = Buffer.from(response.data, 'binary')
	const contentType = response.headers['content-type'] || 'application/octet-stream'

	return { buffer, contentType }
}


const sanitizeIdentifier = (identifier?: string | null): string => {
	if (!identifier) return 'avatar'


	const sanitized = identifier.trim().replace(/[^a-zA-Z0-9-_]/g, '_')
	return sanitized.length > 0 ? sanitized : 'avatar'
}

export const uploadAccountAvatar = async (
	mediaUploader: IMediaUploader,
	userId: string,
	identifier?: string | null,
	imageUrl?: string | null,
	accessToken?: string,
	contentTypeOverride?: string,
): Promise<string | undefined> => {
	try {

		if (!imageUrl) return undefined

		const { buffer, contentType } = await getprofileImageAsBuffer(imageUrl, accessToken)
        const safeIdentifier = sanitizeIdentifier(identifier)

		return mediaUploader.upload({
            key: `${userId}/accounts/${Date.now()}-${safeIdentifier}`,
            body: buffer,
            contentType: contentTypeOverride || contentType,
        })

	} catch (err: unknown) {
		throw new BaseAppError('Failed to upload account avatar', ErrorCode.BAD_REQUEST, 500)
	}
}