import Router from 'express'
import { authMiddleware } from '@/middleware/auth.middleware'
import { PostsController } from '../controllers/posts.controller'
import { upload } from '@/middleware/upload.middleware'
import { PostService } from '@/services/posts-service'
import { ILogger } from '@/shared/infra/logger/logger.interface'

const mediaFields = [...Array.from({ length: 10 }, (_, i) => ({ name: `media[${i}]` })), { name: 'coverImage' }]

const createPostRoutes = (logger: ILogger, postsService: PostService) => {
    const router = Router()
    const postsController = new PostsController(postsService, logger)
    router.use(authMiddleware)

    router.post('/post', upload.fields(mediaFields), postsController.createPost.bind(postsController))
    router.post('/post/retry', postsController.retryPostTarget.bind(postsController))

    router.put('/post/:postId', upload.single('media'), postsController.editPost.bind(postsController))
    router.delete('/post/:postId', postsController.deletePost.bind(postsController))

    router.get('/posts', postsController.getPostsByFilters.bind(postsController))
    router.get('/posts/by-date', postsController.getPostsByDate.bind(postsController))
    router.get('/posts/failed/count', postsController.getPostsFailedCount.bind(postsController))
    router.get('/posts/failed', postsController.getFailedPostTargets.bind(postsController))
    router.get('/posts/rate-limits', postsController.getRateLimits.bind(postsController))

    return router
}

export default createPostRoutes
