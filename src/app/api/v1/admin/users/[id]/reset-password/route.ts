import { json, param, route } from '@/server/http/handler'
import { resetUserPassword } from '@/server/services/users'

export const dynamic = 'force-dynamic'

/** Issues a one-time reset link (shown once) and ends the user's sessions. */
export const POST = route({}, async ({ db, actor, params }) => json(await resetUserPassword(db, actor, param(params, 'id'))))
