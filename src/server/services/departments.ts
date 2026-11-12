import { Prisma, type Department } from '@/generated/prisma/client'
import type { Db, Tx } from '@/server/db'
import { normalizeDepartmentCode } from '@/lib/validation'
import { AppError } from '@/server/http/errors'
import { audit } from '@/server/audit'

/**
 * Finds or creates a department by free-text label. Callers MUST already be trusted to create
 * departments (ADMIN request, verified IdP claim mapping, or the admin CLI). Creating a department
 * never grants anyone membership in it.
 */
export async function ensureDepartment(db: Db | Tx, label: string, actorUserId: string | null, source: string): Promise<Department> {
  const code = normalizeDepartmentCode(label)
  if (!code) throw new AppError('INVALID_DEPARTMENT')
  const existing = await db.department.findUnique({ where: { code } })
  if (existing) return existing
  try {
    const created = await db.department.create({ data: { code, name: label.trim().slice(0, 100) } })
    await audit(db, { action: 'DEPARTMENT_CREATED', actorUserId, departmentId: created.id, metadata: { code, source } })
    return created
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return db.department.findUniqueOrThrow({ where: { code } })
    }
    throw e
  }
}
