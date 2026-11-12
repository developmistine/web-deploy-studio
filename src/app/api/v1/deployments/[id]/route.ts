import { json, param, route } from '@/server/http/handler'
import { getDeployment } from '@/server/services/deployments'

export const dynamic = 'force-dynamic'

export const GET = route({}, async ({ db, actor, params }) => json({ deployment: await getDeployment(db, actor, param(params, 'id')) }))
