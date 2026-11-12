import { hmac, safeEqual } from '@/server/crypto'

/**
 * Signed gateway tokens for hosted-content origins (production sites and previews).
 *  - t='h' handshake: 2-minute token carried in the /__ds_auth URL from the management origin.
 *  - t='c' cookie:    stored as a host-only cookie on that one site/preview origin.
 * Both are bound to the exact host, the management session id (hash) and the user, so they cannot be
 * replayed on another department's host, and they die with the session (checked on every request).
 * They carry no corporate access/refresh tokens.
 */
export type GatewayClaims = { v: 1; t: 'h' | 'c'; h: string; sid: string; u: string; exp: number }

const PREFIX = 'gw.v1.'

export function signGatewayToken(secret: string, claims: Omit<GatewayClaims, 'v'>): string {
  const body = Buffer.from(JSON.stringify({ v: 1, ...claims })).toString('base64url')
  return `${body}.${hmac(secret, PREFIX + body)}`
}

export function verifyGatewayToken(
  secret: string,
  token: string | null | undefined,
  expect: { type: 'h' | 'c'; host: string },
  now = Date.now(),
): GatewayClaims | null {
  if (!token || token.length > 1000) return null
  const [body, sig, extra] = token.split('.')
  if (!body || !sig || extra !== undefined) return null
  if (!safeEqual(sig, hmac(secret, PREFIX + body))) return null
  let c: GatewayClaims
  try {
    c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as GatewayClaims
  } catch {
    return null
  }
  if (c.v !== 1 || c.t !== expect.type || c.h !== expect.host) return null
  if (typeof c.sid !== 'string' || typeof c.u !== 'string' || typeof c.exp !== 'number') return null
  if (c.exp * 1000 <= now) return null
  return c
}

/** Only same-origin relative paths are allowed as post-handshake destinations. */
export function safeRelativePath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || /[\u0000-\u001f]/.test(raw)) return '/'
  return raw.slice(0, 1000)
}

export const HANDSHAKE_PATH = '/__ds_auth'
export const HANDSHAKE_SECONDS = 120
