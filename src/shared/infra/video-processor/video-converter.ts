import { ILogger } from '../logger/logger.interface'
import { BaseAppError } from '../../errors/base-error'
import { ErrorCode } from '../../consts/error-codes.const'
import ffmpeg from 'fluent-ffmpeg'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { join } from 'path'
import { mkdir, unlink } from 'fs/promises'
import { createWriteStream } from 'fs'
import { randomUUID } from 'crypto'

export interface VideoConversionOptions {
    targetFormat: 'mp4' | 'webm'
    quality?: 'high' | 'medium' | 'low'
    maxFileSize?: number // in bytes
    platform?: 'instagram' | 'tiktok' | 'facebook' | 'threads'
    videoType?: 'reel' | 'post' | 'story' // for Instagram
}

export class VideoConverter {
    private logger: ILogger
    private readonly TEMP_DIR = join(process.cwd(), 'temp', 'video-converter')

    // Platform-specific video requirements
    private readonly PLATFORM_REQUIREMENTS = {
        instagram: {
            reel: { aspectRatio: '9:16', maxDuration: 90, maxFileSize: 100 * 1024 * 1024 },
            post: { aspectRatio: '1:1', maxDuration: 60, maxFileSize: 100 * 1024 * 1024 },
            story: { aspectRatio: '9:16', maxDuration: 15, maxFileSize: 100 * 1024 * 1024 },
        },
        tiktok: {
            aspectRatio: '9:16',
            maxDuration: 180,
            maxFileSize: 500 * 1024 * 1024,
        },
        facebook: {
            aspectRatio: '16:9',
            maxDuration: 240,
            maxFileSize: 1000 * 1024 * 1024,
        },
        threads: {
            aspectRatio: '16:9',
            maxDuration: 30,
            maxFileSize: 100 * 1024 * 1024,
        },
    }

    constructor(logger: ILogger) {
        this.logger = logger
        this.ensureTempDir()
    }

    private async ensureTempDir(): Promise<void> {
        try {
            await mkdir(this.TEMP_DIR, { recursive: true })
        } catch (error) {
            this.logger.error('Failed to create temp directory')
        }
    }

    async convertVideo(
        videoBuffer: Buffer,
        options: VideoConversionOptions = { targetFormat: 'mp4', quality: 'medium' }
    ): Promise<Buffer> {
        const tempDir = join(this.TEMP_DIR, randomUUID())
        await mkdir(tempDir, { recursive: true })

        const inputPath = join(tempDir, 'input.mov')
        const outputPath = join(tempDir, `output.${options.targetFormat}`)

        try {
            // Write input video to file
            await this.writeBufferToFile(videoBuffer, inputPath)

            // Convert video using FFmpeg
            await this.convertVideoFile(inputPath, outputPath, options)

            // Read converted video
            const convertedBuffer = await this.readFileToBuffer(outputPath)

            this.logger.info('Video conversion completed', {
                operation: 'convertVideo',
                originalSize: videoBuffer.length,
                convertedSize: convertedBuffer.length,
                targetFormat: options.targetFormat,
                quality: options.quality,
            })

            return convertedBuffer
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error'
            this.logger.error('Video conversion failed', {
                operation: 'convertVideo',
                error: { name: 'VideoConversionError', stack: errorMessage },
            })
            throw new BaseAppError(`Video conversion failed: ${errorMessage}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            // Cleanup temp files
            try {
                await unlink(inputPath)
                await unlink(outputPath)
                await this.removeDirectory(tempDir)
            } catch (cleanupError) {
                const cleanupErrorMessage = cleanupError instanceof Error ? cleanupError.message : 'Unknown error'
                this.logger.warn('Failed to cleanup temp files', {
                    operation: 'convertVideo',
                    error: { name: 'CleanupError', stack: cleanupErrorMessage },
                })
            }
        }
    }

    private async convertVideoFile(
        inputPath: string,
        outputPath: string,
        options: VideoConversionOptions
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            let command = ffmpeg(inputPath)

            // Set output format
            command = command.format(options.targetFormat)

            // Handle platform-specific processing
            if (options.platform) {
                const requirements = this.getPlatformRequirements(options.platform, options.videoType)
                const { width, height } = this.parseAspectToWH(requirements.aspectRatio, 1080)

                // Add padding to fit platform aspect ratio
                command = command
                    .complexFilter([
                        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p[outv]`,
                    ])
                    .outputOptions(['-map [outv]', '-map 0:a?'])
            }

            // Set quality based on options
            switch (options.quality) {
                case 'high':
                    command = command.videoCodec('libx264').addOption('-crf', '18')
                    break
                case 'medium':
                    command = command.videoCodec('libx264').addOption('-crf', '23')
                    break
                case 'low':
                    command = command.videoCodec('libx264').addOption('-crf', '28')
                    break
            }

            // Add audio codec
            command = command.audioCodec('aac')

            // Set file size limit if specified
            if (options.maxFileSize) {
                const maxSizeMB = Math.floor(options.maxFileSize / (1024 * 1024))
                command = command.addOption('-fs', `${maxSizeMB}M`)
            }

            // Add other optimization options
            command = command
                .addOption('-movflags', '+faststart') // Optimize for streaming
                .addOption('-preset', 'fast') // Faster encoding
                .addOption('-profile:v', 'high') // H.264 high profile
                .addOption('-level', '4.0') // H.264 level 4.0

            command
                .on('start', (commandLine) => {
                    this.logger.debug('FFmpeg conversion started', {
                        operation: 'convertVideoFile',
                        command: commandLine,
                    })
                })
                .on('progress', (progress) => {
                    this.logger.debug('FFmpeg conversion progress', {
                        operation: 'convertVideoFile',
                        percent: progress.percent,
                        timemark: progress.timemark,
                    })
                })
                .on('end', () => {
                    this.logger.info('FFmpeg conversion completed', {
                        operation: 'convertVideoFile',
                        inputPath,
                        outputPath,
                    })
                    resolve()
                })
                .on('error', (error) => {
                    this.logger.error('FFmpeg conversion failed', {
                        operation: 'convertVideoFile',
                        error: { name: 'FFmpegError', stack: error.message },
                        inputPath,
                        outputPath,
                    })
                    reject(new Error(error.message))
                })
                .save(outputPath)
        })
    }

    private async writeBufferToFile(buffer: Buffer, filePath: string): Promise<void> {
        const stream = new Readable()
        stream.push(buffer)
        stream.push(null)

        const writeStream = createWriteStream(filePath)
        await pipeline(stream, writeStream)
    }

    private async readFileToBuffer(filePath: string): Promise<Buffer> {
        const fs = require('fs')
        return fs.promises.readFile(filePath)
    }

    private async removeDirectory(dirPath: string): Promise<void> {
        const fs = require('fs')
        await fs.promises.rmdir(dirPath, { recursive: true })
    }

    /**
     * Check if a video needs conversion based on its MIME type
     */
    needsConversion(mimeType: string, targetFormat: string = 'mp4'): boolean {
        if (targetFormat === 'mp4') {
            return mimeType !== 'video/mp4'
        }
        if (targetFormat === 'webm') {
            return mimeType !== 'video/webm'
        }
        return false
    }

    /**
     * Get the appropriate MIME type for a target format
     */
    getMimeTypeForFormat(format: string): string {
        switch (format) {
            case 'mp4':
                return 'video/mp4'
            case 'webm':
                return 'video/webm'
            default:
                return 'video/mp4'
        }
    }

    private getPlatformRequirements(
        platform: 'instagram' | 'tiktok' | 'facebook' | 'threads',
        videoType?: 'reel' | 'post' | 'story'
    ): any {
        if (platform === 'instagram' && videoType) {
            return this.PLATFORM_REQUIREMENTS.instagram[videoType]
        }
        return this.PLATFORM_REQUIREMENTS[platform]
    }

    private parseAspectToWH(aspectRatio: string, baseWidth: number): { width: number; height: number } {
        const [w, h] = aspectRatio.split(':').map(Number)
        const height = Math.round((baseWidth * h) / w)
        return { width: baseWidth, height }
    }
}
