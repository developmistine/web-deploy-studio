import { json, param, readJson, route } from '@/server/http/handler'
import { rollback } from '@/server/services/deployments'
import { enforceRateLimit } from '@/server/rate-limit'
import { getConfig } from '@/server/config'

export const dynamic = 'force-dynamic'

/** Roll back to a known-good revision (body: { targetDeploymentId? }). Asynchronous: returns 202. */
export const POST = route({ mutating: true }, async ({ req, db, actor, params }) => {
  await enforceRateLimit(db, `promote:${actor.userId}`, getConfig().RATE_LIMIT_PROMOTIONS_PER_HOUR, 3600)
  const deployment = await rollback(db, actor, param(params, 'id'), await readJson(req))
  return json({ deployment }, 202)
})
