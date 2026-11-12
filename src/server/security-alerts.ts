import type { Db } from '@/server/db'
import { audit } from '@/server/audit'
import { log } from '@/server/log'

/** Atomic fixed-window counter (shares the rate_limits table). Returns the count after increment. */
export async function bumpCounter(db: Db, key: string, windowSeconds: number): Promise<number> {
  const windowMs = windowSeconds * 1000
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs)
  const k = key.slice(0, 191)
  await db.$executeRaw`INSERT INTO rate_limits (\`key\`, window_start, count) VALUES (${k}, ${windowStart}, 1)
    ON DUPLICATE KEY UPDATE count = count + 1`
  const rows = await db.$queryRaw<{ count: number }[]>`SELECT count FROM rate_limits WHERE \`key\` = ${k} AND window_start = ${windowStart}`
  return Number(rows[0]?.count ?? 0)
}

export type AlertKind = 'REPEATED_AUTHZ_DENIALS' | 'RATE_LIMIT_EXCEEDED' | 'ARTIFACT_INTEGRITY' | 'ABNORMAL_DEPLOY_FREQUENCY' | 'SUSPICIOUS_CONTENT' | 'REPEATED_LOGIN_FAILURES' | 'PRIVILEGE_CHANGE'

/**
 * Emits a security alert: a structured `security.alert` log line (ship to SIEM; alert rules key on it)
 * plus an audit record. Thresholds are deliberately simple; tune in the SIEM.
 */
export async function raiseAlert(db: Db, kind: AlertKind, details: { actorUserId?: string | null; departmentId?: string | null; [k: string]: unknown }) {
  log.warn('security.alert', { kind, ...details })
  await audit(db, {
    action: 'SECURITY_ALERT',
    result: 'DENIED',
    actorUserId: details.actorUserId ?? null,
    departmentId: details.departmentId ?? null,
    metadata: { kind },
  }).catch(() => undefined)
}

/** Call after an authorization denial. Alerts once when a user crosses the threshold in the window. */
export async function trackAuthzDenial(db: Db, actorUserId: string, departmentId: string | null): Promise<void> {
  const count = await bumpCounter(db, `authz-denied:${actorUserId}`, 600)
  if (count === 5) await raiseAlert(db, 'REPEATED_AUTHZ_DENIALS', { actorUserId, departmentId, windowSeconds: 600 })
}
