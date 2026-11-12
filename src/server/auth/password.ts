import { hash, verify } from '@node-rs/argon2'
import { getConfig } from '@/server/config'
import { COMMON_PASSWORDS } from '@/server/auth/common-passwords'

/**
 * Password storage and policy (docs/security/password-security.md).
 *  - Argon2id (@node-rs/argon2) with a per-hash random salt; cost from ARGON2_* (OWASP minimum enforced in production).
 *  - Inputs are NFKC-normalized before hashing so the same passphrase typed on different keyboards verifies.
 *  - Policy (owner decision 2026-11-12): ≥ 8 characters with at least one letter and one digit, plus blocklist,
 *    repetition and personal-info checks. No forced rotation.
 */

export const PASSWORD_MAX_LENGTH = 128

function argonOptions() {
  const c = getConfig()
  // 2 = Algorithm.Argon2id (a const enum in @node-rs/argon2, not importable under isolatedModules).
  return { algorithm: 2 as const, memoryCost: c.ARGON2_MEMORY_KIB, timeCost: c.ARGON2_TIME_COST, parallelism: c.ARGON2_PARALLELISM }
}

const normalize = (pw: string) => pw.normalize('NFKC')

export async function hashPassword(password: string): Promise<string> {
  return hash(normalize(password), argonOptions())
}

let dummyHash: Promise<string> | null = null

/**
 * Constant-work verification: when there is no stored hash (unknown account, account without a password)
 * we still verify against a dummy hash so response timing does not reveal whether the account exists.
 */
export async function verifyPassword(stored: string | null | undefined, password: string): Promise<boolean> {
  const candidate = normalize(password).slice(0, PASSWORD_MAX_LENGTH * 4)
  if (!stored) {
    dummyHash ??= hash('deploy-studio-dummy-password-for-timing', argonOptions())
    await verify(await dummyHash, candidate).catch(() => false)
    return false
  }
  try {
    return await verify(stored, candidate)
  } catch {
    return false
  }
}

/** True when a stored hash uses weaker parameters than the current configuration (rehash after login). */
export function needsRehash(stored: string): boolean {
  const o = argonOptions()
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(stored)
  if (!m) return true
  return Number(m[1]) < o.memoryCost || Number(m[2]) < o.timeCost || Number(m[3]) !== o.parallelism
}

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'NEEDS_LETTER' | 'NEEDS_DIGIT' | 'COMMON' | 'PERSONAL_INFO' | 'REPETITIVE'

const SEQUENCES = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiopasdfghjklzxcvbnm', '1qaz2wsx3edc4rfv']

/** Server-side policy check. Returns every problem (empty = acceptable). Never logs the password. */
export function passwordProblems(password: string, context: { email?: string | null; displayName?: string | null } = {}): PasswordProblem[] {
  const pw = normalize(password)
  const problems: PasswordProblem[] = []
  const length = [...pw].length // code points, so passphrases in Thai count correctly
  if (length < getConfig().PASSWORD_MIN_LENGTH) problems.push('TOO_SHORT')
  if (length > PASSWORD_MAX_LENGTH) problems.push('TOO_LONG')
  // Owner policy (2026-11-12): at least one letter (any script, incl. Thai) and one digit.
  if (!/\p{L}/u.test(pw)) problems.push('NEEDS_LETTER')
  if (!/\p{Nd}/u.test(pw)) problems.push('NEEDS_DIGIT')

  const lower = pw.toLowerCase()
  const compact = lower.replace(/[\s_.-]+/g, '')
  // Common base words with decoration stripped ("Password123456!" → "password").
  const base = compact.replace(/[^a-z฀-๿]+$/u, '').replace(/^[^a-z฀-๿]+/u, '')
  if (COMMON_PASSWORDS.has(compact) || (base.length > 0 && COMMON_PASSWORDS.has(base))) problems.push('COMMON')

  if (new Set(compact).size <= 3 || SEQUENCES.some((s) => s.includes(compact) || (s + s).includes(compact))) problems.push('REPETITIVE')

  const personal: string[] = []
  if (context.email) {
    const local = context.email.toLowerCase().split('@')[0] ?? ''
    personal.push(local, ...local.split(/[._+-]+/))
  }
  if (context.displayName) personal.push(...context.displayName.toLowerCase().split(/\s+/))
  if (personal.some((p) => p.length >= 4 && compact.includes(p.replace(/[\s_.-]+/g, '')))) problems.push('PERSONAL_INFO')

  return [...new Set(problems)]
}
