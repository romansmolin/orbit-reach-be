import { pgClient } from '../../db-connection'
import { PostTargetEntity } from '@/entities/post-target'
import {
    PostStatus,
    PostTarget,
    CreatePostResponse,
    PostFilters,
    PostsListResponse,
    PostsByDateResponse,
    PostTargetResponse,
} from '@/types/posts.types'
import { PostType } from '@/schemas/posts.schemas'
import { BaseAppError } from '@/shared/errors/base-error'
import { ILogger } from '@/shared/infra/logger/logger.interface'
import { Pool } from 'pg'
import { v4 as uuidv4 } from 'uuid'
import { IPostsRepository } from './posts.repository.interface'
import { ErrorCode } from '@/shared/consts/error-codes.const'
export class PostsRepository implements IPostsRepository {
    private client: Pool
    private logger: ILogger

    constructor(logger: ILogger) {
        this.logger = logger
        this.client = pgClient()
    }

    async createBasePost(
        userId: string,
        status: PostStatus,
        postType: PostType,
        scheduledTime: Date | null,
        mainCaption?: string,
        coverTimestamp?: number,
        coverImageUrl?: string
    ): Promise<{ postId: string }> {
        const client = await this.client.connect()
        const post_id = uuidv4()

        try {
            const result = await client.query(
                `
                INSERT INTO posts (tenant_id, status, type, scheduled_time, main_caption, cover_timestamp, cover_image_url, id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id
                `,
                [userId, status, postType, scheduledTime, mainCaption, coverTimestamp, coverImageUrl, post_id]
            )

            return { postId: result.rows[0].id }
        } catch (error) {
            this.logger.error('Failed to create base post', {
                operation: 'createBasePost',
                userId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to create post', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async savePostMediaAssets(data: { userId: string; url: string; type: string }): Promise<{ mediaId: string }> {
        const client = await this.client.connect()
        try {
            const postMediaAssetId = uuidv4()
            const result = await client.query(
                `
                INSERT INTO media_assets (tenant_id, url, type, id)
                VALUES ($1, $2, $3, $4)
                RETURNING id
                `,
                [data.userId, data.url, data.type, postMediaAssetId]
            )

            return { mediaId: result.rows[0].id }
        } catch (error) {
            this.logger.error('Failed to save media asset', {
                operation: 'savePostMediaAssets',
                userId: data.userId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to save media asset', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async createPostMediaAssetRelation(postId: string, mediaId: string, order: number): Promise<void> {
        const client = await this.client.connect()
        try {
            await client.query(
                `
                INSERT INTO post_media_assets (post_id, media_asset_id, "order")
                VALUES ($1, $2, $3)
                `,
                [postId, mediaId, order]
            )
        } catch (error) {
            this.logger.error('Failed to create post media relation', {
                operation: 'createPostMediaAssetRelation',
                postId,
                mediaId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to create post media relation', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async createPostTargets(targets: PostTarget[]): Promise<void> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            this.logger.info('Starting post targets creation', {
                operation: 'createPostTargets',
                targetCount: targets.length,
            })

            for (const target of targets) {
                this.logger.debug('Persisting post target', {
                    operation: 'createPostTargets',
                    postId: target.postId,
                    socialAccountId: target.socialAccountId,
                    platform: target.platform,
                })

                await client.query(
                    `
                    INSERT INTO post_targets (
                        post_id,
                        social_account_id,
                        platform,
                    text,
                    title,
                    pinterest_board_id,
                    tags,
                    links,
                    is_auto_music_enabled,
                    instagram_location_id,
                    instagram_facebook_page_id,
                    threads_replies,
                    tik_tok_post_privacy_level
                )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    `,
                    [
                        target.postId,
                        target.socialAccountId,
                        target.platform,
                        target.text,
                        target.title || null,
                        target.pinterestBoardId || null,
                        target.tags || [],
                        target.links || [],
                        target.isAutoMusicEnabled ?? false,
                        target.instagramLocationId || null,
                        target.instagramFacebookPageId || null,
                        JSON.stringify(target.threadsReplies || []),
                        target.tikTokPostPrivacyLevel || null,
                    ]
                )
            }

            await client.query('COMMIT')

            this.logger.info('Post targets created successfully', {
                operation: 'createPostTargets',
                targetCount: targets.length,
            })
        } catch (error) {
            await client.query('ROLLBACK')
            this.logger.error('Failed to create post targets', {
                operation: 'createPostTargets',
                targets,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to create post targets', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getPostDetails(postId: string, userId: string): Promise<CreatePostResponse> {
        const client = await this.client.connect()

        try {
            // Get base post details
            const postQuery = `
                SELECT p.id,
                       p.status,
                       p.created_at,
                       p.scheduled_time,
                       p.main_caption,
                       p.cover_timestamp,
                       p.cover_image_url,
                       COALESCE(p.type, CASE WHEN EXISTS (SELECT 1 FROM post_media_assets pma WHERE pma.post_id = p.id) THEN 'media'::text ELSE 'text'::text END) AS type
                FROM posts p
                WHERE p.id = $1 AND p.tenant_id = $2
            `
            const postResult = await client.query(postQuery, [postId.trim(), userId.trim()])

            if (postResult.rows.length === 0) throw new BaseAppError('Post not found', ErrorCode.NOT_FOUND, 404)

            // Get media details if exists
            const mediaQuery = `
                SELECT ma.url, ma.type
                FROM media_assets ma
                JOIN post_media_assets pma ON pma.media_asset_id = ma.id
                WHERE pma.post_id = $1
                ORDER BY pma."order"
                LIMIT 1
            `
            const mediaResult = await client.query(mediaQuery, [postId])

            // Get targets
            const targetsQuery = `
                SELECT 
                    pt.platform, 
                    pt.status, 
                    pt.social_account_id, 
                    pt.title, 
                    pt.text, 
                    pt.pinterest_board_id, 
                    pt.tags, 
                    pt.links, 
                    pt.is_auto_music_enabled,
                    pt.instagram_location_id,
                    pt.instagram_facebook_page_id,
                    pt.threads_replies,
                    pt.tik_tok_post_privacy_level
                FROM post_targets pt
                WHERE pt.post_id = $1
            `
            const targetsResult = await client.query(targetsQuery, [postId])

            return {
                postId: postResult.rows[0].id,
                type: postResult.rows[0].type as PostType,
                status: postResult.rows[0].status as PostStatus,
                scheduledTime: postResult.rows[0].scheduled_time,
                createdAt: postResult.rows[0].created_at,
                mainCaption: postResult.rows[0].main_caption,
                coverTimestamp: postResult.rows[0].cover_timestamp,
                coverImageUrl: postResult.rows[0].cover_image_url,
                targets: targetsResult.rows.map((row) => ({
                    platform: row.platform,
                    status: row.status,
                    socialAccountId: row.social_account_id,
                    title: row.title || undefined,
                    text: row.text,
                    pinterestBoardId: row.pinterest_board_id,
                    tags: row.tags || [],
                    links: row.links || [],
                    isAutoMusicEnabled: row.is_auto_music_enabled,
                    instagramLocationId: row.instagram_location_id || undefined,
                    instagramFacebookPageId: row.instagram_facebook_page_id || undefined,
                    threadsReplies: row.threads_replies || [],
                    tikTokPostPrivacyLevel: row.tik_tok_post_privacy_level || undefined,
                })),
                ...(mediaResult.rows.length > 0 && {
                    media: {
                        url: mediaResult.rows[0].url,
                        type: mediaResult.rows[0].type,
                    },
                }),
            }
        } catch (error) {
            this.logger.error('Failed to get post details', {
                operation: 'getPostDetails',
                postId,
                userId,
                error: {
                    name: error instanceof Error ? error.name : 'Unknown',
                    code: error instanceof BaseAppError ? error.code : 'UNKNOWN_ERROR',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })

            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError('Failed to get post details', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getPosts(tenantId: string, filters: PostFilters): Promise<PostsListResponse> {
        const client = await this.client.connect()
        const page = filters.page || 1
        const limit = filters.limit || 9
        const offset = (page - 1) * limit

        try {
            // Build WHERE conditions
            const whereConditions: string[] = ['p.tenant_id = $1']
            const queryParams: any[] = [tenantId]
            let paramCount = 1

            if (filters.status) {
                paramCount++
                whereConditions.push(`p.status = $${paramCount}`)
                queryParams.push(filters.status)
            }

            if (filters.fromDate) {
                paramCount++
                whereConditions.push(`p.created_at >= $${paramCount}::timestamp with time zone`)
                queryParams.push(filters.fromDate)
            }

            if (filters.toDate) {
                paramCount++
                whereConditions.push(`p.created_at <= $${paramCount}::timestamp with time zone`)
                queryParams.push(filters.toDate)
            }

            if (filters.platform) {
                paramCount++
                whereConditions.push(`EXISTS (
                    SELECT 1 FROM post_targets pt_filter 
                    WHERE pt_filter.post_id = p.id 
                    AND LOWER(pt_filter.platform) = LOWER($${paramCount})
                )`)
                queryParams.push(filters.platform)
            }

            // Add pagination parameters
            queryParams.push(limit, offset)

            const query = `
                SELECT
                    COUNT(*) OVER() as total_count,
                    p.id,
                    p.status,
                    p.scheduled_time,
                    p.created_at,
                    p.main_caption,
                    COALESCE(
                        p.type,
                        CASE 
                            WHEN EXISTS (
                                SELECT 1 FROM post_media_assets pma 
                                WHERE pma.post_id = p.id
                            ) THEN 'media'::text 
                            ELSE 'text'::text 
                        END
                    ) as type,
                    COALESCE(
                        JSON_AGG(DISTINCT jsonb_build_object(
                            'url', ma.url,
                            'type', ma.type,
                            'order', pma."order"
                        )) FILTER (WHERE ma.id IS NOT NULL), '[]'
                    ) AS media,
                    COALESCE(
                        JSON_AGG(DISTINCT jsonb_build_object(
                            'social_account_id', pt.social_account_id,
                            'platform', pt.platform,
                            'status', pt.status,
                            'title', pt.title,
                            'text', pt.text,
                            'tags', pt.tags,
                            'links', pt.links,
                            'is_auto_music_enabled', pt.is_auto_music_enabled,
                            'instagram_location_id', pt.instagram_location_id,
                            'instagram_facebook_page_id', pt.instagram_facebook_page_id,
                            'threads_replies', pt.threads_replies,
                            'tik_tok_post_privacy_level', pt.tik_tok_post_privacy_level
                        )) FILTER (WHERE pt.social_account_id IS NOT NULL), '[]'
                    ) AS targets
                FROM posts p
                LEFT JOIN post_media_assets pma ON p.id = pma.post_id
                LEFT JOIN media_assets ma ON pma.media_asset_id = ma.id
                LEFT JOIN post_targets pt ON p.id = pt.post_id
                WHERE ${whereConditions.join(' AND ')}
                GROUP BY p.id, p.status, p.scheduled_time, p.created_at, p.main_caption
				ORDER BY p.scheduled_time desc
                LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
            `

            const result = await client.query(query, queryParams)
            const total = parseInt(result.rows[0]?.total_count || '0')

            if (result.rows.length === 0) {
                return {
                    posts: [],
                    total,
                    page,
                    limit,
                    hasMore: false,
                }
            }

            const posts = result.rows.map((row) => ({
                postId: row.id,
                type: row.type as PostType,
                status: row.status as PostStatus,
                scheduledTime: row.scheduled_time,
                createdAt: row.created_at,
                targets: row.targets.map((target: any) => ({
                    platform: target.platform,
                    status: target.status,
                    socialAccountId: target.social_account_id,
                    title: target.title || undefined,
                    text: target.text,
                    links: target.links,
                    tags: target.tags,
                    isAutoMusicEnabled: target.is_auto_music_enabled,
                    instagramLocationId: target.instagram_location_id || undefined,
                    instagramFacebookPageId: target.instagram_facebook_page_id || undefined,
                    threadsReplies: target.threads_replies || [],
                    tikTokPostPrivacyLevel: target.tik_tok_post_privacy_level || undefined,
                })),
                media: row.media.map((media: any) => ({
                    url: media.url,
                    type: media.type,
                    order: media.order,
                })),
                ...(row.main_caption && { mainCaption: row.main_caption }),
            }))

            return {
                posts,
                total,
                page,
                limit,
                hasMore: total > page * limit,
            }
        } catch (error) {
            this.logger.error('Failed to get posts', {
                operation: 'getPosts',
                tenantId,
                filters,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })

            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError('Failed to get posts', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async updateBasePost(
        postId: string,
        userId: string,
        status: PostStatus,
        scheduledTime: Date | null,
        mainCaption?: string
    ): Promise<void> {
        const client = await this.client.connect()
        try {
            if (!mainCaption) {
                await client.query(
                    `
                    UPDATE posts 
                    SET status = $1, 
                        scheduled_time = $2, 
                        updated_at = NOW()
                    WHERE id = $3 AND tenant_id = $4
                    `,
                    [status, scheduledTime, postId, userId]
                )
            } else {
                await client.query(
                    `
                    UPDATE posts 
                    SET status = $1, 
                        scheduled_time = $2, 
                        main_caption = $3,
                        updated_at = NOW()
                    WHERE id = $4 AND tenant_id = $5
                    `,
                    [status, scheduledTime, mainCaption, postId, userId]
                )
            }
        } catch (error) {
            this.logger.error('Failed to update base post', {
                operation: 'updateBasePost',
                postId,
                userId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to update post', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getPostMediaAsset(postId: string): Promise<{ mediaId: string; url: string; type: string } | null> {
        const client = await this.client.connect()
        try {
            const result = await client.query(
                `
                SELECT ma.id as media_id, ma.url, ma.type
                FROM media_assets ma
                JOIN post_media_assets pma ON ma.id = pma.media_asset_id
                WHERE pma.post_id = $1
                LIMIT 1
                `,
                [postId]
            )

            if (result.rows.length === 0) {
                return null
            }

            return {
                mediaId: result.rows[0].media_id,
                url: result.rows[0].url,
                type: result.rows[0].type,
            }
        } catch (error) {
            this.logger.error('Failed to get post media asset', {
                operation: 'getPostMediaAsset',
                postId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to get post media', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getPostMediaAssets(
        postId: string
    ): Promise<{ mediaId: string; url: string; type: string; orderIndex: number }[]> {
        const client = await this.client.connect()
        try {
            const result = await client.query(
                `
                SELECT ma.id as media_id, ma.url, ma.type, pma."order" as order_index
                FROM media_assets ma
                JOIN post_media_assets pma ON ma.id = pma.media_asset_id
                WHERE pma.post_id = $1
                ORDER BY pma."order" ASC
                `,
                [postId]
            )

            return result.rows.map((row) => ({
                mediaId: row.media_id,
                url: row.url,
                type: row.type,
                orderIndex: row.order_index,
            }))
        } catch (error) {
            this.logger.error('Failed to get post media assets', {
                operation: 'getPostMediaAssets',
                postId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to get post media assets', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getPostCoverImageUrl(postId: string): Promise<string | null> {
        const client = await this.client.connect()
        try {
            const result = await client.query(`SELECT cover_image_url FROM posts WHERE id = $1`, [postId])

            return result.rows[0]?.cover_image_url || null
        } catch (error) {
            this.logger.error('Failed to get post cover image URL', {
                operation: 'getPostCoverImageUrl',
                postId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to get post cover image URL', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async deletePostMediaAsset(mediaId: string): Promise<void> {
        const client = await this.client.connect()
        try {
            // First delete the relation
            await client.query('DELETE FROM post_media_assets WHERE media_asset_id = $1', [mediaId])
            // Then delete the media asset itself
            await client.query('DELETE FROM media_assets WHERE id = $1', [mediaId])
        } catch (error) {
            this.logger.error('Failed to delete post media asset', {
                operation: 'deletePostMediaAsset',
                mediaId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to delete post media', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async updatePostTargets(postId: string, targets: PostTarget[]): Promise<void> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            // Delete existing targets
            await client.query('DELETE FROM post_targets WHERE post_id = $1', [postId])

            // Insert new targets
            for (const target of targets) {
                await client.query(
                    `
                    INSERT INTO post_targets (
                        post_id, 
                        social_account_id, 
                        platform,
                        text,
                        title,
                        status,
                        pinterest_board_id,
                        tags,
                        links,
                        is_auto_music_enabled,
                        instagram_location_id,
                        instagram_facebook_page_id,
                        threads_replies
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    `,
                    [
                        postId,
                        target.socialAccountId,
                        target.platform,
                        target.text,
                        target.title || null,
                        'PENDING', // Default status for new targets
                        target.pinterestBoardId || null,
                        target.tags || [],
                        target.links || [],
                        target.isAutoMusicEnabled ?? false,
                        target.instagramLocationId || null,
                        target.instagramFacebookPageId || null,
                        JSON.stringify(target.threadsReplies || []),
                    ]
                )
            }

            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK')
            this.logger.error('Failed to update post targets', {
                operation: 'updatePostTargets',
                postId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to update post targets', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async hasExistingMedia(postId: string): Promise<boolean> {
        const client = await this.client.connect()
        try {
            const result = await client.query(
                `
                SELECT EXISTS (
                    SELECT 1 FROM post_media_assets pma 
                    WHERE pma.post_id = $1
                ) as has_media
                `,
                [postId]
            )

            return result.rows[0].has_media
        } catch (error) {
            this.logger.error('Failed to check existing media', {
                operation: 'hasExistingMedia',
                postId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })
            throw new BaseAppError('Failed to check existing media', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getPostsTargetedOnlyByAccount(tenantId: string, accountId: string): Promise<string[]> {
        const client = await this.client.connect()

        try {
            const result = await client.query(
                `
                SELECT pt.post_id
                FROM post_targets pt
                JOIN posts p ON p.id = pt.post_id
                WHERE p.tenant_id = $1
                GROUP BY pt.post_id
                HAVING BOOL_OR(pt.social_account_id = $2) AND COUNT(DISTINCT pt.social_account_id) = 1
                `,
                [tenantId, accountId]
            )

            return result.rows.map((row) => row.post_id)
        } catch (error) {
            this.logger.error('Failed to get posts targeted only by account', {
                operation: 'getPostsTargetedOnlyByAccount',
                tenantId,
                accountId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })

            throw new BaseAppError('Failed to get posts targeted only by account', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async deletePost(postId: string, tenantId: string): Promise<{ mediaUrls: string[]; coverImageUrl?: string }> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            // First, get the post to retrieve cover image URL
            const postQuery = `SELECT cover_image_url FROM posts WHERE id = $1 AND tenant_id = $2`
            const postResult = await client.query(postQuery, [postId, tenantId])

            if (postResult.rowCount === 0) {
                throw new BaseAppError('Post not found or access denied', ErrorCode.NOT_FOUND, 404)
            }

            const coverImageUrl = postResult.rows[0].cover_image_url

            // Get media assets to delete from S3
            const mediaQuery = `
                SELECT ma.id, ma.url
                FROM media_assets ma
                JOIN post_media_assets pma ON ma.id = pma.media_asset_id
                WHERE pma.post_id = $1
            `
            const mediaResult = await client.query(mediaQuery, [postId])

            // Delete post_media_assets relations
            await client.query('DELETE FROM post_media_assets WHERE post_id = $1', [postId])

            // Delete post_targets
            await client.query('DELETE FROM post_targets WHERE post_id = $1', [postId])

            // Delete media_assets (this will cascade to post_media_assets if any remain)
            if (mediaResult.rows.length > 0) {
                const mediaIds = mediaResult.rows.map((row) => row.id)
                await client.query('DELETE FROM media_assets WHERE id = ANY($1)', [mediaIds])
            }

            // Finally, delete the post itself
            await client.query('DELETE FROM posts WHERE id = $1 AND tenant_id = $2', [postId, tenantId])

            await client.query('COMMIT')

            // Return media URLs and cover image URL for S3 cleanup
            return {
                mediaUrls: mediaResult.rows.map((row) => row.url),
                coverImageUrl: coverImageUrl || undefined,
            }
        } catch (error) {
            await client.query('ROLLBACK')
            this.logger.error('Failed to delete post', {
                operation: 'deletePost',
                postId,
                tenantId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })

            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError('Failed to delete post', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getPostsByDate(tenantId: string, fromDate: Date, toDate: Date): Promise<PostsByDateResponse> {
        const client = await this.client.connect()

        try {
            await client.query('BEGIN')

            const result = await client.query(
                `
                SELECT
                    p.id,
                    p.status,
                    p.scheduled_time,
                    p.created_at,
                    p.main_caption,
                    COALESCE(
                        p.type,
                        CASE 
                            WHEN EXISTS (
                                SELECT 1 FROM post_media_assets pma 
                                WHERE pma.post_id = p.id
                            ) THEN 'media'::text 
                            ELSE 'text'::text 
                        END
                    ) as type,
                    COALESCE(
                        JSON_AGG(DISTINCT jsonb_build_object(
                            'url', ma.url,
                            'type', ma.type,
                            'order', pma."order"
                        )) FILTER (WHERE ma.id IS NOT NULL), '[]'
                    ) AS media,
                    COALESCE(
                        JSON_AGG(DISTINCT jsonb_build_object(
                            'social_account_id', pt.social_account_id,
                            'platform', pt.platform,
                            'status', pt.status,
                            'title', pt.title,
                            'text', pt.text,
                            'tags', pt.tags,
                            'links', pt.links,
                            'is_auto_music_enabled', pt.is_auto_music_enabled,
                            'instagram_location_id', pt.instagram_location_id,
                            'instagram_facebook_page_id', pt.instagram_facebook_page_id,
                            'threads_replies', pt.threads_replies,
                            'tik_tok_post_privacy_level', pt.tik_tok_post_privacy_level
                        )) FILTER (WHERE pt.social_account_id IS NOT NULL), '[]'
                    ) AS targets
                FROM posts p
                LEFT JOIN post_media_assets pma ON p.id = pma.post_id
                LEFT JOIN media_assets ma ON pma.media_asset_id = ma.id
                LEFT JOIN post_targets pt ON p.id = pt.post_id
                WHERE p.tenant_id = $1 AND p.created_at >= $2 AND p.created_at <= $3 AND p.status <> 'DRAFT'
                GROUP BY p.id, p.tenant_id, p.status, p.scheduled_time, p.created_at, p.main_caption
                ORDER BY p.created_at DESC
                `,
                [tenantId, fromDate, toDate]
            )

            await client.query('COMMIT')

            const posts = result.rows.map((row) => ({
                postId: row.id,
                type: row.type as PostType,
                status: row.status as PostStatus,
                scheduledTime: row.scheduled_time,
                createdAt: row.created_at,
                targets: row.targets.map((target: any) => ({
                    platform: target.platform,
                    status: target.status,
                    socialAccountId: target.social_account_id,
                    title: target.title || undefined,
                    text: target.text,
                    tags: target.tags,
                    links: target.links,
                    isAutoMusicEnabled: target.is_auto_music_enabled,
                    instagramLocationId: target.instagram_location_id || undefined,
                    instagramFacebookPageId: target.instagram_facebook_page_id || undefined,
                    threadsReplies: target.threads_replies || [],
                    tikTokPostPrivacyLevel: target.tik_tok_post_privacy_level || undefined,
                })),
                media: row.media.map((media: any) => ({
                    url: media.url,
                    type: media.type,
                    order: media.order,
                })),
                ...(row.main_caption && { mainCaption: row.main_caption }),
            }))

            return {
                posts,
            }
        } catch (error) {
            await client.query('ROLLBACK')
            this.logger.error('Failed to get posts by date', {
                operation: 'getPostsByDate',
                fromDate,
                toDate,
            })
            throw new BaseAppError('Failed to get posts by date', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async updatePostTarget(
        userId: string,
        postId: string,
        socialAccountId: string,
        status: PostStatus,
        errorMessage?: string
    ): Promise<void> {
        const client = await this.client.connect()

        try {
            await client.query('BEGIN')

            const query = `
                UPDATE post_targets
                SET 
                    status = $1,
                    error_message = $2
                WHERE post_id = $3 
                AND social_account_id = $4
            `

            const result = await client.query(query, [status, errorMessage || null, postId, socialAccountId])

            if (result.rowCount === 0) {
                throw new BaseAppError('Post target not found or access denied', ErrorCode.NOT_FOUND, 404)
            }

            await client.query('COMMIT')
        } catch (error) {
            await client.query('ROLLBACK')

            this.logger.error('Failed to update post target', {
                operation: 'updatePostTarget',
                userId,
                postId,
                socialAccountId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })

            if (error instanceof BaseAppError) {
                throw error
            }
            throw new BaseAppError('Failed to update post target', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getPostsFailedCount(userId: string): Promise<number> {
        const client = await this.client.connect()

        try {
            await client.query('BEGIN')

            const query = `      
                SELECT COUNT(*) AS failed_rows
                FROM post_targets pt
                JOIN posts p ON p.id = pt.post_id
                WHERE p.tenant_id = $1
                AND pt.status = 'FAILED' LIMIT 100
            `

            const res = await client.query(query, [userId])
            const failedCount = Number(res.rows[0].failed_rows)

            return failedCount
        } catch (error: unknown) {
            await client.query('ROLLBACK')

            this.logger.error('Failed to get failed posts count', {
                operation: 'getPostsFailedCount',
                userId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })

            throw new BaseAppError('Failed to get failed posts count', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async retryPostTarget(
        userId: string,
        postId: string,
        socialAccountId: string
    ): Promise<{ postTarget: PostTargetResponse; post: CreatePostResponse }> {
        const client = await this.client.connect()

        try {
            await client.query('BEGIN')

            // First, verify the post target exists, belongs to the user, and is in FAILED status
            const targetQuery = `
                SELECT 
                    pt.post_id,
                    pt.social_account_id,
                    pt.platform,
                    pt.status,
                    pt.text,
                    pt.title,
                    pt.pinterest_board_id,
                    pt.tags,
                    pt.links,
                    p.tenant_id
                FROM post_targets pt
                JOIN posts p ON pt.post_id = p.id
                WHERE pt.post_id = $1 
                AND pt.social_account_id = $2
                AND p.tenant_id = $3
                AND pt.status = 'FAILED'
            `

            const targetResult = await client.query(targetQuery, [postId, socialAccountId, userId])

            if (targetResult.rowCount === 0) {
                throw new BaseAppError(
                    'Post target not found, not in FAILED status, or access denied',
                    ErrorCode.NOT_FOUND,
                    404
                )
            }

            // Update the target status to PENDING for retry
            await client.query(
                'UPDATE post_targets SET status = $1, error_message = NULL WHERE post_id = $2 AND social_account_id = $3',
                ['PENDING', postId, socialAccountId]
            )

            await client.query('COMMIT')

            // Get the full post details for return
            const postDetails = await this.getPostDetails(postId, userId)

            // Find the specific target that was retried
            const retriedTarget = postDetails.targets.find((target) => target.socialAccountId === socialAccountId)

            if (!retriedTarget) {
                throw new BaseAppError('Failed to retrieve retried target', ErrorCode.UNKNOWN_ERROR, 500)
            }

            return {
                postTarget: retriedTarget,
                post: postDetails,
            }
        } catch (error) {
            await client.query('ROLLBACK')

            this.logger.error('Failed to retry post target', {
                operation: 'retryPostTarget',
                userId,
                postId,
                socialAccountId,
                error:
                    error instanceof Error
                        ? {
                              name: error.name,
                              code: error instanceof BaseAppError ? error.code : undefined,
                              stack: error.stack,
                          }
                        : undefined,
            })

            if (error instanceof BaseAppError) {
                throw error
            }

            throw new BaseAppError('Failed to retry post target', ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            client.release()
        }
    }

    async getFailedPostTargets(userId: string): Promise<PostTargetEntity[]> {
        const client = await this.client.connect()
        try {
            await client.query('BEGIN')

            const query = `  
                        SELECT DISTINCT pt.*, p.tenant_id
                        FROM post_targets pt
                        JOIN posts p ON pt.post_id = p.id
                        WHERE p.tenant_id = $1 AND pt.status = 'FAILED'
            `

            const result = await client.query(query, [userId])

            return result.rows.map(
                (row) =>
                    new PostTargetEntity(
                        row.post_id,
                        row.social_account_id,
                        row.platform,
                        row.status,
                        row.error_message,
                        row.text,
                        row.title,
                        row.pinterest_board_id,
                        row.tenant_id
                    )
            )
        } catch (error: unknown) {
            await client.query('ROLLBACK')
            throw error
        } finally {
            client.release()
        }
    }
}
