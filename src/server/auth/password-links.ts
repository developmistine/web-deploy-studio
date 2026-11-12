import type { Db, Tx } from '@/server/db'
import type { PasswordLinkPurpose } from '@/generated/prisma/client'
import { getConfig } from '@/server/config'
import { randomToken, sha256Hex } from '@/server/crypto'

/**
 * One-time password SETUP / RESET links (no email delivery: the admin is shown the link once and hands it over
 * through an internal channel). 256-bit random token; only its SHA-256 is stored; single use; expiring.
 *
 * The token travels in the URL *fragment* (`/password#token=…`), which browsers never send to servers, proxies or
 * Referer headers; the page posts it in the request body.
 */
export async function issuePasswordLink(
  tx: Db | Tx,
  userId: string,
  purpose: PasswordLinkPurpose,
  createdById: string | null,
): Promise<{ url: string; expiresAt: Date }> {
  const cfg = getConfig()
  const now = new Date()
  // Any older outstanding link for this user stops working.
  await tx.passwordLink.updateMany({ where: { userId, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } })
  const token = randomToken(32)
  const expiresAt = new Date(now.getTime() + cfg.PASSWORD_LINK_TTL_HOURS * 3600_000)
  await tx.passwordLink.create({ data: { id: sha256Hex(token), userId, purpose, createdById, expiresAt } })
  return { url: `${cfg.appOrigin}/password#token=${token}`, expiresAt }
}

/** Atomically marks a valid link as used. Returns its user and purpose, or null (unknown, used or expired). */
export async function consumePasswordLink(tx: Tx, token: string): Promise<{ userId: string; purpose: PasswordLinkPurpose } | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null
  const id = sha256Hex(token)
  const now = new Date()
  const claimed = await tx.passwordLink.updateMany({ where: { id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })
  if (claimed.count !== 1) return null
  const link = await tx.passwordLink.findUniqueOrThrow({ where: { id }, select: { userId: true, purpose: true } })
  return link
}

/** Expires every outstanding link of a user (revocation, disablement). */
export async function expirePasswordLinks(tx: Db | Tx, userId: string): Promise<void> {
  const now = new Date()
  await tx.passwordLink.updateMany({ where: { userId, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } })
}
