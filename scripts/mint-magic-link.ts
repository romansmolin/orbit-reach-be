import 'dotenv/config'
import bcrypt from 'bcrypt'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { UserRepository } from '@/repositories/user-repository'
import { MagicLinkPromoType } from '@/repositories/user-repository/user.repository.interface'
import { ILogger } from '@/shared/infra/logger/logger.interface'

const consoleLogger: ILogger = {
    info: (message, meta) => console.log(message, meta ?? ''),
    warn: (message, meta) => console.warn(message, meta ?? ''),
    error: (message, meta) => console.error(message, meta ?? ''),
    debug: (message, meta) => console.debug(message, meta ?? ''),
}

const DAYS_MS = 24 * 60 * 60 * 1000

async function mintMagicLink(): Promise<void> {
    const promoType: MagicLinkPromoType = 'STARTER_TRIAL'
    const promoDurationDays = Number(process.env.MAGIC_LINK_PROMO_DURATION_DAYS || 30)
    const maxUses = Number(process.env.MAGIC_LINK_MAX_USES || 1)
    const expiresInDays = Number(process.env.MAGIC_LINK_EXPIRES_IN_DAYS || 7)

    const tokenId = uuidv4()
    const secret = crypto.randomBytes(32).toString('hex')
    const tokenHash = await bcrypt.hash(secret, 10)
    const expiresAt = new Date(Date.now() + expiresInDays * DAYS_MS)

    const repo = new UserRepository(consoleLogger)

    await repo.createMagicLink({
        tokenId,
        tokenHash,
        expiresAt,
        promoType,
        promoDurationDays,
        maxUses,
    })

    consoleLogger.info('Magic link created', {
        tokenId,
        promoType,
        promoDurationDays,
        maxUses,
        expiresAt,
    })

    console.log('\nProvide this magicToken to users:')
    console.log(`${tokenId}.${secret}\n`)
    console.log('Example URL:')
    console.log(`https://zapshipr.com/auth?magicToken=${tokenId}.${secret}`)
}

mintMagicLink().catch((error) => {
    console.error('Failed to mint magic link', error)
    process.exit(1)
})
