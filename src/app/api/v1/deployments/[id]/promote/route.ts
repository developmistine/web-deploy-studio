import { json, param, route } from '@/server/http/handler'
import { promote } from '@/server/services/deployments'
import { enforceRateLimit } from '@/server/rate-limit'
import { getConfig } from '@/server/config'

export const dynamic = 'force-dynamic'

/** Request production release. Asynchronous (202); poll GET /deployments/:id. Idempotent by state. */
export const POST = route({ mutating: true }, async ({ db, actor, params }) => {
  await enforceRateLimit(db, `promote:${actor.userId}`, getConfig().RATE_LIMIT_PROMOTIONS_PER_HOUR, 3600)
  return json({ deployment: await promote(db, actor, param(params, 'id')) }, 202)
})
