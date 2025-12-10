export const formatCaptionWithTags = (	
	baseCaption: string | undefined,
	tags: string[] | undefined,
	platform: string
): string => {
	const caption = baseCaption || ''

	if (!tags || tags.length === 0) {
		return caption
	}

	const formattedTags = tags
		.filter((tag) => tag && tag.trim())
		.map((tag) => {
			const cleanTag = tag.replace(/^#/, '').trim()
			return `#${cleanTag}`
		})
		.join(' ')

	if (['instagram', 'tiktok', 'threads', 'facebook', 'x', 'bluesky'].includes(platform.toLowerCase())) {
		return caption ? `${caption}\n\n${formattedTags}` : formattedTags
	}

	return caption
}