import { json, param, readJson, route } from '@/server/http/handler'
import { getUser, updateUser } from '@/server/services/users'

export const dynamic = 'force-dynamic'

export const GET = route({}, async ({ db, actor, params }) => json({ user: await getUser(db, actor, param(params, 'id')) }))

/** Display name, department, role, status (ACTIVE/DISABLED). Email changes are not supported. */
export const PATCH = route({}, async ({ req, db, actor, params }) =>
  json({ user: await updateUser(db, actor, param(params, 'id'), await readJson(req)) }),
)
