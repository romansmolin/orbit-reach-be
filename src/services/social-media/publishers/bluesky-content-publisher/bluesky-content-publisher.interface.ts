import { PostTargetResponse } from "@/types/posts.types";

export interface IBlueskyConntentPublisherService {
	sendPostToBluesky(
			postTarget: PostTargetResponse,
			userId: string,
			postId: string,
			mainCaption?: string
		): Promise<void>
}