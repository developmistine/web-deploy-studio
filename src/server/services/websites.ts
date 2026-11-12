import { Prisma } from '@/generated/prisma/client'
import type { Db } from '@/server/db'
import type { Actor } from '@/server/auth/session'
import type { DepartmentDTO, WebsiteDTO, AuditLogDTO } from '@/lib/types'
import { createWebsiteSchema, normalizeDepartmentCode, renameWebsiteSchema } from '@/lib/validation'
import { departmentScope, isAdmin, requiresStepUp, resolveTargetDepartment, websiteScope } from '@/server/authz/policy'
import { getConfig } from '@/server/config'
import { enforceRateLimit } from '@/server/rate-limit'
import { authorizeDepartment } from '@/server/services/guard'
import { AppError } from '@/server/http/errors'
import { audit } from '@/server/audit'
import { buildHostname } from '@/server/deployments/hostnames'
import { toWebsiteDTO, websiteInclude } from '@/server/services/dto'
import { ensureDepartment } from '@/server/services/departments'

export async function listDepartments(db: Db, actor: Actor): Promise<DepartmentDTO[]> {
  const rows = await db.department.findMany({ where: departmentScope(actor), orderBy: { code: 'asc' } })
  return rows.map((d) => ({ id: d.id, code: d.code, name: d.name }))
}

/** USER: only their department's website. ADMIN: all, optionally filtered by department code. */
export async function listWebsites(db: Db, actor: Actor, filter: { departmentCode?: string } = {}): Promise<WebsiteDTO[]> {
  const where: Prisma.WebsiteWhereInput = { ...websiteScope(actor) }
  if (filter.departmentCode && isAdmin(actor)) where.department = { code: normalizeDepartmentCode(filter.departmentCode) ?? '__none__' }
  const rows = await db.website.findMany({ where, include: websiteInclude, orderBy: { department: { code: 'asc' } } })
  return rows.map(toWebsiteDTO)
}

export async function getWebsite(db: Db, actor: Actor, id: string): Promise<WebsiteDTO> {
  const w = await db.website.findUnique({ where: { id }, include: websiteInclude })
  if (!w) throw new AppError('NOT_FOUND')
  await authorizeDepartment(db, actor, w.departmentId, { action: 'website.read', websiteId: id })
  return toWebsiteDTO(w)
}

/**
 * Creates the department's single website (first deployment flow).
 * Uniqueness is enforced by websites.department_id UNIQUE; concurrent creators get WEBSITE_EXISTS
 * with the existing id so the client continues with an upload to that website.
 */
export async function createWebsite(db: Db, actor: Actor, input: unknown): Promise<WebsiteDTO> {
  const body = createWebsiteSchema.parse(input)
  const target = resolveTargetDepartment(actor, body.department)
  let hostname: string
  try {
    hostname = buildHostname(target.code, body.siteName)
  } catch {
    throw new AppError('HOSTNAME_TOO_LONG')
  }
  // USER: their membership department (already exists). ADMIN: may create a new department by label.
  const department = isAdmin(actor)
    ? await ensureDepartment(db, target.label, actor.userId, 'admin-website-create')
    : await db.department.findUniqueOrThrow({ where: { id: actor.departmentId! } })
  const departmentId = department.id

  const existing = await db.website.findUnique({ where: { departmentId } })
  if (existing) throw new AppError('WEBSITE_EXISTS', { websiteId: existing.id })

  try {
    const created = await db.$transaction(async (tx) => {
      const w = await tx.website.create({
        data: { departmentId, siteName: body.siteName, hostname, createdByUserId: actor.userId },
      })
      await audit(tx, {
        action: 'WEBSITE_CREATED',
        actorUserId: actor.userId,
        departmentId,
        websiteId: w.id,
        metadata: { siteName: body.siteName, hostname },
      })
      return w
    })
    return getWebsite(db, actor, created.id)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const again = await db.website.findUnique({ where: { departmentId } })
      if (again) throw new AppError('WEBSITE_EXISTS', { websiteId: again.id })
      throw new AppError('HOSTNAME_TAKEN')
    }
    throw e
  }
}

/**
 * Renames the department's website (site name → hostname) immediately. Same rules as other production changes:
 * department authorization, admin cross-department re-authentication, refused while suspended or while a
 * promotion/rollback is in flight. The worker re-points the live route to the new hostname; the old one stops working.
 */
export async function renameWebsite(db: Db, actor: Actor, id: string, input: unknown): Promise<WebsiteDTO> {
  const { siteName } = renameWebsiteSchema.parse(input)
  const w = await db.website.findUnique({ where: { id }, include: { department: true } })
  if (!w) throw new AppError('NOT_FOUND')
  await authorizeDepartment(db, actor, w.departmentId, { action: 'website.rename', websiteId: id })
  if (w.suspendedAt) throw new AppError('WEBSITE_SUSPENDED')
  if (siteName === w.siteName) return getWebsite(db, actor, id)
  if (requiresStepUp(actor, w.departmentId, getConfig().ADMIN_STEP_UP_MAX_AGE_MINUTES)) {
    await audit(db, { action: 'REAUTH_REQUIRED', actorUserId: actor.userId, departmentId: w.departmentId, websiteId: id })
    throw new AppError('REAUTH_REQUIRED')
  }
  await enforceRateLimit(db, `rename:${actor.userId}`, 20, 3600)
  let hostname: string
  try {
    hostname = buildHostname(w.department.code, siteName)
  } catch {
    throw new AppError('HOSTNAME_TOO_LONG')
  }
  try {
    await db.$transaction(async (tx) => {
      // Serialize with promotions/rollbacks (they hold active_lock_key = website id while queued/running).
      const busy = await tx.deploymentJob.findFirst({ where: { activeLockKey: id } })
      if (busy) throw new AppError('PROMOTION_IN_PROGRESS')
      await tx.website.update({ where: { id }, data: { siteName, hostname } })
      await audit(tx, {
        action: 'WEBSITE_RENAMED',
        actorUserId: actor.userId,
        departmentId: w.departmentId,
        websiteId: id,
        metadata: { from: w.siteName, to: siteName, fromHostname: w.hostname, toHostname: hostname },
      })
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('HOSTNAME_TAKEN')
    throw e
  }
  return getWebsite(db, actor, id)
}

export async function listAuditLogs(
  db: Db,
  actor: Actor,
  filter: { websiteId?: string; departmentCode?: string; limit?: number },
): Promise<AuditLogDTO[]> {
  const where: Prisma.AuditLogWhereInput = {}
  if (!isAdmin(actor)) where.departmentId = actor.departmentId ?? '__none__'
  else if (filter.departmentCode) where.department = { code: normalizeDepartmentCode(filter.departmentCode) ?? '__none__' }
  if (filter.websiteId) where.websiteId = filter.websiteId
  const rows = await db.auditLog.findMany({
    where,
    orderBy: { id: 'desc' },
    take: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    include: { actor: { select: { displayName: true } }, department: { select: { code: true } } },
  })
  return rows.map((r) => ({
    id: r.id.toString(),
    action: r.action,
    actor: r.actor?.displayName ?? null,
    departmentCode: r.department?.code ?? null,
    websiteId: r.websiteId,
    deploymentId: r.deploymentId,
    createdAt: r.createdAt.toISOString(),
  }))
}
