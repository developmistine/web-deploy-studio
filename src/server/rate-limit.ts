import type { Db } from '@/server/db'
import { AppError } from '@/server/http/errors'
import { raiseAlert } from '@/server/security-alerts'

/**
 * Fixed-window rate limiter backed by MySQL so it holds across web replicas.
 * Uses an atomic upsert (INSERT ... ON DUPLICATE KEY UPDATE).
 */
export async function enforceRateLimit(db: Db, key: string, limit: number, windowSeconds: number): Promise<void> {
  const windowMs = windowSeconds * 1000
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs)
  const k = key.slice(0, 191)
  await db.$executeRaw`INSERT INTO rate_limits (\`key\`, window_start, count) VALUES (${k}, ${windowStart}, 1)
    ON DUPLICATE KEY UPDATE count = count + 1`
  const rows = await db.$queryRaw<{ count: number }[]>`SELECT count FROM rate_limits WHERE \`key\` = ${k} AND window_start = ${windowStart}`
  const count = Number(rows[0]?.count ?? 0)
  if (count === limit + 1) await raiseAlert(db, 'RATE_LIMIT_EXCEEDED', { key: k.replace(/:[^:]*$/, ':*'), limit })
  if (count > limit) throw new AppError('RATE_LIMITED', { retryAfterSeconds: windowSeconds })
}

/** Current count in the window without incrementing (used to refuse logins after too many failures). */
export async function peekRateLimit(db: Db, key: string, windowSeconds: number): Promise<number> {
  const windowMs = windowSeconds * 1000
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs)
  const k = key.slice(0, 191)
  const rows = await db.$queryRaw<{ count: number }[]>`SELECT count FROM rate_limits WHERE \`key\` = ${k} AND window_start = ${windowStart}`
  return Number(rows[0]?.count ?? 0)
}

/** Housekeeping, called by the worker. */
export async function pruneRateLimits(db: Db): Promise<void> {
  await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 24 * 3600_000) } } })
}
