import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { IMediaUploader } from './media-uploader.interface'
import { ImageProcessor } from './image-processor'
import { ILogger } from '../logger/logger.interface'

export class S3Uploader implements IMediaUploader {
    private client: S3Client
    private bucket: string
    private imageProcessor: ImageProcessor

    constructor(logger: ILogger) {
        this.client = new S3Client({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
            },
        })
        this.bucket = process.env.AWS_S3_BUCKET || ''
        this.imageProcessor = new ImageProcessor(logger)
    }

    async upload(data: { key: string; body: Buffer; contentType: string }): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: data.key,
            Body: data.body,
            ContentType: data.contentType,
        })

        await this.client.send(command)
        return `https://${this.bucket}.s3.amazonaws.com/${data.key}`
    }

    /**
     * Upload and process image for specific platform
     */
    async uploadProcessedImage(
        data: { key: string; body: Buffer; contentType: string; platform?: string },
        logger: ILogger
    ): Promise<string> {
        let processedBody = data.body
        let processedContentType = data.contentType

        // Process image if it's an image and platform is specified
        if (data.platform && data.contentType.startsWith('image/')) {
            try {
                const imageProcessor = new ImageProcessor(logger)
                processedBody = await imageProcessor.processImageForPlatform(data.body, data.platform as any)

                // Update content type based on processed format
                const requirements = imageProcessor.getPlatformRequirements(data.platform as any)
                processedContentType = `image/${requirements.format}`

                logger.info('Image processed for platform', {
                    operation: 'uploadProcessedImage',
                    platform: data.platform,
                    originalSize: data.body.length,
                    processedSize: processedBody.length,
                    originalContentType: data.contentType,
                    processedContentType,
                })
            } catch (error) {
                logger.warn('Image processing failed, uploading original', {
                    operation: 'uploadProcessedImage',
                    platform: data.platform,
                })
                // Continue with original image if processing fails
            }
        }

        return this.upload({
            key: data.key,
            body: processedBody,
            contentType: processedContentType,
        })
    }

    async delete(url: string): Promise<void> {
        const key = url.split('.s3.amazonaws.com/')[1]
        const command = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: key,
        })

        await this.client.send(command)
    }
}
