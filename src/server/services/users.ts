import { Prisma, type Role, type UserStatus } from '@/generated/prisma/client'
import type { Db, Tx } from '@/server/db'
import type { Actor } from '@/server/auth/session'
import type { DepartmentDTO, PasswordLinkDTO, UserAdminDTO, UserListDTO } from '@/lib/types'
import { createUserSchema, listUsersQuerySchema, updateUserSchema, normalizeDepartmentCode } from '@/lib/validation'
import { getConfig } from '@/server/config'
import { AppError } from '@/server/http/errors'
import { audit } from '@/server/audit'
import { raiseAlert } from '@/server/security-alerts'
import { isAdmin, needsRecentAuth } from '@/server/authz/policy'
import { isAllowedEmailDomain, normalizeEmail } from '@/server/auth/email'
import { expirePasswordLinks, issuePasswordLink } from '@/server/auth/password-links'
import { revokeUserSessions } from '@/server/auth/session'
import { ensureDepartment } from '@/server/services/departments'

/**
 * Admin enrollment management (docs/enrollment.md). Every function re-checks the caller server-side: ADMIN only,
 * and every write needs a recent password confirmation. Revocation is a soft delete — history is never removed.
 */

const userSelect = {
  id: true,
  displayName: true,
  email: true,
  role: true,
  status: true,
  passwordHash: true,
  passwordResetRequestedAt: true,
  lastLoginAt: true,
  createdAt: true,
  department: { select: { id: true, code: true, name: true } },
} satisfies Prisma.UserSelect

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>

function toDTO(u: UserRow): UserAdminDTO {
  return {
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    department: u.department,
    role: u.role,
    status: u.status,
    passwordSet: !!u.passwordHash, // the hash itself never leaves this module
    resetRequested: !!u.passwordResetRequestedAt,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  }
}

function requireAdmin(actor: Actor) {
  if (!isAdmin(actor)) throw new AppError('FORBIDDEN')
}

async function requireAdminRecentAuth(db: Db, actor: Actor) {
  requireAdmin(actor)
  if (needsRecentAuth(actor, getConfig().ADMIN_STEP_UP_MAX_AGE_MINUTES)) {
    await audit(db, { action: 'REAUTH_REQUIRED', actorUserId: actor.userId, metadata: { area: 'enrollment' } })
    throw new AppError('REAUTH_REQUIRED')
  }
}

async function departmentFromLabel(tx: Tx, actorUserId: string | null, label: string | null | undefined) {
  if (!label) return null
  if (!normalizeDepartmentCode(label)) throw new AppError('INVALID_DEPARTMENT')
  return ensureDepartment(tx, label, actorUserId, 'admin-enrollment')
}

/** Locks every active ADMIN row and fails if the change would leave none (prevents lock-out races). */
async function assertAnotherActiveAdmin(tx: Tx, exceptUserId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE`
  if (!rows.some((r) => r.id !== exceptUserId)) throw new AppError('LAST_ADMIN')
}

export async function listUsers(db: Db, actor: Actor, rawQuery: Record<string, string | undefined>): Promise<UserListDTO> {
  requireAdmin(actor)
  const q = listUsersQuerySchema.parse(rawQuery)
  const where: Prisma.UserWhereInput = {
    ...(q.role ? { role: q.role } : {}),
    ...(q.status ? { status: q.status } : { status: { not: 'REVOKED' } }),
    ...(q.department ? { department: { code: q.department.toLowerCase() } } : {}),
    ...(q.q
      ? { OR: [{ displayName: { contains: q.q } }, { emailNormalized: { contains: q.q.normalize('NFKC').toLowerCase() } }] }
      : {}),
  }
  const [rows, total, departments, activeAdminCount] = await Promise.all([
    db.user.findMany({ where, select: userSelect, orderBy: [{ displayName: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.user.count({ where }),
    db.department.findMany({ orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
    db.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } }),
  ])
  return { users: rows.map(toDTO), total, page: q.page, pageSize: q.pageSize, departments: departments satisfies DepartmentDTO[], activeAdminCount }
}

export async function getUser(db: Db, actor: Actor, id: string): Promise<UserAdminDTO> {
  requireAdmin(actor)
  const u = await db.user.findUnique({ where: { id }, select: userSelect })
  if (!u) throw new AppError('NOT_FOUND')
  return toDTO(u)
}

export async function createUser(db: Db, actor: Actor, body: unknown): Promise<{ user: UserAdminDTO; setupLink: PasswordLinkDTO }> {
  await requireAdminRecentAuth(db, actor)
  const input = createUserSchema.parse(body)
  return createEnrollment(db, actor.userId, input)
}

/** Shared by the admin API and the infra-only CLI bootstrap (createdById = null). */
export async function createEnrollment(
  db: Db,
  createdById: string | null,
  input: { displayName: string; email: string; department?: string; role: Role },
  auditMeta: Record<string, string> = {},
): Promise<{ user: UserAdminDTO; setupLink: PasswordLinkDTO }> {
  const email = normalizeEmail(input.email)
  if (!email) throw new AppError('INVALID_EMAIL')
  if (!isAllowedEmailDomain(email)) throw new AppError('EMAIL_DOMAIN_NOT_ALLOWED')
  if (input.role === 'USER' && !input.department) throw new AppError('DEPARTMENT_REQUIRED')
  let created: { user: UserAdminDTO; setupLink: PasswordLinkDTO }
  try {
    created = await db.$transaction(async (tx) => {
      const dept = await departmentFromLabel(tx, createdById, input.department)
      const user = await tx.user.create({
        data: {
          email: input.email.trim(),
          emailNormalized: email,
          activeEmail: email,
          displayName: input.displayName,
          role: input.role,
          departmentId: dept?.id ?? null,
          status: 'INVITED',
        },
        select: userSelect,
      })
      await tx.enrollment.create({ data: { userId: user.id, createdById } })
      const link = await issuePasswordLink(tx, user.id, 'SETUP', createdById)
      await audit(tx, { action: 'USER_CREATED', actorUserId: createdById, targetUserId: user.id, departmentId: dept?.id ?? null, metadata: { role: input.role, ...auditMeta } })
      return { user: toDTO(user), setupLink: { url: link.url, expiresAt: link.expiresAt.toISOString() } }
    })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new AppError('EMAIL_IN_USE')
    throw e
  }
  if (input.role === 'ADMIN') await raiseAlert(db, 'PRIVILEGE_CHANGE', { actorUserId: createdById, targetUserId: created.user.id, change: 'admin_enrolled' })
  return created
}

export async function updateUser(db: Db, actor: Actor, id: string, body: unknown): Promise<UserAdminDTO> {
  await requireAdminRecentAuth(db, actor)
  const input = updateUserSchema.parse(body)
  const self = id === actor.userId
  if (self && (input.role !== undefined || input.status !== undefined)) throw new AppError('SELF_CHANGE_NOT_ALLOWED')

  const result = await db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, select: { ...userSelect, departmentId: true } })
    if (!before) throw new AppError('NOT_FOUND')
    if (before.status === 'REVOKED') throw new AppError('ACCOUNT_REVOKED')

    const role = input.role ?? before.role
    const dept = input.department === undefined ? undefined : await departmentFromLabel(tx, actor.userId, input.department)
    const departmentId = dept === undefined ? before.departmentId : (dept?.id ?? null)
    if (role === 'USER' && !departmentId) throw new AppError('DEPARTMENT_REQUIRED')

    // Status: ACTIVE re-enables (an account that never set a password goes back to INVITED).
    let status: UserStatus = before.status
    if (input.status === 'DISABLED') status = 'DISABLED'
    if (input.status === 'ACTIVE') status = before.passwordHash ? 'ACTIVE' : 'INVITED'

    const losesAdmin = before.role === 'ADMIN' && before.status === 'ACTIVE' && (role !== 'ADMIN' || status !== 'ACTIVE')
    if (losesAdmin) await assertAnotherActiveAdmin(tx, id)

    const updated = await tx.user.update({
      where: { id },
      data: {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        role,
        departmentId,
        status,
        disabledAt: status === 'DISABLED' ? (before.status === 'DISABLED' ? undefined : new Date()) : null,
      },
      select: userSelect,
    })

    const roleChanged = role !== before.role
    const deptChanged = departmentId !== before.departmentId
    const statusChanged = status !== before.status
    // Stale authorization never survives: any privilege-relevant change ends every session of the user.
    if (roleChanged || deptChanged || statusChanged) await revokeUserSessions(tx, id)
    const meta = { roleChanged, deptChanged, statusChanged, displayNameChanged: input.displayName !== undefined && input.displayName !== before.displayName }
    await audit(tx, { action: 'USER_UPDATED', actorUserId: actor.userId, targetUserId: id, departmentId, metadata: meta })
    if (roleChanged) await audit(tx, { action: 'ROLE_CHANGED', actorUserId: actor.userId, targetUserId: id, metadata: { from: before.role, to: role } })
    if (deptChanged) await audit(tx, { action: 'MEMBERSHIP_CHANGED', actorUserId: actor.userId, targetUserId: id, departmentId, metadata: { from: before.departmentId } })
    if (statusChanged) await audit(tx, { action: status === 'DISABLED' ? 'USER_DISABLED' : 'USER_ENABLED', actorUserId: actor.userId, targetUserId: id })
    return { updated, roleChanged, toAdmin: roleChanged && role === 'ADMIN' }
  })
  if (result.toAdmin) await raiseAlert(db, 'PRIVILEGE_CHANGE', { actorUserId: actor.userId, targetUserId: id, change: 'promoted_to_admin' })
  return toDTO(result.updated)
}

export async function resetUserPassword(db: Db, actor: Actor, id: string): Promise<{ resetLink: PasswordLinkDTO }> {
  await requireAdminRecentAuth(db, actor)
  // Allowed for the admin's own account too (owner decision 2026-11-12): there is no self-service change-password
  // button, so this is how an admin changes their password. Recent re-auth is required above; every session of the
  // account — including the current one — ends, and the new password is set through the one-time link.
  return db.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id }, select: { status: true, passwordHash: true } })
    if (!u) throw new AppError('NOT_FOUND')
    if (u.status === 'REVOKED') throw new AppError('ACCOUNT_REVOKED')
    const link = await issuePasswordLink(tx, id, u.passwordHash ? 'RESET' : 'SETUP', actor.userId)
    // The old password stops working for new sign-ins only when the link is used; existing sessions end now.
    await revokeUserSessions(tx, id)
    await tx.user.update({ where: { id }, data: { passwordResetRequestedAt: null } })
    await audit(tx, { action: 'PASSWORD_RESET_ISSUED', actorUserId: actor.userId, targetUserId: id })
    return { resetLink: { url: link.url, expiresAt: link.expiresAt.toISOString() } }
  })
}

/** "Remove" in the UI: soft revocation. Sign-in impossible, email released, sessions and links ended, history kept. */
export async function revokeUser(db: Db, actor: Actor, id: string): Promise<UserAdminDTO> {
  await requireAdminRecentAuth(db, actor)
  if (id === actor.userId) throw new AppError('SELF_CHANGE_NOT_ALLOWED')
  const updated = await db.$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, select: { role: true, status: true } })
    if (!before) throw new AppError('NOT_FOUND')
    if (before.status === 'REVOKED') throw new AppError('ACCOUNT_REVOKED')
    if (before.role === 'ADMIN' && before.status === 'ACTIVE') await assertAnotherActiveAdmin(tx, id)
    const now = new Date()
    const u = await tx.user.update({ where: { id }, data: { status: 'REVOKED', activeEmail: null, revokedAt: now }, select: userSelect })
    await tx.enrollment.updateMany({ where: { userId: id }, data: { status: 'REVOKED', revokedAt: now, revokedById: actor.userId } })
    await expirePasswordLinks(tx, id)
    await revokeUserSessions(tx, id)
    await audit(tx, { action: 'USER_REVOKED', actorUserId: actor.userId, targetUserId: id })
    return u
  })
  return toDTO(updated)
}
