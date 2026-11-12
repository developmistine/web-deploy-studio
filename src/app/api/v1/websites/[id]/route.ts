import { json, param, readJson, route } from '@/server/http/handler'
import { getWebsite, renameWebsite } from '@/server/services/websites'

export const dynamic = 'force-dynamic'

export const GET = route({}, async ({ db, actor, params }) => json({ website: await getWebsite(db, actor, param(params, 'id')) }))

/** Rename the website (site name → hostname). Department members and admins; the old address stops working. */
export const PATCH = route({}, async ({ req, db, actor, params }) =>
  json({ website: await renameWebsite(db, actor, param(params, 'id'), await readJson(req)) }),
)
