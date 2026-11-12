import { z } from 'zod'

/** Same rule as the prototype: a-z, 0-9, hyphen; no leading/trailing hyphen; max 48. Plus: no "--". */
export const SITE_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/

export const siteNameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(SITE_NAME_RE, 'Use a-z, 0-9 and "-" only; must not start or end with "-".')
  .refine((s) => !s.includes('--'), 'Consecutive hyphens are not allowed.')

export function isValidSiteName(value: string): boolean {
  return siteNameSchema.safeParse(value).success
}

export const uuidSchema = z.string().regex(/^[0-9a-f-]{36}$/i)

/** Normalized department key: hostname-safe, lowercase, 2–32 chars. */
export const DEPARTMENT_CODE_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/

/**
 * Normalizes a free-text department label ("Sales Ops", "ERP") into its unique key ("sales-ops", "erp").
 * Returns null when it cannot be made hostname-safe (we reject rather than silently strip characters).
 * NOTE: normalization only identifies a department — it never grants membership.
 */
export function normalizeDepartmentCode(input: string): string | null {
  const s = input.normalize('NFKC').trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (!DEPARTMENT_CODE_RE.test(s) || s.includes('--')) return null
  return s
}

export const departmentLabelSchema = z.string().trim().min(2).max(100)

/** Body of POST /api/v1/websites. `.strict()` makes unknown fields (e.g. role, userId) fail validation. */
export const createWebsiteSchema = z
  .object({
    /** Free-text department label. For USER it must match their trusted membership. */
    department: departmentLabelSchema.optional(),
    siteName: siteNameSchema,
  })
  .strict()

export const rollbackSchema = z.object({ targetDeploymentId: uuidSchema.optional() }).strict()

export const emptyBodySchema = z.object({}).strict()

export const listWebsitesQuerySchema = z.object({ department: z.string().max(100).optional() })

// ---------------------------------------------------------------- accounts & enrollment
/** Bounded so a huge body cannot make Argon2 work on megabytes; real policy is enforced server-side. */
const passwordInput = z.string().min(1).max(512)

export const loginSchema = z.object({ email: z.string().trim().min(3).max(320), password: passwordInput }).strict()
export const changePasswordSchema = z.object({ currentPassword: passwordInput, newPassword: passwordInput }).strict()
export const reauthSchema = z.object({ password: passwordInput }).strict()
export const forgotPasswordSchema = z.object({ email: z.string().trim().min(3).max(320) }).strict()
export const resetPasswordSchema = z.object({ token: z.string().min(40).max(64), newPassword: passwordInput }).strict()

const roleSchema = z.enum(['ADMIN', 'USER'])
const displayNameSchema = z.string().trim().min(1).max(200)

export const createUserSchema = z
  .object({
    displayName: displayNameSchema,
    email: z.string().trim().min(3).max(320),
    /** Free-text department label (ADMIN-trusted). Required for USER. */
    department: z.string().trim().max(100).optional(),
    role: roleSchema,
  })
  .strict()

export const updateUserSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    /** Free-text label; null removes the department (ADMIN only). */
    department: z.string().trim().max(100).nullable().optional(),
    role: roleSchema.optional(),
    status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'No changes')

export const listUsersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  department: z.string().trim().max(32).optional(),
  role: roleSchema.optional(),
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED', 'REVOKED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
})

/** Body of PATCH /api/v1/websites/:id — rename the department's website (changes its hostname). */
export const renameWebsiteSchema = z.object({ siteName: siteNameSchema }).strict()
