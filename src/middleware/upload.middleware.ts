import multer from 'multer'
import { Request } from 'express'

const MAX_FILE_SIZE_MB = 50
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024 // 50MB in bytes
const MAX_FILES = 11 // Maximum number of files allowed (10 media + 1 cover image)

const ALLOWED_MIME_TYPES: Record<string, boolean> = {
    'image/jpeg': true,
    'image/png': true,
    'image/gif': true,
    'image/webp': true,
    'video/mp4': true,
    'video/quicktime': true,
    'video/webm': true,
}

const storage = multer.memoryStorage()

export const upload = multer({
    storage,
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES, // Limit to 10 files
    },
    fileFilter: (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
        if (ALLOWED_MIME_TYPES[file.mimetype]) {
            cb(null, true)
        } else {
            cb(
                new Error(
                    `Unsupported file type: ${file.mimetype}. Allowed types: ${Object.keys(ALLOWED_MIME_TYPES).join(', ')}`
                )
            )
        }
    },
})
