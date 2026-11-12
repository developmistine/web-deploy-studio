import type { Db, Tx } from '@/server/db'
import type { Prisma } from '@/generated/prisma/client'
import { currentContext } from '@/server/request-context'

export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_DENIED'
  | 'REAUTH_FAILED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_SET'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_ISSUED'
  | 'USER_CREATED'
  | 'USER_UPDATED'
  | 'USER_REVOKED'
  | 'LOGOUT'
  | 'SESSION_REVOKED'
  | 'AUTHZ_DENIED'
  | 'REAUTH_REQUIRED'
  | 'DEPARTMENT_CREATED'
  | 'MEMBERSHIP_CHANGED'
  | 'ROLE_CHANGED'
  | 'USER_DISABLED'
  | 'USER_ENABLED'
  | 'WEBSITE_CREATED'
  | 'WEBSITE_RENAMED'
  | 'WEBSITE_SUSPENDED'
  | 'WEBSITE_UNSUSPENDED'
  | 'DEPLOYMENT_QUARANTINED'
  | 'DEPLOYMENT_UPLOADED'
  | 'UPLOAD_REJECTED'
  | 'PREVIEW_OPENED'
  | 'PROMOTION_REQUESTED'
  | 'DEPLOYMENT_PREVIEW_READY'
  | 'DEPLOYMENT_LIVE'
  | 'DEPLOYMENT_FAILED'
  | 'ARTIFACT_INTEGRITY_FAILED'
  | 'ROLLBACK_REQUESTED'
  | 'ROLLBACK_COMPLETED'
  | 'ROLLBACK_FAILED'
  | 'GATEWAY_SESSION_ISSUED'
  | 'GATEWAY_DENIED'
  | 'SECURITY_ALERT'

export type AuditEntry = {
  action: AuditAction
  result?: 'SUCCESS' | 'DENIED' | 'FAILURE'
  actorUserId?: string | null
  /** Account affected by an enrollment/password event. */
  targetUserId?: string | null
  departmentId?: string | null
  websiteId?: string | null
  deploymentId?: string | null
  metadata?: Prisma.InputJsonValue
}

const DEFAULT_RESULT: Partial<Record<AuditAction, AuditEntry['result']>> = {
  LOGIN_DENIED: 'DENIED',
  AUTHZ_DENIED: 'DENIED',
  REAUTH_REQUIRED: 'DENIED',
  REAUTH_FAILED: 'DENIED',
  UPLOAD_REJECTED: 'DENIED',
  GATEWAY_DENIED: 'DENIED',
  DEPLOYMENT_FAILED: 'FAILURE',
  ROLLBACK_FAILED: 'FAILURE',
  ARTIFACT_INTEGRITY_FAILED: 'FAILURE',
}

/**
 * Append-only audit trail (the runtime DB account has INSERT/SELECT only on audit_logs —
 * see infra/mysql/grants.sh). Never pass secrets, tokens or raw IPs in metadata.
 */
export async function audit(db: Db | Tx, e: AuditEntry): Promise<void> {
  const ctx = currentContext()
  await db.auditLog.create({
    data: {
      action: e.action,
      result: e.result ?? DEFAULT_RESULT[e.action] ?? 'SUCCESS',
      requestId: ctx?.requestId ?? null,
      sourceIpHash: ctx?.sourceIpHash ?? null,
      actorUserId: e.actorUserId ?? null,
      targetUserId: e.targetUserId ?? null,
      departmentId: e.departmentId ?? null,
      websiteId: e.websiteId ?? null,
      deploymentId: e.deploymentId ?? null,
      metadata: e.metadata,
    },
  })
}
