import { ILogger } from '../logger/logger.interface'

export interface IMediaUploader {
    upload(data: { key: string; body: Buffer; contentType: string }): Promise<string>
    uploadProcessedImage(
        data: { key: string; body: Buffer; contentType: string; platform?: string },
        logger: ILogger
    ): Promise<string>
    delete(url: string): Promise<void>
}
