import sharp from 'sharp'
import { ILogger } from '../logger/logger.interface'

export interface ImageProcessingOptions {
    maxWidth?: number
    maxHeight?: number
    maxFileSize?: number // in bytes
    quality?: number
    format?: 'jpeg' | 'png' | 'webp'
    addPadding?: boolean
    backgroundColor?: string
}

export interface PlatformImageRequirements {
    facebook: ImageProcessingOptions
    tiktok: ImageProcessingOptions
    instagram: ImageProcessingOptions
    threads: ImageProcessingOptions
}

export class ImageProcessor {
    private logger: ILogger

    constructor(logger: ILogger) {
        this.logger = logger
    }

    // Platform-specific image requirements
    private readonly platformRequirements: PlatformImageRequirements = {
        facebook: {
            maxWidth: 1200,
            maxHeight: 1200,
            maxFileSize: 5 * 1024 * 1024, // 5MB
            quality: 85,
            format: 'jpeg',
            addPadding: true,
            backgroundColor: '#FFFFFF',
        },
        tiktok: {
            maxWidth: 1080,
            maxHeight: 1920,
            maxFileSize: 1024 * 1024, // 1MB
            quality: 90,
            format: 'jpeg',
            addPadding: true,
            backgroundColor: '#000000',
        },
        instagram: {
            maxWidth: 1080,
            maxHeight: 1080,
            maxFileSize: 8 * 1024 * 1024, // 8MB
            quality: 85,
            format: 'jpeg',
            addPadding: true,
            backgroundColor: '#FFFFFF',
        },
        threads: {
            maxWidth: 1200,
            maxHeight: 1200,
            maxFileSize: 5 * 1024 * 1024, // 5MB
            quality: 85,
            format: 'jpeg',
            addPadding: true,
            backgroundColor: '#FFFFFF',
        },
    }

    /**
     * Process image to meet platform requirements
     */
    async processImageForPlatform(
        imageBuffer: Buffer,
        platform: keyof PlatformImageRequirements,
        originalUrl?: string
    ): Promise<Buffer> {
        const requirements = this.platformRequirements[platform]

        try {
            this.logger.info('Processing image for platform', {
                operation: 'processImageForPlatform',
                platform,
                originalSize: imageBuffer.length,
                requirements: {
                    maxWidth: requirements.maxWidth,
                    maxHeight: requirements.maxHeight,
                    maxFileSize: requirements.maxFileSize,
                    format: requirements.format,
                },
            })

            // Get original image metadata
            const metadata = await sharp(imageBuffer).metadata()
            const originalWidth = metadata.width || 0
            const originalHeight = metadata.height || 0

            this.logger.info('Original image metadata', {
                operation: 'processImageForPlatform',
                platform,
                originalWidth,
                originalHeight,
                originalFormat: metadata.format,
                originalSize: imageBuffer.length,
            })

            // Calculate new dimensions
            const { width, height } = this.calculateDimensions(
                originalWidth,
                originalHeight,
                requirements.maxWidth!,
                requirements.maxHeight!,
                requirements.addPadding!
            )

            this.logger.info('Calculated new dimensions', {
                operation: 'processImageForPlatform',
                platform,
                originalWidth,
                originalHeight,
                newWidth: width,
                newHeight: height,
                addPadding: requirements.addPadding,
            })

            // Process the image
            let processedImage = sharp(imageBuffer)

            if (requirements.addPadding) {
                // Add padding to maintain aspect ratio
                processedImage = processedImage.resize(width, height, {
                    fit: 'contain',
                    background: requirements.backgroundColor,
                })
            } else {
                // Resize without padding (crop to fit)
                processedImage = processedImage.resize(width, height, {
                    fit: 'cover',
                })
            }

            // Convert to required format and quality
            const outputFormat = requirements.format!
            if (outputFormat === 'jpeg') {
                processedImage = processedImage.jpeg({ quality: requirements.quality })
            } else if (outputFormat === 'png') {
                processedImage = processedImage.png({ quality: requirements.quality })
            } else if (outputFormat === 'webp') {
                processedImage = processedImage.webp({ quality: requirements.quality })
            }

            const processedBuffer = await processedImage.toBuffer()
            const finalSize = processedBuffer.length

            this.logger.info('Image processing completed', {
                operation: 'processImageForPlatform',
                platform,
                originalSize: imageBuffer.length,
                finalSize,
                sizeReduction: `${Math.round((1 - finalSize / imageBuffer.length) * 100)}%`,
                withinLimits: finalSize <= requirements.maxFileSize!,
            })

            // Check if final size is within limits
            if (finalSize > requirements.maxFileSize!) {
                this.logger.warn('Processed image still too large, applying additional compression', {
                    operation: 'processImageForPlatform',
                    platform,
                    finalSize,
                    maxAllowed: requirements.maxFileSize,
                    originalUrl,
                })

                // Apply additional compression
                const compressedBuffer = await this.compressImage(processedBuffer, requirements.maxFileSize!)
                return compressedBuffer
            }

            return processedBuffer
        } catch (error) {
            this.logger.error('Image processing failed', {
                operation: 'processImageForPlatform',
                platform,
                originalUrl,
            })
            throw error
        }
    }

    /**
     * Calculate new dimensions while maintaining aspect ratio
     */
    private calculateDimensions(
        originalWidth: number,
        originalHeight: number,
        maxWidth: number,
        maxHeight: number,
        addPadding: boolean
    ): { width: number; height: number } {
        const aspectRatio = originalWidth / originalHeight
        const maxAspectRatio = maxWidth / maxHeight

        let width: number
        let height: number

        if (addPadding) {
            // Add padding to fit within bounds while maintaining aspect ratio
            if (aspectRatio > maxAspectRatio) {
                // Image is wider than target ratio
                width = maxWidth
                height = Math.round(maxWidth / aspectRatio)
            } else {
                // Image is taller than target ratio
                height = maxHeight
                width = Math.round(maxHeight * aspectRatio)
            }
        } else {
            // Crop to fit exact dimensions
            if (aspectRatio > maxAspectRatio) {
                // Image is wider, crop width
                height = maxHeight
                width = Math.round(maxHeight * aspectRatio)
            } else {
                // Image is taller, crop height
                width = maxWidth
                height = Math.round(maxWidth / aspectRatio)
            }
        }

        return { width, height }
    }

    /**
     * Compress image to meet file size requirements
     */
    private async compressImage(imageBuffer: Buffer, maxSize: number): Promise<Buffer> {
        let quality = 70
        let compressedBuffer = imageBuffer

        while (compressedBuffer.length > maxSize && quality > 10) {
            quality -= 10
            compressedBuffer = await sharp(imageBuffer).jpeg({ quality }).toBuffer()
        }

        if (compressedBuffer.length > maxSize) {
            this.logger.warn('Could not compress image to required size', {
                operation: 'compressImage',
                finalSize: compressedBuffer.length,
                maxSize,
                finalQuality: quality,
            })
        }

        return compressedBuffer
    }

    /**
     * Get platform requirements
     */
    getPlatformRequirements(platform: keyof PlatformImageRequirements): ImageProcessingOptions {
        return this.platformRequirements[platform]
    }

    /**
     * Check if image meets platform requirements
     */
    async validateImageForPlatform(
        imageBuffer: Buffer,
        platform: keyof PlatformImageRequirements
    ): Promise<{ valid: boolean; issues: string[] }> {
        const requirements = this.platformRequirements[platform]
        const issues: string[] = []

        try {
            const metadata = await sharp(imageBuffer).metadata()
            const fileSize = imageBuffer.length

            // Check file size
            if (fileSize > requirements.maxFileSize!) {
                issues.push(
                    `File too large: ${Math.round(fileSize / 1024)}KB (max ${Math.round(requirements.maxFileSize! / 1024)}KB)`
                )
            }

            // Check dimensions
            const width = metadata.width || 0
            const height = metadata.height || 0

            if (width > requirements.maxWidth!) {
                issues.push(`Width too large: ${width}px (max ${requirements.maxWidth}px)`)
            }

            if (height > requirements.maxHeight!) {
                issues.push(`Height too large: ${height}px (max ${requirements.maxHeight}px)`)
            }

            // Check format
            const format = metadata.format
            if (format && !this.isFormatSupported(format, requirements.format!)) {
                issues.push(`Unsupported format: ${format} (required: ${requirements.format})`)
            }

            return {
                valid: issues.length === 0,
                issues,
            }
        } catch (error) {
            issues.push(`Invalid image: ${error instanceof Error ? error.message : 'Unknown error'}`)
            return { valid: false, issues }
        }
    }

    /**
     * Check if format is supported
     */
    private isFormatSupported(actualFormat: string, requiredFormat: string): boolean {
        const formatMap: Record<string, string[]> = {
            jpeg: ['jpeg', 'jpg'],
            png: ['png'],
            webp: ['webp'],
        }

        return formatMap[requiredFormat]?.includes(actualFormat.toLowerCase()) || false
    }
}
