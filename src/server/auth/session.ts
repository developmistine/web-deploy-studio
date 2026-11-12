import type { Db, Tx } from '@/server/db'
import type { Role, SessionStage } from '@/generated/prisma/client'
import { getConfig } from '@/server/config'
import { parseCookies, serializeCookie } from '@/server/http/cookies'
import { randomToken, sha256Hex } from '@/server/crypto'

/** The authenticated principal. Built only from server-side records — never from request input. */
export type Actor = {
  userId: string
  role: Role
  departmentId: string | null
  departmentCode: string | null
  displayName: string
  email: string
  /** Last successful password verification in this session (re-authentication for sensitive actions). */
  authenticatedAt: Date
}

export type SessionContext = { sessionId: string; csrfToken: string; stage: SessionStage; mustChangePassword: boolean; actor: Actor }

export function sessionCookieName(): string {
  return getConfig().secureCookies ? '__Host-ds_session' : 'ds_session'
}

/** Creates a new server session (new random token every time: login and password change rotate the session). */
export async function createSession(
  db: Db | Tx,
  userId: string,
  stage: SessionStage = 'FULL',
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const cfg = getConfig()
  const token = randomToken(32)
  const csrfToken = randomToken(32)
  const expiresAt = new Date(Date.now() + cfg.SESSION_TTL_HOURS * 3600_000)
  await db.session.create({ data: { id: sha256Hex(token), userId, csrfToken, stage, expiresAt, authenticatedAt: new Date() } })
  return { token, csrfToken, expiresAt }
}

export function sessionSetCookie(token: string, expiresAt: Date): string {
  const cfg = getConfig()
  return serializeCookie(sessionCookieName(), token, {
    httpOnly: true,
    secure: cfg.secureCookies,
    sameSite: 'Lax',
    maxAgeSeconds: (expiresAt.getTime() - Date.now()) / 1000,
  })
}

export function sessionClearCookie(): string {
  return serializeCookie(sessionCookieName(), '', { httpOnly: true, secure: getConfig().secureCookies, maxAgeSeconds: 0 })
}

export function readSessionToken(cookieHeader: string | null | undefined): string | null {
  const v = parseCookies(cookieHeader).get(sessionCookieName())
  return v && v.length >= 32 && v.length <= 128 ? v : null
}

/** Resolves the session and the user's *current* role/department/status from the database. */
export async function resolveSession(db: Db, cookieHeader: string | null | undefined): Promise<SessionContext | null> {
  const token = readSessionToken(cookieHeader)
  if (!token) return null
  return resolveSessionById(db, sha256Hex(token))
}

/**
 * Validates a session by its stored id (hash) — used by the cookie path above and by the website gateway, which
 * holds only the session id inside its signed cookie. Enforces absolute + idle expiry, revocation (row deleted) and
 * account status (anything but ACTIVE deletes every session of the user).
 */
export async function resolveSessionById(db: Db, id: string, touch = true): Promise<SessionContext | null> {
  const cfg = getConfig()
  const s = await db.session.findUnique({ where: { id }, include: { user: { include: { department: true } } } })
  if (!s) return null
  const now = Date.now()
  const idleLimit = s.lastSeenAt.getTime() + cfg.SESSION_IDLE_MINUTES * 60_000
  if (s.expiresAt.getTime() <= now || idleLimit <= now) {
    await db.session.deleteMany({ where: { id } })
    return null
  }
  const u = s.user
  if (u.status !== 'ACTIVE' || u.disabledAt || u.revokedAt) {
    await db.session.deleteMany({ where: { userId: u.id } })
    return null
  }
  // NOTE: a USER without a department keeps a session but every resource policy denies them.
  if (touch && now - s.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id }, data: { lastSeenAt: new Date(now) } }).catch(() => undefined)
  }
  return {
    sessionId: id,
    csrfToken: s.csrfToken,
    stage: s.stage,
    mustChangePassword: u.mustChangePassword,
    actor: {
      userId: u.id,
      role: u.role,
      departmentId: u.departmentId,
      departmentCode: u.department?.code ?? null,
      displayName: u.displayName,
      email: u.email,
      authenticatedAt: s.authenticatedAt,
    },
  }
}

/** Records a fresh password verification for this session (re-authentication). */
export async function markReauthenticated(db: Db, sessionId: string): Promise<void> {
  await db.session.update({ where: { id: sessionId }, data: { authenticatedAt: new Date() } })
}

/** Revokes every session of a user (role/department/status/password changes, incident response). Returns the count. */
export async function revokeUserSessions(db: Db | Tx, userId: string): Promise<number> {
  return (await db.session.deleteMany({ where: { userId } })).count
}

export async function destroySession(db: Db, sessionId: string): Promise<void> {
  await db.session.deleteMany({ where: { id: sessionId } })
}
