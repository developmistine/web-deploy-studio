import type { Db } from '@/server/db'
import type { Actor } from '@/server/auth/session'
import { canAccessDepartment } from '@/server/authz/policy'
import { AppError } from '@/server/http/errors'
import { audit } from '@/server/audit'
import { trackAuthzDenial } from '@/server/security-alerts'

/**
 * Enforces department access for an existing resource and records denials.
 * Denials surface as 404 so other departments' resources cannot be discovered.
 */
export async function authorizeDepartment(
  db: Db,
  actor: Actor,
  departmentId: string,
  context: { action: string; websiteId?: string; deploymentId?: string },
): Promise<void> {
  if (canAccessDepartment(actor, departmentId)) return
  await audit(db, {
    action: 'AUTHZ_DENIED',
    actorUserId: actor.userId,
    departmentId: actor.departmentId,
    websiteId: context.websiteId,
    deploymentId: context.deploymentId,
    metadata: { attempted: context.action, targetDepartmentId: departmentId },
  })
  await trackAuthzDenial(db, actor.userId, actor.departmentId).catch(() => undefined)
  throw new AppError('NOT_FOUND')
}
