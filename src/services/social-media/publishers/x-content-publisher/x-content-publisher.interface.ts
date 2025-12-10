import { PostTargetResponse } from "@/types/posts.types";

export interface IXContentPublisherService {
	sendPostToX(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		mainCaption?: string
	): Promise<void>
}
