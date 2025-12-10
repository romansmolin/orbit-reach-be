import { PostTargetResponse } from "@/types/posts.types";

export interface IPinterestContentPublisherService {
	sendPostToPinterest(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		pinterestBoardId: string | null,
		mainCaption?: string
	): Promise<void>
}
