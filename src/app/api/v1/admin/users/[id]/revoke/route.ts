import { json, param, route } from '@/server/http/handler'
import { revokeUser } from '@/server/services/users'

export const dynamic = 'force-dynamic'

/** "Remove" an enrollment: soft revocation (history preserved). */
export const POST = route({}, async ({ db, actor, params }) => json({ user: await revokeUser(db, actor, param(params, 'id')) }))
