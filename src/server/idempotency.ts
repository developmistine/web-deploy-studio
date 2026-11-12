import type { Db } from '@/server/db'
import { Prisma } from '@/generated/prisma/client'
import { AppError } from '@/server/http/errors'

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/
const TTL_MS = 24 * 3600_000

export type IdempotentResult = { status: number; body: unknown }

/**
 * Runs `fn` at most once per (user, scope, Idempotency-Key). Replays the stored response on
 * retries with the same request hash; rejects reuse with a different request.
 * Without a key, `fn` simply runs (callers still have state-based idempotency).
 */
export async function withIdempotency(
  db: Db,
  p: { userId: string; scope: string; key: string | null; requestHash: string },
  fn: () => Promise<IdempotentResult>,
): Promise<IdempotentResult> {
  if (!p.key) return fn()
  if (!KEY_RE.test(p.key)) throw new AppError('VALIDATION_FAILED', { field: 'Idempotency-Key' })

  try {
    await db.idempotencyKey.create({
      data: { userId: p.userId, scope: p.scope, key: p.key, requestHash: p.requestHash, expiresAt: new Date(Date.now() + TTL_MS) },
    })
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
    const existing = await db.idempotencyKey.findUnique({
      where: { userId_scope_key: { userId: p.userId, scope: p.scope, key: p.key } },
    })
    if (!existing) throw new AppError('INTERNAL')
    if (existing.requestHash !== p.requestHash) throw new AppError('IDEMPOTENCY_MISMATCH')
    if (existing.responseStatus == null) {
      // First request still running (or crashed). Tell the client to retry later.
      throw new AppError('PROMOTION_IN_PROGRESS', undefined, 'The same request is already being processed.')
    }
    return { status: existing.responseStatus, body: existing.responseBody }
  }

  try {
    const result = await fn()
    if (result.status < 500) {
      await db.idempotencyKey.update({
        where: { userId_scope_key: { userId: p.userId, scope: p.scope, key: p.key } },
        data: { responseStatus: result.status, responseBody: result.body as Prisma.InputJsonValue },
      })
    }
    return result
  } catch (e) {
    // Allow a clean retry if the operation failed.
    await db.idempotencyKey.deleteMany({ where: { userId: p.userId, scope: p.scope, key: p.key } })
    throw e
  }
}
