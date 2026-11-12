import type { Db } from '@/server/db'
import { getConfig } from '@/server/config'
import { resolveSessionById } from '@/server/auth/session'
import { parseCookies, serializeCookie } from '@/server/http/cookies'
import { safeEqual } from '@/server/crypto'
import { audit } from '@/server/audit'
import { log } from '@/server/log'
import { canViewHost, normalizeHost, resolveHostTarget, type HostTarget } from '@/server/gateway/access'
import { HANDSHAKE_PATH, safeRelativePath, signGatewayToken, verifyGatewayToken } from '@/server/gateway/tokens'
import { statusPage } from '@/server/gateway/pages'

/**
 * Forward-auth decision for hosted-content origins (Traefik `forwardAuth` → GET /api/internal/gate).
 * EVERY request to a site/preview origin — HTML, CSS, JS, images, fonts, JSON… — is decided here:
 *  1. Validate the requested host and map it to an approved department resource (unknown → 404).
 *  2. /__ds_auth?t=… handshake → verify token, session and authorization → set host-only cookie.
 *  3. Otherwise require the gateway cookie; re-validate the management session (expiry, revocation,
 *     deprovisioning) and department authorization on every request (short in-memory cache).
 *  4. Anything else → redirect to the management authorize endpoint (SSO) or deny. Never serve content.
 */

type Decision = { ok: boolean; until: number }
const cache = new Map<string, Decision>()
const CACHE_MS = 10_000
const CACHE_MAX = 5000

export function clearGateCache(): void {
  cache.clear()
}

function cookieName(secure: boolean) {
  return secure ? '__Host-ds_gw' : 'ds_gw'
}

function isSecureOrigin(target: HostTarget): boolean {
  const cfg = getConfig()
  const base = new URL(target.kind === 'site' ? cfg.SITES_BASE_URL : cfg.PREVIEW_BASE_URL)
  return base.protocol === 'https:' || base.hostname === 'localhost' || base.hostname.endsWith('.localhost')
}

/**
 * Absolute URL on the validated hosted origin. Relative redirects are NOT safe here: `next dev` (and some
 * proxies) resolve them against the internal upstream (http://web:3000), which breaks the handshake. The
 * scheme/port come from server configuration and the host from the already-validated target — never from
 * client input — so this cannot become an open redirect.
 */
function hostedUrl(target: HostTarget, host: string, path: string): string {
  const cfg = getConfig()
  const base = new URL(target.kind === 'site' ? cfg.SITES_BASE_URL : cfg.PREVIEW_BASE_URL)
  base.hostname = host
  return new URL(path, base.origin).toString()
}

async function sessionAllows(db: Db, target: HostTarget, sid: string, userId: string): Promise<{ ok: boolean; expiresAt?: Date; actorUserId?: string; departmentId?: string | null }> {
  const s = await resolveSessionById(db, sid, false)
  // Only fully signed-in sessions may view hosted content (not one that must still change its password).
  if (!s || s.actor.userId !== userId || s.stage !== 'FULL') return { ok: false }
  if (!canViewHost(s.actor, target)) return { ok: false, actorUserId: s.actor.userId, departmentId: s.actor.departmentId }
  const row = await db.session.findUnique({ where: { id: sid }, select: { expiresAt: true } })
  return { ok: true, expiresAt: row?.expiresAt, actorUserId: s.actor.userId }
}

export async function gateDecision(db: Db, req: Request): Promise<Response> {
  const cfg = getConfig()
  const host = normalizeHost(req.headers.get('x-forwarded-host'))
  if (!host) return statusPage(404, 'Unknown host.')
  let uri: URL
  try {
    uri = new URL(req.headers.get('x-forwarded-uri') ?? '/', 'http://gate.invalid')
  } catch {
    return statusPage(400, 'Bad request.')
  }

  const target = await resolveHostTarget(db, host)
  if (!target) return statusPage(404, 'Unknown host.')

  // Worker readiness probe through the proxy: only with the shared probe token, only the health path.
  if (uri.pathname === '/__ds_health') {
    const probe = req.headers.get('x-ds-probe') ?? ''
    return probe && safeEqual(probe, cfg.HEALTH_PROBE_TOKEN) ? new Response(null, { status: 200 }) : statusPage(403, 'Forbidden.')
  }

  if (target.suspended) return statusPage(423, 'This website is suspended by an administrator.')
  if (!target.live) return statusPage(404, target.kind === 'preview' ? 'This preview has expired.' : 'This website has no live version yet.')

  const secure = isSecureOrigin(target)
  const name = cookieName(secure)

  if (uri.pathname === HANDSHAKE_PATH) {
    const claims = verifyGatewayToken(cfg.GATEWAY_SIGNING_SECRET, uri.searchParams.get('t'), { type: 'h', host })
    if (!claims) return statusPage(401, 'Sign-in link expired. Open the website again.')
    const allowed = await sessionAllows(db, target, claims.sid, claims.u)
    if (!allowed.ok) return statusPage(403, 'You are not authorized to view this website.')
    const maxExp = Math.floor(Date.now() / 1000) + cfg.GATEWAY_COOKIE_MINUTES * 60
    const exp = Math.min(maxExp, Math.floor((allowed.expiresAt?.getTime() ?? Date.now()) / 1000))
    const cookie = signGatewayToken(cfg.GATEWAY_SIGNING_SECRET, { t: 'c', h: host, sid: claims.sid, u: claims.u, exp })
    const setCookie = serializeCookie(name, cookie, {
      httpOnly: true,
      secure,
      // Sites are visited top-level (Lax). Previews are embedded cross-site in Deploy Studio (None + CHIPS).
      sameSite: target.kind === 'preview' && secure ? 'None' : 'Lax',
      partitioned: target.kind === 'preview' && secure,
      maxAgeSeconds: exp - Math.floor(Date.now() / 1000),
    })
    return new Response(null, {
      status: 302,
      headers: { location: hostedUrl(target, host, safeRelativePath(uri.searchParams.get('r'))), 'set-cookie': setCookie, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
    })
  }

  const raw = parseCookies(req.headers.get('cookie')).get(name)
  const claims = verifyGatewayToken(cfg.GATEWAY_SIGNING_SECRET, raw, { type: 'c', host })
  if (claims) {
    const key = `${raw}|${host}`
    const hit = cache.get(key)
    if (hit && hit.until > Date.now()) return hit.ok ? new Response(null, { status: 200 }) : statusPage(403, 'You are not authorized to view this website.')
    const allowed = await sessionAllows(db, target, claims.sid, claims.u)
    if (cache.size > CACHE_MAX) cache.clear()
    cache.set(key, { ok: allowed.ok, until: Date.now() + CACHE_MS })
    if (allowed.ok) return new Response(null, { status: 200 })
    if (allowed.actorUserId) {
      await audit(db, { action: 'GATEWAY_DENIED', actorUserId: allowed.actorUserId, departmentId: allowed.departmentId, websiteId: target.websiteId, metadata: { kind: target.kind } }).catch(() => undefined)
      return statusPage(403, 'You are not authorized to view this website.')
    }
    // Session expired/revoked: fall through to re-authentication.
  }

  log.debug('gateway.redirect_to_authorize', { kind: target.kind })
  const authorize = new URL('/api/gateway/authorize', cfg.APP_URL)
  authorize.searchParams.set('host', host)
  authorize.searchParams.set('r', safeRelativePath(uri.pathname + uri.search))
  return new Response(null, { status: 302, headers: { location: authorize.toString(), 'cache-control': 'no-store' } })
}
