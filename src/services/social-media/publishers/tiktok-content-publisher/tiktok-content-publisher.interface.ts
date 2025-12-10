import { CreatePostResponse, PostTargetResponse } from "@/types/posts.types";

export interface ITikTokContentPublisherService {
	sendPostToTikTok(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		mainCaption?: string,
		post?: CreatePostResponse
	): Promise<void>
}
