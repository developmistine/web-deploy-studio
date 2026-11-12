import { json, param, route } from '@/server/http/handler'
import { getDeploymentLogs } from '@/server/services/deployments'

export const dynamic = 'force-dynamic'

export const GET = route({}, async ({ db, actor, params }) => json({ logs: await getDeploymentLogs(db, actor, param(params, 'id')) }))
