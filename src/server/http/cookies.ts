export function parseCookies(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!header) return out
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const name = part.slice(0, idx).trim()
    const raw = part.slice(idx + 1).trim()
    if (!name || out.has(name)) continue
    try {
      out.set(name, decodeURIComponent(raw))
    } catch {
      // ignore malformed cookie values
    }
  }
  return out
}

export type CookieOptions = {
  maxAgeSeconds?: number
  path?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Lax' | 'Strict' | 'None'
  partitioned?: boolean
}

export function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`]
  if (o.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(o.maxAgeSeconds))}`)
  if (o.httpOnly ?? true) parts.push('HttpOnly')
  if (o.secure) parts.push('Secure')
  parts.push(`SameSite=${o.sameSite ?? 'Lax'}`)
  if (o.partitioned) parts.push('Partitioned')
  return parts.join('; ')
}
