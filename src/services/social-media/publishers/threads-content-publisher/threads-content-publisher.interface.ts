import { CreatePostResponse, IPost, PostTargetResponse } from "@/types/posts.types";

export interface IThreadsContentPublisherService {
	sendPostToThreads(
		postTarget: PostTargetResponse,
		userId: string,
		postId: string,
		mainCaption?: string,
		post?: CreatePostResponse
	): Promise<IPost | null>
}
