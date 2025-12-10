import { Pool, PoolConfig } from 'pg'
import dotenv from 'dotenv'

dotenv.config()

let client: Pool

const buildPoolConfig = (): PoolConfig => {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL
    if (connectionString) {
        const sslRequired = connectionString.includes('sslmode=require')

        return {
            connectionString,
            ...(sslRequired ? { ssl: { rejectUnauthorized: false } } : {}),
        }
    }

    return {
        host: process.env.DB_HOST,
        port: parseInt(`${process.env.DB_PORT || 5432}`, 10),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    }
}

const logConnectionTarget = (config: PoolConfig): void => {
    if (config.connectionString) {
        try {
            const url = new URL(config.connectionString)

            console.log('PostgreSQL target:', {
                host: url.hostname,
                port: url.port || 5432,
                database: url.pathname.replace(/^\//, ''),
                ssl: config.ssl ? 'enabled' : 'disabled',
                user: url.username ? '***SET***' : 'NOT SET',
            })
        } catch {
            console.log('PostgreSQL target: connection string provided')
        }

        return
    }

    console.log('PostgreSQL target:', {
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password ? '***SET***' : 'NOT SET',
    })
}

export const pgClient = (): Pool => {
    if (!client) {
        const poolConfig = buildPoolConfig()
        logConnectionTarget(poolConfig)
        client = new Pool(poolConfig)

        console.log('PostgreSQL connected!')
    }
    return client
}
