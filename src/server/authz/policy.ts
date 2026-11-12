import type { Actor } from '@/server/auth/session'
import { AppError } from '@/server/http/errors'
import { normalizeDepartmentCode } from '@/lib/validation'

/**
 * Authorization policy. Decisions depend ONLY on actor.role + actor.departmentId
 * (resolved server-side), never on who uploaded a revision.
 */

export const isAdmin = (a: Actor): boolean => a.role === 'ADMIN'

export function canAccessDepartment(actor: Actor, departmentId: string): boolean {
  if (isAdmin(actor)) return true
  return actor.role === 'USER' && !!actor.departmentId && actor.departmentId === departmentId
}

/**
 * Read access: USER mismatch is concealed as 404 so other departments' resources
 * cannot be enumerated.
 */
export function assertCanRead(actor: Actor, departmentId: string): void {
  if (!canAccessDepartment(actor, departmentId)) throw new AppError('NOT_FOUND')
}

/**
 * Write access (upload, preview, promote, rollback). Same rule; resource existence is
 * also concealed because the caller could not have learned the id legitimately.
 */
export function assertCanWrite(actor: Actor, departmentId: string): void {
  if (!canAccessDepartment(actor, departmentId)) throw new AppError('NOT_FOUND')
}

/** Prisma `where` fragment that scopes website queries to what the actor may see. */
export function websiteScope(actor: Actor): { departmentId?: string } {
  if (isAdmin(actor)) return {}
  return { departmentId: actor.departmentId ?? '__none__' }
}

export function departmentScope(actor: Actor): { id?: string } {
  if (isAdmin(actor)) return {}
  return { id: actor.departmentId ?? '__none__' }
}

/**
 * Resolves the target department for a create request from a FREE-TEXT label.
 *  - USER: the department always comes from their trusted membership. A typed label is only compared
 *    with it; any other value is rejected as tampering (DEPARTMENT_MISMATCH) — never honoured.
 *  - ADMIN: may target any department (normalized code); creating a missing department is allowed.
 * Returns the normalized department code.
 */
export function resolveTargetDepartment(actor: Actor, requestedLabel: string | undefined): { code: string; label: string } {
  if (isAdmin(actor)) {
    if (!requestedLabel) throw new AppError('VALIDATION_FAILED', { field: 'department' })
    const code = normalizeDepartmentCode(requestedLabel)
    if (!code) throw new AppError('INVALID_DEPARTMENT')
    return { code, label: requestedLabel.trim() }
  }
  if (!actor.departmentId || !actor.departmentCode) throw new AppError('NO_DEPARTMENT')
  if (requestedLabel !== undefined && normalizeDepartmentCode(requestedLabel) !== actor.departmentCode) {
    throw new AppError('DEPARTMENT_MISMATCH')
  }
  return { code: actor.departmentCode, label: actor.departmentCode }
}

/**
 * Re-authentication for sensitive admin operations: an ADMIN changing production of a department other than
 * their own must have verified their password within ADMIN_STEP_UP_MAX_AGE_MINUTES.
 */
export function requiresStepUp(actor: Actor, targetDepartmentId: string, maxAgeMinutes: number, now = Date.now()): boolean {
  if (!isAdmin(actor) || maxAgeMinutes <= 0) return false
  if (actor.departmentId === targetDepartmentId) return false
  return now - actor.authenticatedAt.getTime() > maxAgeMinutes * 60_000
}

/** True when the actor's last password verification is older than the window (enrollment writes etc.). */
export function needsRecentAuth(actor: Actor, maxAgeMinutes: number, now = Date.now()): boolean {
  return maxAgeMinutes > 0 && now - actor.authenticatedAt.getTime() > maxAgeMinutes * 60_000
}
