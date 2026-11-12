import { json, param, route } from '@/server/http/handler'
import { openPreview } from '@/server/services/deployments'

export const dynamic = 'force-dynamic'

/** Returns a short-lived launch URL for the isolated preview origin (or restarts an expired preview). */
export const POST = route({ mutating: true }, async ({ db, actor, session, params }) =>
  json({ preview: await openPreview(db, actor, param(params, 'id'), session.sessionId) }),
)
