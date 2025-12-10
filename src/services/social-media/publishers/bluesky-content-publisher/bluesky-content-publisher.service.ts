import { ILogger } from "@/shared/infra/logger";
import { IBlueskyConntentPublisherService } from "./bluesky-content-publisher.interface";
import { IAccountRepository } from "@/repositories/account-repository";
import { IPostsRepository } from "@/repositories/posts-repository";
import { PostStatus, PostTargetResponse } from "@/types/posts.types";
import { formatCaptionWithTags } from "../../utils/format-captions-with-tags";
import { getEnvVar } from "@/shared/utils/get-env-var";
import { ErrorCode } from "@/shared/consts/error-codes.const";
import { BaseAppError } from "@/shared/errors/base-error";
import { IApiClient } from "@/shared/infra/api";
import { SocialMediaErrorHandler } from "@/shared/infra/social-media-errors";

type ResponseWithHeaders<T> = {
	data: T
	headers?: Record<string, unknown>
}

export class BlueskyContentPublisherService implements IBlueskyConntentPublisherService {
	private logger: ILogger
	private httpClient: IApiClient
	private accountRepository: IAccountRepository
	private postRepository: IPostsRepository
	private socialMediaErrorHandler: SocialMediaErrorHandler
	
	private readonly baseApiUrl: string

	constructor (logger: ILogger, accountRepository: IAccountRepository, postRepository: IPostsRepository, httpClient: IApiClient, socialMediaErrorHandler: SocialMediaErrorHandler ) {
		this.logger = logger
		this.accountRepository = accountRepository
		this.postRepository = postRepository
		this.httpClient = httpClient
		this.socialMediaErrorHandler = socialMediaErrorHandler
		this.baseApiUrl = getEnvVar('BLUESKY_API_BASE_URL') || getEnvVar('BLUESKY_OAUTH_BASE_URL') || 'https://bsky.social'
	}

	private async buildBlueskyExternalEmbed(
        link: string,
        text: string,
        accessToken: string,
        apiBaseUrl: string,
        postId: string
    ): Promise<Record<string, unknown> | undefined> {
        let normalizedLink: string
        try {
            normalizedLink = new URL(link).toString()
        } catch (error) {
            this.logger.warn('Skipping Bluesky external embed due to invalid link', {
                operation: 'buildBlueskyExternalEmbed',
                link,
            })
            return undefined
        }

        let html: string | undefined
        try {
			
            const response = await this.httpClient.get<string>(normalizedLink, {
				timeoutMs: 8000,
				responseType: 'text',
                headers: {
                    'User-Agent': 'EasyPostSocialMediaBot/1.0',
                },
				raw: {
					maxContentLength: 2 * 1024 * 1024,
				},
            })

            html = typeof response === 'string' ? response : undefined
        } catch (error) {
            this.logger.warn('Unable to fetch OG metadata for Bluesky link', {
                operation: 'buildBlueskyExternalEmbed',
                link: normalizedLink,
            })
        }

        const ogTitle = html ? this.extractBlueskyMetaContent(html, ['og:title', 'twitter:title']) : undefined
        const ogDescription = html
            ? this.extractBlueskyMetaContent(html, ['og:description', 'twitter:description'])
            : undefined
        const ogImage = html ? this.extractBlueskyMetaContent(html, ['og:image', 'twitter:image']) : undefined

        const title = ogTitle?.trim() || normalizedLink
        const descriptionSource = (ogDescription || text || normalizedLink).trim().slice(0, 300)
        const description = descriptionSource || normalizedLink

        let thumbBlob: unknown | undefined

        if (ogImage) {
            try {
                const resolvedImageUrl = new URL(ogImage, normalizedLink).toString()

                const imageResponse = await this.httpClient.get<ResponseWithHeaders<ArrayBuffer>>(resolvedImageUrl, {
                    responseType: 'arraybuffer',
                    timeoutMs: 8000,
					raw: {
						maxContentLength: 3 * 1024 * 1024,
							transformResponse: [(data: unknown, headers?: Record<string, unknown>) => ({ data, headers })],
						},
                })

                const contentType = String(
					(imageResponse.headers?.['content-type'] ||
						imageResponse.headers?.['Content-Type'] ||
						'') || ''
				)

                if (!contentType.startsWith('image/')) {
                    throw new Error('OG image is not an image content type')
                }

                const uploadResponse = await this.httpClient.post<{ blob?: unknown }>(
                    `${apiBaseUrl}/xrpc/com.atproto.repo.uploadBlob`,
                    Buffer.from(imageResponse.data),
                    {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                            'Content-Type': contentType || 'application/octet-stream',
                        },
                    }
                )

                const blob = uploadResponse?.blob
                if (blob) {
                    thumbBlob = blob
                } else {
                    this.logger.warn('Bluesky OG image upload missing blob data', {
                        operation: 'buildBlueskyExternalEmbed',
                        postId,
                    })
                }
            } catch (error) {
                this.logger.warn('Failed to attach OG image to Bluesky external embed', {
                    operation: 'buildBlueskyExternalEmbed',
                    link: normalizedLink,
                    postId,
                })
            }
        }

        const embed: Record<string, unknown> = {
            $type: 'app.bsky.embed.external',
            external: {
                uri: normalizedLink,
                title,
                description,
            },
        }

        if (thumbBlob) {
            ;(embed.external as Record<string, unknown>).thumb = thumbBlob
        }

        return embed
    }

	private extractBlueskyMetaContent(html: string, keys: string[]): string | undefined {
        for (const key of keys) {
            const patterns = [
                new RegExp(`<meta[^>]+(?:property|name)=[\"']${key}[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>`, 'i'),
                new RegExp(`<meta[^>]+content=[\"']([^\"']+)[\"'][^>]*(?:property|name)=[\"']${key}[\"'][^>]*>`, 'i'),
            ]

            for (const pattern of patterns) {
                const match = pattern.exec(html)
                if (match?.[1]) {
                    return match[1]
                }
            }
        }

        return undefined
    }

	private buildBlueskyFacets(
        text: string
    ): Array<{ index: { byteStart: number; byteEnd: number }; features: Array<Record<string, unknown>> }> {
        const facets: Array<{ index: { byteStart: number; byteEnd: number }; features: Array<Record<string, unknown>> }> =
            []

        if (!text) return facets

        const addFacet = (matchText: string, startIndex: number, feature: Record<string, unknown>): void => {
            const byteStart = Buffer.byteLength(text.slice(0, startIndex), 'utf8')
            const byteEnd = byteStart + Buffer.byteLength(matchText, 'utf8')

            facets.push({
                index: { byteStart, byteEnd },
                features: [feature],
            })
        }

        const hashtagPattern = /#[\p{L}\p{N}_]+/gu
        let hashtagMatch: RegExpExecArray | null

        while ((hashtagMatch = hashtagPattern.exec(text)) !== null) {
            const hashtag = hashtagMatch[0].slice(1)
            if (hashtag.length === 0) {
                continue
            }

            addFacet(hashtagMatch[0], hashtagMatch.index, {
                $type: 'app.bsky.richtext.facet#tag',
                tag: hashtag,
            })
        }

        const linkPattern = /https?:\/\/[^\s]+/gi
        let linkMatch: RegExpExecArray | null

        while ((linkMatch = linkPattern.exec(text)) !== null) {
            const uri = linkMatch[0]
            try {
                const normalizedUri = new URL(uri).toString()
                addFacet(uri, linkMatch.index, {
                    $type: 'app.bsky.richtext.facet#link',
                    uri: normalizedUri,
                })
            } catch (error) {
                this.logger.warn('Skipping invalid Bluesky link facet', {
                    operation: 'buildBlueskyFacets',
                    uri,
                })
            }
        }

		return facets
    }


	async sendPostToBluesky(		
		postTarget: PostTargetResponse,
			userId: string,
			postId: string,
			mainCaption?: string) {
		try {
            const { accessToken: initialAccessToken, pageId } =
                await this.accountRepository.getAccountByUserIdAndSocialAccountId(userId, postTarget.socialAccountId)

			const baseText = postTarget.text || mainCaption || ''
            const textWithTags = formatCaptionWithTags(baseText, postTarget.tags, 'bluesky')
			const links = postTarget.links?.filter((link) => link && link.trim().length > 0) || []
            const initialText = textWithTags

            const mediaAssets = await this.postRepository.getPostMediaAssets(postId)
            const linkEmbedCandidate = links[0]
            const maxLength = Number(process.env.BLUESKY_POST_MAX_LENGTH || 300)
            let lastCharLength = 0

			const performPost = async (accessToken: string): Promise<void> => {
                let text = initialText
                let embed: Record<string, unknown> | undefined

                if (mediaAssets.length > 0) {
                    if (mediaAssets.length > 4) {
                        throw new BaseAppError('Bluesky supports up to 4 images per post', ErrorCode.BAD_REQUEST, 400)
                    }

                    const unsupportedAsset = mediaAssets.find((asset) => !asset.type?.startsWith('image'))
                    if (unsupportedAsset) {
                        throw new BaseAppError(
                            'Bluesky currently supports image attachments only',
                            ErrorCode.BAD_REQUEST,
                            400
                        )
                    }

                    const images: Array<{ image: unknown; alt: string }> = []

                    for (let index = 0; index < mediaAssets.length; index++) {
                        const asset = mediaAssets[index]
                        const mediaResponse = await this.httpClient.get<ArrayBuffer>(asset.url, { responseType: 'arraybuffer' })
                        const mediaBuffer = Buffer.isBuffer(mediaResponse) ? mediaResponse : Buffer.from(mediaResponse)

                        const uploadResponse = await this.httpClient.post<{ blob?: unknown }>(
                            `${this.baseApiUrl}/xrpc/com.atproto.repo.uploadBlob`,
                            mediaBuffer,
                            {
                                headers: {
                                    Authorization: `Bearer ${accessToken}`,
                                    'Content-Type': asset.type || 'application/octet-stream',
                                },
                            }
                        )

                        const blob = uploadResponse?.blob

                        if (!blob) {
                            throw new BaseAppError(
                                'Bluesky did not return blob metadata for uploaded image',
                                ErrorCode.UNKNOWN_ERROR,
                                500
                            )
                        }

                        images.push({
                            image: blob,
                            alt: `Image ${index + 1} for post ${postId}`,
                        })
                    }

                    embed = {
                        $type: 'app.bsky.embed.images',
                        images,
                    }
                } else if (linkEmbedCandidate) {
                    embed = await this.buildBlueskyExternalEmbed(
                        linkEmbedCandidate,
                        text,
                        accessToken,
                        this.baseApiUrl,
                        postId
                    )
                }

                if (!text && !embed && links.length > 0) {
                    text = links.join('\n')
                }

                const charLength = Array.from(text).length
                if (charLength > maxLength) {
                    throw new BaseAppError(
                        `Bluesky posts are limited to ${maxLength} characters including hashtags and links`,
                        ErrorCode.BAD_REQUEST,
                        400
                    )
                }
                lastCharLength = charLength

                if (!text && !embed) {
                    throw new BaseAppError('Bluesky posts require text or image content', ErrorCode.BAD_REQUEST, 400)
                }

                const record: Record<string, unknown> = {
                    $type: 'app.bsky.feed.post',
                    text,
                    createdAt: new Date().toISOString(),
                }

                if (embed) {
                    record.embed = embed
                }

                const facets = this.buildBlueskyFacets(text)
                if (facets.length > 0) {
                    record.facets = facets
                }

                const payload = {
                    repo: pageId,
                    collection: 'app.bsky.feed.post',
                    record,
                }

                await this.httpClient.post(`${this.baseApiUrl}/xrpc/com.atproto.repo.createRecord`, payload, {
					headers: {
						Authorization: `Bearer ${accessToken}`,
						'Content-Type': 'application/json',
					},
				})
            }

			await performPost(initialAccessToken)

			await this.postRepository.updatePostTarget(
				userId,
				postId,
				postTarget.socialAccountId,
				PostStatus.DONE
			)

			this.logger.info('Bluesky post created successfully', {
				operation: 'sendPostToBluesky',
				userId,
				postId,
				socialAccountId: postTarget.socialAccountId,
				mediaCount: mediaAssets.length,
				charLength: lastCharLength,
			})
		} catch (error: unknown) {
            const errorResult = await this.socialMediaErrorHandler.handleSocialMediaError(
                error,
                'bluesky',
                userId,
                postId,
                postTarget.socialAccountId
            )

            throw errorResult.error
		}
	}
}
