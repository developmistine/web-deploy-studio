import { getDb } from '@/server/db'
import { requirePageSession } from '@/server/auth/page-session'
import { listUsers } from '@/server/services/users'
import { BrandHeader } from '@/components/BrandHeader'
import { AdminShell } from '@/components/AdminShell'
import { EnrollmentManager } from '@/components/EnrollmentManager'

export const dynamic = 'force-dynamic'

/** Enroll IDs — ADMIN only (non-admins get a 404 here; the API enforces the same rule independently). */
export default async function EnrollIdsPage() {
  const session = await requirePageSession({ admin: true, returnTo: '/admin/users' })
  const initial = await listUsers(getDb(), session.actor, {})
  return (
    <AdminShell active="enroll">
      <div className="shell">
        <BrandHeader user={{ csrfToken: session.csrfToken, label: `${session.actor.displayName} · Admin` }} />
        <EnrollmentManager
          csrfToken={session.csrfToken}
          me={{ id: session.actor.userId, displayName: session.actor.displayName }}
          initial={initial}
        />
      </div>
    </AdminShell>
  )
}
