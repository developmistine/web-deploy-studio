import { getDb } from '@/server/db'
import { getConfig } from '@/server/config'
import { resolveSession } from '@/server/auth/session'
import { canViewHost, handshakeUrl, normalizeHost, resolveHostTarget } from '@/server/gateway/access'
import { safeRelativePath } from '@/server/gateway/tokens'
import { audit } from '@/server/audit'
import { trackAuthzDenial } from '@/server/security-alerts'
import { clientIp } from '@/server/http/client-ip'
import { runWithContext, requestIdFrom } from '@/server/request-context'
import { sha256Hex } from '@/server/crypto'
import { statusPage } from '@/server/gateway/pages'

export const dynamic = 'force-dynamic'

/**
 * Management-origin step of the private website gateway.
 * A site/preview origin without a valid gateway cookie redirects the browser here (top-level navigation,
 * so the management session cookie is sent). We require a signed-in session (sign-in page if needed), check department
 * authorization server-side, then hand a 2-minute, host+session-bound token to that origin.
 */
export async function GET(req: Request): Promise<Response> {
  return runWithContext({ requestId: requestIdFrom(req), sourceIpHash: sha256Hex(clientIp(req)).slice(0, 16) }, async () => {
    const db = getDb()
    const cfg = getConfig()
    const url = new URL(req.url)
    const host = normalizeHost(url.searchParams.get('host'))
    const returnPath = safeRelativePath(url.searchParams.get('r'))
    if (!host) return statusPage(400, 'Invalid website address.')

    const session = await resolveSession(db, req.headers.get('cookie'))
    if (!session) {
      const back = `/api/gateway/authorize?host=${encodeURIComponent(host)}&r=${encodeURIComponent(returnPath)}`
      return Response.redirect(new URL(`/login?returnTo=${encodeURIComponent(back)}`, cfg.APP_URL), 303)
    }

    if (session.stage !== 'FULL') return Response.redirect(new URL('/account/password', cfg.APP_URL), 303)

    const target = await resolveHostTarget(db, host)
    if (!target) return statusPage(404, 'Website not found.')
    if (!canViewHost(session.actor, target)) {
      await audit(db, { action: 'GATEWAY_DENIED', actorUserId: session.actor.userId, departmentId: session.actor.departmentId, websiteId: target.websiteId, metadata: { kind: target.kind } })
      await trackAuthzDenial(db, session.actor.userId, session.actor.departmentId).catch(() => undefined)
      return statusPage(403, 'You are not authorized to view this department website.')
    }
    if (target.suspended) return statusPage(423, 'This website is suspended by an administrator.')
    if (!target.live) return statusPage(404, target.kind === 'preview' ? 'This preview has expired. Reopen it from Deploy Studio.' : 'This website has no live version yet.')

    await audit(db, {
      action: 'GATEWAY_SESSION_ISSUED',
      actorUserId: session.actor.userId,
      departmentId: target.departmentId,
      websiteId: target.websiteId,
      deploymentId: target.kind === 'preview' ? target.deploymentId : null,
      metadata: { kind: target.kind },
    })
    return new Response(null, {
      status: 303,
      headers: { location: handshakeUrl(target, session.sessionId, session.actor.userId, returnPath), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    })
  })
}
