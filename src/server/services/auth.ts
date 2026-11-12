import type { Db } from '@/server/db'
import { getConfig } from '@/server/config'
import { AppError } from '@/server/http/errors'
import { audit } from '@/server/audit'
import { enforceRateLimit, peekRateLimit } from '@/server/rate-limit'
import { raiseAlert } from '@/server/security-alerts'
import { sha256Hex } from '@/server/crypto'
import { normalizeEmail } from '@/server/auth/email'
import { hashPassword, needsRehash, passwordProblems, verifyPassword } from '@/server/auth/password'
import { consumePasswordLink } from '@/server/auth/password-links'
import { createSession, markReauthenticated, revokeUserSessions, type SessionContext } from '@/server/auth/session'

/**
 * Local email/password authentication (ADR 0002). Every failure path returns the same generic error and does the
 * same Argon2 work, so responses do not reveal whether an account exists, is disabled or has no password yet.
 */

const ACCOUNT_WINDOW_SECONDS = 15 * 60
const IP_WINDOW_SECONDS = 10 * 60
const accountKey = (email: string) => `login-acct:${sha256Hex(email).slice(0, 32)}`
const ipKey = (ip: string) => `login-ip:${sha256Hex(ip).slice(0, 32)}`

type NewSession = { token: string; csrfToken: string; expiresAt: Date; stage: 'FULL' | 'PASSWORD_CHANGE' }

async function recordFailure(db: Db, email: string | null, ip: string) {
  const cfg = getConfig()
  // Counters only grow on failures; once over the limit, even a correct password is refused until the window ends.
  await enforceRateLimit(db, ipKey(ip), cfg.RATE_LIMIT_LOGINS_PER_10MIN, IP_WINDOW_SECONDS).catch(() => undefined)
  if (email) await enforceRateLimit(db, accountKey(email), cfg.RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT, ACCOUNT_WINDOW_SECONDS).catch(() => undefined)
}

async function assertNotThrottled(db: Db, email: string | null, ip: string) {
  const cfg = getConfig()
  const ipCount = await peekRateLimit(db, ipKey(ip), IP_WINDOW_SECONDS)
  const acctCount = email ? await peekRateLimit(db, accountKey(email), ACCOUNT_WINDOW_SECONDS) : 0
  if (ipCount >= cfg.RATE_LIMIT_LOGINS_PER_10MIN || acctCount >= cfg.RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT) {
    await audit(db, { action: 'LOGIN_DENIED', metadata: { reason: 'rate_limited' } })
    throw new AppError('RATE_LIMITED', { retryAfterSeconds: ACCOUNT_WINDOW_SECONDS })
  }
}

export async function login(db: Db, input: { email: string; password: string }, ip: string): Promise<NewSession> {
  const email = normalizeEmail(input.email)
  await assertNotThrottled(db, email, ip)
  const user = email ? await db.user.findUnique({ where: { activeEmail: email } }) : null
  const ok = await verifyPassword(user?.passwordHash ?? null, input.password)

  if (!user || !ok || user.status !== 'ACTIVE') {
    const reason = !user ? 'unknown_account' : !ok ? 'wrong_password' : `status_${user.status.toLowerCase()}`
    await audit(db, { action: 'LOGIN_DENIED', targetUserId: user?.id ?? null, metadata: { reason } })
    await recordFailure(db, email, ip)
    const failures = email ? await peekRateLimit(db, accountKey(email), ACCOUNT_WINDOW_SECONDS) : 0
    if (failures === getConfig().RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT) {
      await raiseAlert(db, 'REPEATED_LOGIN_FAILURES', { targetUserId: user?.id ?? null, windowSeconds: ACCOUNT_WINDOW_SECONDS })
    }
    throw new AppError('INVALID_CREDENTIALS')
  }

  const stage = user.mustChangePassword ? 'PASSWORD_CHANGE' : 'FULL'
  const session = await createSession(db, user.id, stage)
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date(), ...(needsRehash(user.passwordHash!) ? { passwordHash: await hashPassword(input.password) } : {}) },
  })
  await audit(db, { action: 'LOGIN', actorUserId: user.id, departmentId: user.departmentId, metadata: { stage } })
  return { ...session, stage }
}

function assertPolicy(password: string, user: { email: string; displayName: string }) {
  const problems = passwordProblems(password, user)
  if (problems.length) throw new AppError('PASSWORD_POLICY', { problems, minLength: getConfig().PASSWORD_MIN_LENGTH })
}

/** Changes the caller's password. Revokes every session of the user and issues a fresh one (rotation). */
export async function changePassword(db: Db, s: SessionContext, input: { currentPassword: string; newPassword: string }, ip: string): Promise<NewSession> {
  const user = await db.user.findUniqueOrThrow({ where: { id: s.actor.userId } })
  await assertNotThrottled(db, user.emailNormalized, ip)
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    await audit(db, { action: 'REAUTH_FAILED', actorUserId: user.id, metadata: { op: 'change_password' } })
    await recordFailure(db, user.emailNormalized, ip)
    throw new AppError('WRONG_PASSWORD')
  }
  assertPolicy(input.newPassword, user)
  if (await verifyPassword(user.passwordHash, input.newPassword)) throw new AppError('PASSWORD_REUSED')

  const passwordHash = await hashPassword(input.newPassword)
  return db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false } })
    await revokeUserSessions(tx, user.id)
    const session = await createSession(tx, user.id, 'FULL')
    await audit(tx, { action: 'PASSWORD_CHANGED', actorUserId: user.id, targetUserId: user.id })
    return { ...session, stage: 'FULL' as const }
  })
}

/** Confirms the caller's password for a sensitive action (re-authentication window). */
export async function reauthenticate(db: Db, s: SessionContext, password: string, ip: string): Promise<void> {
  const user = await db.user.findUniqueOrThrow({ where: { id: s.actor.userId } })
  await assertNotThrottled(db, user.emailNormalized, ip)
  if (!(await verifyPassword(user.passwordHash, password))) {
    await audit(db, { action: 'REAUTH_FAILED', actorUserId: user.id })
    await recordFailure(db, user.emailNormalized, ip)
    throw new AppError('WRONG_PASSWORD')
  }
  await markReauthenticated(db, s.sessionId)
}

/**
 * "Forgot password": no email is sent (no mail infrastructure). The request is recorded for administrators, who
 * issue a one-time reset link through an internal channel. Always the same response (no enumeration).
 */
export async function requestPasswordReset(db: Db, rawEmail: string, ip: string): Promise<void> {
  await enforceRateLimit(db, `forgot:${sha256Hex(ip).slice(0, 32)}`, 10, 3600)
  const email = normalizeEmail(rawEmail)
  const user = email ? await db.user.findUnique({ where: { activeEmail: email }, select: { id: true, status: true } }) : null
  if (user && (user.status === 'ACTIVE' || user.status === 'INVITED')) {
    await db.user.update({ where: { id: user.id }, data: { passwordResetRequestedAt: new Date() } })
    await audit(db, { action: 'PASSWORD_RESET_REQUESTED', targetUserId: user.id })
  } else {
    await audit(db, { action: 'PASSWORD_RESET_REQUESTED', result: 'DENIED', metadata: { reason: 'no_eligible_account' } })
  }
}

/** Completes a one-time SETUP/RESET link: sets the password, activates an invited account, revokes sessions. */
export async function completePasswordLink(db: Db, input: { token: string; newPassword: string }, ip: string): Promise<void> {
  await enforceRateLimit(db, `pwlink:${sha256Hex(ip).slice(0, 32)}`, 20, 3600)
  const passwordHash = await hashPassword(input.newPassword)
  await db.$transaction(async (tx) => {
    const link = await consumePasswordLink(tx, input.token)
    if (!link) throw new AppError('INVALID_LINK')
    const user = await tx.user.findUniqueOrThrow({ where: { id: link.userId } })
    if (user.status !== 'ACTIVE' && user.status !== 'INVITED') throw new AppError('INVALID_LINK')
    // Policy is checked inside the transaction so a rejected password rolls back and the link stays usable.
    assertPolicy(input.newPassword, user)
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, status: 'ACTIVE', mustChangePassword: false, passwordChangedAt: new Date(), passwordResetRequestedAt: null },
    })
    await tx.enrollment.updateMany({ where: { userId: user.id }, data: { activationState: 'ACTIVATED' } })
    await revokeUserSessions(tx, user.id)
    await audit(tx, { action: 'PASSWORD_SET', targetUserId: user.id, metadata: { purpose: link.purpose } })
  })
}
