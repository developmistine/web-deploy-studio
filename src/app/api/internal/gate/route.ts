import { getDb } from '@/server/db'
import { gateDecision } from '@/server/gateway/gate'
import { statusPage } from '@/server/gateway/pages'
import { log } from '@/server/log'

export const dynamic = 'force-dynamic'

/**
 * Reverse-proxy forward-auth endpoint for site and preview origins. Reached only from the proxy on the
 * internal network; the edge router must not expose /api/internal/* publicly (infra/traefik/dynamic).
 * Fails closed: any error denies.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    return await gateDecision(getDb(), req)
  } catch (e) {
    log.error('gateway.error', { error: e })
    return statusPage(503, 'Temporarily unavailable.')
  }
}
