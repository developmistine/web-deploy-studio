import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaClient } from '@/generated/prisma/client'

/**
 * Builds a mariadb pool config from a mysql:// URL.
 * Supported query params: connection_limit, ssl=true (verify certs), allowPublicKeyRetrieval=true (dev only).
 */
export function poolConfigFromUrl(databaseUrl: string) {
  const u = new URL(databaseUrl)
  if (!['mysql:', 'mariadb:'].includes(u.protocol)) throw new Error('DATABASE_URL must be a mysql:// URL')
  const ssl = u.searchParams.get('ssl') === 'true'
  return {
    host: u.hostname,
    port: Number(u.port || 3306),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    connectionLimit: Number(u.searchParams.get('connection_limit') ?? 10),
    allowPublicKeyRetrieval: u.searchParams.get('allowPublicKeyRetrieval') === 'true',
    ssl: ssl ? { rejectUnauthorized: true } : undefined,
    // Keep DATETIME semantics in UTC end to end.
    timezone: 'Z',
  }
}

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL): PrismaClient {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set')
  const adapter = new PrismaMariaDb(poolConfigFromUrl(databaseUrl))
  return new PrismaClient({ adapter })
}

const globalForPrisma = globalThis as unknown as { __dsPrisma?: PrismaClient }

/** Process-wide client (survives Next.js dev hot reloads). */
export function getDb(): PrismaClient {
  globalForPrisma.__dsPrisma ??= createPrismaClient()
  return globalForPrisma.__dsPrisma
}

export type Db = PrismaClient
export type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]
