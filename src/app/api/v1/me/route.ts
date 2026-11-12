import { json, route } from '@/server/http/handler'
import type { MeDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

/** Available while a password change is pending, so the client can route the user to it. */
export const GET = route({ stages: ['FULL', 'PASSWORD_CHANGE'] }, async ({ db, actor, session }) => {
  const dept = actor.departmentId ? await db.department.findUnique({ where: { id: actor.departmentId } }) : null
  const body: MeDTO = {
    user: {
      displayName: actor.displayName,
      email: actor.email,
      role: actor.role,
      department: dept ? { id: dept.id, code: dept.code, name: dept.name } : null,
    },
    csrfToken: session.csrfToken,
    stage: session.stage,
  }
  return json(body)
})
