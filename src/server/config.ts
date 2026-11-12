import { z } from 'zod'

/**
 * Central, validated configuration for the web app (and shared parts used by the worker).
 * Read lazily so `next build` does not require runtime secrets.
 */

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1')

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )

const intWithDefault = (def: number, min = 1, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max).default(def)

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),

  // --- Accounts (local email/password; ADR 0002) ---
  /** Corporate email domains that may be enrolled (comma separated, e.g. "company.com"). Required. */
  ALLOWED_EMAIL_DOMAINS: csv,
  /** Owner decision (2026-11-12): 8 characters + at least one letter and one digit. Never below 8. */
  PASSWORD_MIN_LENGTH: intWithDefault(8, 8, 64),
  /** Argon2id cost. OWASP minimum: m=19456 KiB, t=2, p=1 (production refuses lower values). */
  ARGON2_MEMORY_KIB: intWithDefault(19456, 1024, 1024 * 1024),
  ARGON2_TIME_COST: intWithDefault(2, 1, 20),
  ARGON2_PARALLELISM: intWithDefault(1, 1, 8),
  /** Lifetime of one-time password SETUP/RESET links handed over by an admin. */
  PASSWORD_LINK_TTL_HOURS: intWithDefault(24, 1, 168),
  /** Sensitive admin actions and cross-department production changes need a password check newer than this. */
  ADMIN_STEP_UP_MAX_AGE_MINUTES: z.coerce.number().int().min(0).max(24 * 60).default(15),

  // --- Sessions ---
  SESSION_TTL_HOURS: intWithDefault(8, 1, 24),
  SESSION_IDLE_MINUTES: intWithDefault(60, 5, 24 * 60),

  // --- Storage & uploads ---
  STORAGE_ROOT: z.string().default('./data/storage'),
  UPLOAD_TMP_DIR: z.string().optional(),
  UPLOAD_MAX_ARCHIVE_MB: intWithDefault(50, 1, 1024),
  UPLOAD_MAX_FILES: intWithDefault(2000, 1, 100_000),
  UPLOAD_MAX_EXTRACTED_MB: intWithDefault(200, 1, 4096),
  UPLOAD_MAX_FILE_MB: intWithDefault(25, 1, 1024),
  UPLOAD_MAX_RATIO: intWithDefault(100, 2, 10_000),

  // --- Public origins (must differ from APP_URL's origin) ---
  SITES_BASE_URL: z.url(),
  PREVIEW_BASE_URL: z.url(),
  /** HMAC key for gateway tokens on site/preview origins (>= 32 chars, from a secret store). */
  GATEWAY_SIGNING_SECRET: z.string().min(32),
  /** Shared with the worker: lets its proxy health probe reach /__ds_health through the gateway. */
  HEALTH_PROBE_TOKEN: z.string().min(24),
  PREVIEW_TTL_MINUTES: intWithDefault(120, 5, 24 * 60),
  /** Lifetime of the gateway cookie on site/preview origins (re-validated against the session on every request). */
  GATEWAY_COOKIE_MINUTES: intWithDefault(60, 1, 24 * 60),
  /** Production: refuse to start if hosted-content origins share the management registrable domain. */
  REQUIRE_SEPARATE_SITE_DOMAINS: bool,
  /** Optional extra Host values accepted by the management app (comma separated). */
  APP_ALLOWED_HOSTS: csv,

  // --- Rate limits (per user per hour) ---
  RATE_LIMIT_UPLOADS_PER_HOUR: intWithDefault(30),
  RATE_LIMIT_PROMOTIONS_PER_HOUR: intWithDefault(30),
  /** Failed sign-ins per client IP per 10 minutes. */
  RATE_LIMIT_LOGINS_PER_10MIN: intWithDefault(30),
  /** Failed sign-ins per account per 15 minutes (credential stuffing / targeted guessing). */
  RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT: intWithDefault(8, 3, 100),
})

export type AppConfig = z.infer<typeof schema> & {
  appOrigin: string
  secureCookies: boolean
  allowedEmailDomains: Set<string>
}

let cached: AppConfig | null = null

/** `KEY=` in an env file means "not set" (common in .env templates), not an empty value. */
export function withoutEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== '')) as NodeJS.ProcessEnv
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(withoutEmpty(env))
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    // Never echo values — they may be secrets.
    throw new Error(`Invalid configuration: ${fields}`)
  }
  const c = parsed.data
  const allowedEmailDomains = new Set(c.ALLOWED_EMAIL_DOMAINS.map((d) => d.toLowerCase().replace(/^@/, '')))
  for (const d of allowedEmailDomains) {
    if (!/^(?=.{3,253}$)[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new Error('ALLOWED_EMAIL_DOMAINS contains an invalid domain')
  }
  if (c.NODE_ENV === 'production') {
    if (!allowedEmailDomains.size) throw new Error('ALLOWED_EMAIL_DOMAINS is required in production')
    if (c.ARGON2_MEMORY_KIB < 19456 || c.ARGON2_TIME_COST < 2) throw new Error('Argon2id cost below the OWASP minimum in production')
  }
  const appOrigin = new URL(c.APP_URL).origin
  const appHost = new URL(c.APP_URL).hostname
  for (const [name, url] of [
    ['SITES_BASE_URL', c.SITES_BASE_URL],
    ['PREVIEW_BASE_URL', c.PREVIEW_BASE_URL],
  ] as const) {
    const host = new URL(url).hostname
    if (host === appHost || appHost.endsWith(`.${host}`)) {
      throw new Error(`${name} must not contain the management host (untrusted content isolation)`)
    }
    if ((c.REQUIRE_SEPARATE_SITE_DOMAINS || c.NODE_ENV === 'production') && registrableDomain(host) === registrableDomain(appHost)) {
      throw new Error(`${name} must use a different registrable domain than APP_URL in production`)
    }
  }
  return {
    ...c,
    appOrigin,
    secureCookies: new URL(c.APP_URL).protocol === 'https:',
    allowedEmailDomains,
  }
}

/**
 * Approximate registrable domain (last two labels). Deliberately conservative; multi-label public
 * suffixes such as co.th must be validated during deployment review (see docs/security/domain-isolation.md).
 */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean)
  if (labels.length >= 3 && labels[labels.length - 2]!.length <= 3 && labels[labels.length - 1]!.length === 2) return labels.slice(-3).join('.')
  return labels.slice(-2).join('.')
}

export function getConfig(): AppConfig {
  cached ??= loadConfig()
  return cached
}

/** Tests only. */
export function resetConfigCache(): void {
  cached = null
}

export const MB = 1024 * 1024
