import { getDb } from '@/server/db'
import { getConfig } from '@/server/config'
import { requirePageSession } from '@/server/auth/page-session'
import { isAdmin } from '@/server/authz/policy'
import { listDepartments, listWebsites } from '@/server/services/websites'
import { BrandHeader } from '@/components/BrandHeader'
import { AdminShell } from '@/components/AdminShell'
import { DeployStudioApp } from '@/components/DeployStudioApp'
import type { MeDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const db = getDb()
  const session = await requirePageSession()
  const { actor } = session
  // Data is loaded through the same authorized services as the API (scoped by role + department).
  const [departments, websites] = await Promise.all([listDepartments(db, actor), listWebsites(db, actor)])
  const ownDept = departments.find((d) => d.id === actor.departmentId) ?? null
  const me: MeDTO = {
    user: { displayName: actor.displayName, email: actor.email, role: actor.role, department: ownDept },
    csrfToken: session.csrfToken,
  }
  const content = (
    <div className="shell">
      <BrandHeader user={{ csrfToken: session.csrfToken, label: `${actor.displayName}${ownDept ? ` · ${ownDept.name}` : ''}${isAdmin(actor) ? ' · Admin' : ''}` }} />
      <DeployStudioApp me={me} departments={departments} initialWebsites={websites} sitesHost={new URL(getConfig().SITES_BASE_URL).hostname} />
      <p className="footnote">Private static website hosting · Light / Dark · Drag &amp; Drop</p>
    </div>
  )
  return isAdmin(actor) ? <AdminShell active="deploy">{content}</AdminShell> : content
}
