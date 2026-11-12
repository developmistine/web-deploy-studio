import { getConfig } from '@/server/config'

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/

/**
 * Canonical login identifier: Unicode NFKC, trimmed, lower-cased, restricted to a conservative ASCII
 * address form (no quoted local parts, no IDN homographs). Returns null when it is not an acceptable address.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.normalize('NFKC').trim().toLowerCase()
  if (v.length > 254 || !EMAIL_RE.test(v)) return null
  return v
}

export function emailDomain(normalized: string): string {
  return normalized.slice(normalized.lastIndexOf('@') + 1)
}

/**
 * Only corporate domains may be enrolled. NOTE: an allowed domain does NOT prove mailbox ownership — accounts
 * exist only through admin enrollment and are activated with a one-time link handed over internally.
 */
export function isAllowedEmailDomain(normalized: string, allowed: Set<string> = getConfig().allowedEmailDomains): boolean {
  return allowed.has(emailDomain(normalized))
}
