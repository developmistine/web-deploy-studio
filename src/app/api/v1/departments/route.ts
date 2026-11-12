import { json, route } from '@/server/http/handler'
import { listDepartments } from '@/server/services/websites'

export const dynamic = 'force-dynamic'

export const GET = route({}, async ({ db, actor }) => json({ departments: await listDepartments(db, actor) }))
