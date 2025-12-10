import {
    IVideoProcessor,
    VideoFilter,
    InstagramVideoRequirements,
    VideoProcessingOptions,
} from './video-processor.interface'
import { ILogger } from '../logger/logger.interface'
import { BaseAppError } from '../../errors/base-error'
import { ErrorCode } from '../../consts/error-codes.const'
import ffmpeg = require('fluent-ffmpeg')
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { join } from 'path'
import { createWriteStream } from 'fs'
import { mkdir, unlink, rm, readFile } from 'fs/promises'
import axios from 'axios'

export class VideoProcessor implements IVideoProcessor {
    private logger: ILogger
    private readonly TIKTOK_ASPECT_RATIO = '9:16' // preferred aspect ratio
    private readonly TEMP_DIR = join(process.cwd(), 'temp', 'video-processor')

    // Platform-specific video requirements
    private readonly PLATFORM_REQUIREMENTS = {
        instagram: {
            reel: { aspectRatio: '9:16', maxDuration: 90, maxFileSize: 100 * 1024 * 1024, supportedFormats: ['mp4'] },
            post: { aspectRatio: '1:1', maxDuration: 60, maxFileSize: 100 * 1024 * 1024, supportedFormats: ['mp4'] },
            story: { aspectRatio: '9:16', maxDuration: 15, maxFileSize: 100 * 1024 * 1024, supportedFormats: ['mp4'] },
        },
        tiktok: {
            aspectRatio: '9:16',
            maxDuration: 180,
            maxFileSize: 500 * 1024 * 1024,
            supportedFormats: ['mp4'],
        },
        facebook: {
            aspectRatio: '16:9',
            maxDuration: 240,
            maxFileSize: 1000 * 1024 * 1024,
            supportedFormats: ['mp4'],
        },
        threads: {
            aspectRatio: '16:9',
            maxDuration: 30,
            maxFileSize: 100 * 1024 * 1024,
            supportedFormats: ['mp4'],
        },
    }

    constructor(logger: ILogger) {
        this.logger = logger
        // Ensure temp directory exists
        this.ensureTempDir()
    }

    private async ensureTempDir(): Promise<void> {
        try {
            await mkdir(this.TEMP_DIR, { recursive: true })
        } catch (error) {
            this.logger.warn('Failed to create temp directory', {
                tempDir: this.TEMP_DIR,
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    code: error instanceof Error ? error.message : 'Unknown error occurred',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
        }
    }

    private async writeBufferToFile(buffer: Buffer, filePath: string): Promise<void> {
        const writeStream = createWriteStream(filePath)
        const readable = Readable.from(buffer)
        await pipeline(readable, writeStream)
    }

    private async executeFFmpegCommand(command: ffmpeg.FfmpegCommand, outputPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            command
                .output(outputPath)
                .on('start', (commandLine) => {
                    this.logger.info('FFmpeg command started', { commandLine, outputPath })
                })
                .on('progress', (progress) => {
                    this.logger.debug('FFmpeg progress', { progress })
                })
                .on('stderr', (stderrLine) => {
                    this.logger.debug('FFmpeg stderr', { stderrLine })
                })
                .on('end', () => {
                    this.logger.info('FFmpeg command completed successfully', { outputPath })
                    resolve()
                })
                .on('error', (err) => {
                    this.logger.error('FFmpeg command failed', { error: err, outputPath })
                    reject(err)
                })
                .run()
        })
    }

    private checkFFmpegAvailability(): void {
        try {
            // Check if ffmpeg is available in PATH
            const ffmpegPath = require('child_process').execSync('which ffmpeg', { encoding: 'utf8' }).trim()
            if (!ffmpegPath) {
                throw new Error('FFmpeg not found in PATH')
            }
            this.logger.info('FFmpeg found at', { ffmpegPath })
        } catch (error) {
            const errorMessage =
                'FFmpeg is not installed or not available in PATH. Please install FFmpeg: https://ffmpeg.org/download.html'
            this.logger.error(errorMessage, {
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    code: error instanceof Error ? error.message : 'Unknown error occurred',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError(errorMessage, ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    private async readFileToBuffer(filePath: string): Promise<Buffer> {
        return await readFile(filePath)
    }

    private async getVideoInfo(videoPath: string): Promise<{ duration: number }> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    reject(err)
                    return
                }

                const duration = metadata.format.duration || 0
                resolve({ duration })
            })
        })
    }

    private async cleanupTempFiles(filePaths: string[], dir?: string): Promise<void> {
        for (const filePath of filePaths) {
            try {
                await unlink(filePath)
            } catch (error) {
                this.logger.warn('Failed to cleanup temporary file', {
                    filePath,
                    error: {
                        name: error instanceof Error ? error.name : 'UnknownError',
                        code: error instanceof Error ? error.message : 'Unknown error occurred',
                        stack: error instanceof Error ? error.stack : undefined,
                    },
                })
            }
        }
        if (dir) {
            try {
                // Remove the temp directory recursively (Node 14.14+)
                await rm(dir, { recursive: true, force: true })
            } catch (error) {
                this.logger.warn('Failed to remove temporary directory', {
                    dir,
                    error: {
                        name: error instanceof Error ? error.name : 'UnknownError',
                        code: error instanceof Error ? error.message : 'Unknown error occurred',
                        stack: error instanceof Error ? error.stack : undefined,
                    },
                })
            }
        }
    }

    /**
     * Build a filter chain string from VideoFilter[] to apply to the BODY stream.
     * Each VideoFilter is turned into 'name[=k=v:...]' and chained with commas.
     */
    private buildBodyFilters(filters?: VideoFilter[]): string | undefined {
        if (!filters || filters.length === 0) return undefined
        const parts: string[] = []
        for (const f of filters) {
            if (f.options && Object.keys(f.options).length > 0) {
                const options = Object.entries(f.options)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(':')
                parts.push(`${f.name}=${options}`)
            } else {
                parts.push(f.name)
            }
        }
        return parts.join(',')
    }

    private parseAspectToWH(aspect: string, baseWidth = 1080): { width: number; height: number } {
        const [w, h] = aspect.split(':').map(Number)
        if (!w || !h) return { width: baseWidth, height: Math.round(baseWidth * (16 / 9)) }
        const width = baseWidth
        const height = Math.round((baseWidth * h) / w)
        return { width, height }
    }

    private async downloadImageFromUrl(imageUrl: string): Promise<Buffer> {
        try {
            const response = await axios.get(imageUrl, { responseType: 'arraybuffer' })
            return Buffer.from(response.data)
        } catch (error) {
            this.logger.error('Failed to download cover image from URL', {
                imageUrl,
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    code: error instanceof Error ? error.message : 'Unknown error occurred',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError('Failed to download cover image from URL', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    /**
     * Prepend a still cover image (1ms duration) and concat with the original video.
     * Output is H.264/AAC, yuv420p, faststart. Temp files and dir are always deleted.
     */
    async processVideoWithCover(videoBuffer: Buffer, coverImageUrl: string, filters?: VideoFilter[]): Promise<Buffer> {
        const coverDurationMs = 1 // 1ms cover duration as requested
        const fps = 30

        try {
            // Check FFmpeg availability first
            this.checkFFmpegAvailability()

            this.logger.info('Processing video with cover image', {
                videoSize: videoBuffer.length,
                coverImageUrl,
                filters: filters?.map((f) => f.name),
            })

            const tempDir = join(this.TEMP_DIR, `video-process-${Date.now()}`)
            await mkdir(tempDir, { recursive: true }) // ensure dir exists

            const inputVideoPath = join(tempDir, 'input-video.mp4')
            const coverImagePath = join(tempDir, 'cover-image.jpg')
            const outputVideoPath = join(tempDir, 'output-video.mp4')

            try {
                // Download cover image from URL
                const coverImageBuffer = await this.downloadImageFromUrl(coverImageUrl)

                // Write inputs
                await this.writeBufferToFile(videoBuffer, inputVideoPath)
                await this.writeBufferToFile(coverImageBuffer, coverImagePath)

                // Verify files were created
                const fs = require('fs')
                if (!fs.existsSync(inputVideoPath)) {
                    throw new Error(`Input video file was not created: ${inputVideoPath}`)
                }
                if (!fs.existsSync(coverImagePath)) {
                    throw new Error(`Cover image file was not created: ${coverImagePath}`)
                }

                this.logger.info('Input files created successfully', {
                    inputVideoPath,
                    coverImagePath,
                    inputVideoSize: fs.statSync(inputVideoPath).size,
                    coverImageSize: fs.statSync(coverImagePath).size,
                })

                // Compute target canvas by aspect ratio
                const { width, height } = this.parseAspectToWH(this.TIKTOK_ASPECT_RATIO, 1080)
                const coverDurationSec = coverDurationMs / 1000

                // FFmpeg command with 1ms cover duration
                const command = ffmpeg()
                    .input(coverImagePath)
                    .input(inputVideoPath)
                    .complexFilter([
                        // Create a video from the cover image with 1ms duration
                        `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p,fps=${fps},tpad=stop_mode=clone:stop_duration=${coverDurationSec}[cover]`,
                        // Process the main video
                        `[1:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p,fps=${fps}[main]`,
                        // Concatenate cover + main video
                        `[cover][main]concat=n=2:v=1:a=0[outv]`,
                    ])
                    .outputOptions([
                        '-map [outv]',
                        '-map 1:a?',
                        '-c:v libx264',
                        '-preset fast',
                        '-crf 23',
                        '-pix_fmt yuv420p',
                        '-c:a aac',
                        '-b:a 128k',
                        '-shortest',
                    ])

                await this.executeFFmpegCommand(command, outputVideoPath)

                const processedVideoBuffer = await this.readFileToBuffer(outputVideoPath)

                this.logger.info('Video processing completed successfully', {
                    inputSize: videoBuffer.length,
                    outputSize: processedVideoBuffer.length,
                    suggestedThumbnailTimeMs: Math.max(200, Math.floor(coverDurationMs / 2)),
                })

                return processedVideoBuffer
            } finally {
                // Always clean up files and temp dir
                await this.cleanupTempFiles([inputVideoPath, coverImagePath, outputVideoPath], tempDir)
            }
        } catch (error) {
            this.logger.error('Video processing failed', {
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    code: error instanceof Error ? error.message : 'Unknown error occurred',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError('Failed to process video with cover', ErrorCode.UNKNOWN_ERROR, 500)
        }
    }

    async processVideoForPlatform(
        videoBuffer: Buffer,
        platform: 'instagram' | 'tiktok' | 'facebook' | 'threads'
    ): Promise<Buffer> {
        const tempDir = join(this.TEMP_DIR, `platform-${Date.now()}`)
        await mkdir(tempDir, { recursive: true })

        const inputVideoPath = join(tempDir, 'input.mp4')
        const outputVideoPath = join(tempDir, 'output.mp4')

        try {
            // Write input video to file
            await this.writeBufferToFile(videoBuffer, inputVideoPath)

            // Get platform requirements
            const requirements = this.getPlatformRequirements(platform)
            const { width, height } = this.parseAspectToWH(requirements.aspectRatio, 1080)

            // Process video with padding to fit platform requirements
            const command = ffmpeg(inputVideoPath)
                .complexFilter([
                    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p,fps=30[outv]`,
                ])
                .outputOptions([
                    '-map [outv]',
                    '-map 0:a?',
                    '-c:v libx264',
                    '-preset medium', // Better quality than 'fast'
                    '-crf 23', // Better quality (lower CRF)
                    '-pix_fmt yuv420p',
                    '-c:a aac',
                    '-b:a 128k',
                    '-movflags +faststart',
                    // Instagram-specific optimizations
                    '-profile:v high',
                    '-level 4.0',
                    '-maxrate 3M', // Higher bitrate for better quality
                    '-bufsize 6M', // Higher buffer for better quality
                    '-g 30',
                    '-keyint_min 30',
                    '-sc_threshold 0',
                    '-strict -2',
                    '-avoid_negative_ts make_zero',
                    '-r 30', // Force 30fps
                ])

            await this.executeFFmpegCommand(command, outputVideoPath)

            const processedVideoBuffer = await this.readFileToBuffer(outputVideoPath)

            this.logger.info('Platform video processing completed', {
                platform,
                aspectRatio: requirements.aspectRatio,
                targetDimensions: { width, height },
                originalSize: videoBuffer.length,
                processedSize: processedVideoBuffer.length,
            })

            return processedVideoBuffer
        } catch (error) {
            this.logger.error('Platform video processing failed', {
                platform,
                error: {
                    name: error instanceof Error ? error.name : 'UnknownError',
                    code: error instanceof Error ? error.message : 'Unknown error occurred',
                    stack: error instanceof Error ? error.stack : undefined,
                },
            })
            throw new BaseAppError(`Failed to process video for ${platform}`, ErrorCode.UNKNOWN_ERROR, 500)
        } finally {
            await this.cleanupTempFiles([inputVideoPath, outputVideoPath], tempDir)
        }
    }

    private getPlatformRequirements(platform: 'instagram' | 'tiktok' | 'facebook' | 'threads'): any {
        if (platform === 'instagram') {
            // Default to reel format for Instagram
            return this.PLATFORM_REQUIREMENTS.instagram.reel
        }
        return this.PLATFORM_REQUIREMENTS[platform]
    }
}
