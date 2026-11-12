import { json, readJson, route } from '@/server/http/handler'
import { createWebsite, listWebsites } from '@/server/services/websites'
import { listWebsitesQuerySchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

/** USER → only their department's website. ADMIN → all, `?department=DTD` filter supported. */
export const GET = route({}, async ({ req, db, actor }) => {
  const q = listWebsitesQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
  return json({ websites: await listWebsites(db, actor, { departmentCode: q.department }) })
})

/** Creates the department's single website (first deployment). */
export const POST = route({ mutating: true }, async ({ req, db, actor }) => {
  const website = await createWebsite(db, actor, await readJson(req))
  return json({ website }, 201)
})
