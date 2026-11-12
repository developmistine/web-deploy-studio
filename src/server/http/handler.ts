import { ZodError } from 'zod'
import { getDb, type Db } from '@/server/db'
import { getConfig } from '@/server/config'
import { resolveSession, type Actor, type SessionContext } from '@/server/auth/session'
import type { SessionStage } from '@/generated/prisma/client'
import { AppError, isAppError } from '@/server/http/errors'
import { safeEqual, sha256Hex } from '@/server/crypto'
import { log } from '@/server/log'
import { audit } from '@/server/audit'
import { trackAuthzDenial } from '@/server/security-alerts'
import { clientIp } from '@/server/http/client-ip'
import { currentContext, requestIdFrom, runWithContext } from '@/server/request-context'

type Params = Record<string, string | string[] | undefined>

export type HandlerContext = {
  req: Request
  db: Db
  params: Params
  session: SessionContext | null
}
export type AuthedContext = HandlerContext & { session: SessionContext; actor: Actor }

type Options = {
  /** Default true. */
  auth?: boolean
  /** Enforces CSRF token + Origin. Default: true for non-GET/HEAD. */
  mutating?: boolean
  /**
   * Session stages this route accepts. Default FULL only; a PASSWORD_CHANGE session (must change password) may
   * only reach routes that opt in explicitly (me, change-password, logout).
   */
  stages?: ReadonlyArray<SessionStage>
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  // Management API responses are never readable cross-origin (no CORS headers are ever sent) and
  // must not be embedded/loaded by hosted-content origins.
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
}

export function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(JSON_HEADERS)
  const rid = currentContext()?.requestId
  if (rid) headers.set('x-request-id', rid)
  if (extraHeaders) new Headers(extraHeaders).forEach((v, k) => headers.append(k, v))
  return new Response(JSON.stringify(body), { status, headers })
}

export function errorResponse(e: AppError): Response {
  const headers: Record<string, string> = {}
  if (e.code === 'RATE_LIMITED' && typeof e.details?.retryAfterSeconds === 'number') headers['retry-after'] = String(e.details.retryAfterSeconds)
  return json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } }, e.status, headers)
}

/** Verifies the double-check CSRF defence: session-bound token header + same-origin Origin. */
export function checkCsrf(req: Request, session: SessionContext): void {
  const origin = req.headers.get('origin')
  if (!origin || origin !== getConfig().appOrigin) throw new AppError('CSRF_FAILED')
  const token = req.headers.get('x-csrf-token') ?? ''
  if (!token || !safeEqual(token, session.csrfToken)) throw new AppError('CSRF_FAILED')
}

/** Login-CSRF defence for unauthenticated POSTs (login, forgot/reset password): Origin must be our own. */
export function assertSameOrigin(req: Request): void {
  if (req.headers.get('origin') !== getConfig().appOrigin) throw new AppError('CSRF_FAILED')
}

/** Strict Host validation for the management app (prevents host-header poisoning of redirects/links). */
export function assertAllowedHost(req: Request): void {
  const cfg = getConfig()
  const host = (req.headers.get('host') ?? new URL(req.url).host).toLowerCase()
  const allowed = new Set([new URL(cfg.APP_URL).host.toLowerCase(), ...cfg.APP_ALLOWED_HOSTS.map((h) => h.toLowerCase())])
  if (!allowed.has(host)) throw new AppError('HOST_NOT_ALLOWED')
}

/**
 * Wraps every Route Handler: request correlation, Host validation, authentication, CSRF,
 * safe error mapping. Authorization is done inside services via src/server/authz/policy.ts (deny by default).
 */
export function route<A extends boolean = true>(
  opts: Options & { auth?: A },
  handler: (ctx: A extends false ? HandlerContext : AuthedContext) => Promise<Response>,
) {
  return (req: Request, routeCtx?: { params: Promise<Params> }): Promise<Response> =>
    runWithContext({ requestId: requestIdFrom(req), sourceIpHash: sha256Hex(clientIp(req)).slice(0, 16) }, () => handle(req, routeCtx))

  async function handle(req: Request, routeCtx?: { params: Promise<Params> }): Promise<Response> {
    const db = getDb()
    try {
      assertAllowedHost(req)
      const params = (await routeCtx?.params) ?? {}
      const needsAuth = opts.auth !== false
      const mutating = opts.mutating ?? !['GET', 'HEAD'].includes(req.method)
      const session = await resolveSession(db, req.headers.get('cookie'))
      if (needsAuth && !session) throw new AppError('UNAUTHENTICATED')
      if (needsAuth && session && !(opts.stages ?? ['FULL']).includes(session.stage)) throw new AppError('PASSWORD_CHANGE_REQUIRED')
      if (mutating && session) checkCsrf(req, session)
      if (mutating && !session && needsAuth) throw new AppError('UNAUTHENTICATED')
      const ctx = { req, db, params, session, actor: session?.actor } as A extends false ? HandlerContext : AuthedContext
      return await handler(ctx)
    } catch (e) {
      if (isAppError(e)) {
        if (e.code === 'DEPARTMENT_MISMATCH' || e.code === 'FORBIDDEN') {
          const s = await resolveSession(db, req.headers.get('cookie')).catch(() => null)
          await audit(db, {
            action: 'AUTHZ_DENIED',
            actorUserId: s?.actor.userId,
            metadata: { code: e.code, method: req.method, path: new URL(req.url).pathname },
          }).catch(() => undefined)
          if (s) await trackAuthzDenial(db, s.actor.userId, s.actor.departmentId).catch(() => undefined)
        }
        return errorResponse(e)
      }
      if (e instanceof ZodError) {
        return errorResponse(new AppError('VALIDATION_FAILED', { issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }))
      }
      log.error('api.unhandled', { path: new URL(req.url).pathname, method: req.method, error: e })
      return errorResponse(new AppError('INTERNAL'))
    }
  }
}

export function param(params: Params, name: string): string {
  const v = params[name]
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw new AppError('NOT_FOUND')
  return v
}

export async function readJson(req: Request, maxBytes = 16 * 1024): Promise<unknown> {
  const ct = req.headers.get('content-type') ?? ''
  if (!ct.toLowerCase().startsWith('application/json')) throw new AppError('UNSUPPORTED_MEDIA_TYPE')
  const text = await req.text()
  if (text.length > maxBytes) throw new AppError('PAYLOAD_TOO_LARGE')
  if (!text) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new AppError('VALIDATION_FAILED')
  }
}
