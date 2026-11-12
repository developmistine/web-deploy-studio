import { describe, expect, it } from 'vitest'
import { hashPassword, needsRehash, passwordProblems, verifyPassword } from '@/server/auth/password'
import { emailDomain, isAllowedEmailDomain, normalizeEmail } from '@/server/auth/email'

describe('password hashing (Argon2id)', () => {
  it('stores an Argon2id PHC hash with a unique salt, never the password', async () => {
    const a = await hashPassword('correct horse battery staple 42')
    const b = await hashPassword('correct horse battery staple 42')
    expect(a).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/)
    expect(a).not.toBe(b) // random salt per hash
    expect(a).not.toContain('correct horse')
  })

  it('verifies the right password only', async () => {
    const h = await hashPassword('correct horse battery staple 42')
    expect(await verifyPassword(h, 'correct horse battery staple 42')).toBe(true)
    expect(await verifyPassword(h, 'correct horse battery staple 43')).toBe(false)
    expect(await verifyPassword(h, '')).toBe(false)
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false)
  })

  it('treats Unicode-equivalent input as the same password (NFKC)', async () => {
    const h = await hashPassword('ｆｕｌｌｗｉｄｔｈ passphrase 2026')
    expect(await verifyPassword(h, 'fullwidth passphrase 2026')).toBe(true)
  })

  it('missing hashes (unknown account / no password yet) never verify, but still do the work', async () => {
    expect(await verifyPassword(null, 'anything at all here')).toBe(false)
    expect(await verifyPassword(undefined, 'anything at all here')).toBe(false)
  })

  it('flags hashes created with weaker parameters for rehash', async () => {
    expect(needsRehash(await hashPassword('correct horse battery staple 42'))).toBe(false)
    expect(needsRehash('$argon2id$v=19$m=512,t=1,p=1$c2FsdA$aGFzaA')).toBe(true)
    expect(needsRehash('$2b$10$bcrypt-style')).toBe(true)
  })
})

describe('password policy (NIST-style: length + blocklist, no composition rules)', () => {
  const ctx = { email: 'somchai.k@test.example', displayName: 'Somchai Kittisak' }

  it('accepts 8+ characters with at least one letter and one digit (Thai letters count)', () => {
    expect(passwordProblems('correct horse battery staple 42', ctx)).toEqual([])
    expect(passwordProblems('maple4river', ctx)).toEqual([])
    expect(passwordProblems('ข้าวมันไก่9', ctx)).toEqual([])
  })

  it('requires at least 8 characters, one letter and one digit', () => {
    expect(passwordProblems('ab3', ctx)).toContain('TOO_SHORT')
    expect(passwordProblems('onlylettershere', ctx)).toEqual(['NEEDS_DIGIT'])
    expect(passwordProblems('20261112', ctx)).toContain('NEEDS_LETTER')
  })

  it('rejects very long input', () => {
    expect(passwordProblems('x'.repeat(129), ctx)).toContain('TOO_LONG')
  })

  it('rejects common passwords even when decorated', () => {
    expect(passwordProblems('Password123456789!', ctx)).toContain('COMMON')
    expect(passwordProblems('welcome2026!!!!!!', ctx)).toContain('COMMON')
    expect(passwordProblems('DeployStudio2026!!!', ctx)).toContain('COMMON')
  })

  it('rejects repetitive and sequential strings', () => {
    expect(passwordProblems('aaaaaaaaaaaaaaaaaa', ctx)).toContain('REPETITIVE')
    expect(passwordProblems('abcdefghijklmnopq', ctx)).toContain('REPETITIVE')
    expect(passwordProblems('123456789012345678', ctx)).toContain('REPETITIVE')
  })

  it('rejects passwords containing the user name or email', () => {
    expect(passwordProblems('somchai likes long passwords', ctx)).toContain('PERSONAL_INFO')
    expect(passwordProblems('my account is kittisak 2026', ctx)).toContain('PERSONAL_INFO')
  })
})

describe('corporate email identifiers', () => {
  it('normalizes case, width and whitespace', () => {
    expect(normalizeEmail('  Somchai.K@Test.Example ')).toBe('somchai.k@test.example')
    expect(normalizeEmail('ｓｏｍｃｈａｉ@test.example')).toBe('somchai@test.example')
  })
  it('rejects malformed or unusual addresses', () => {
    for (const bad of ['', 'no-at-sign', 'a@b', '"quoted"@test.example', 'a b@test.example', 'x@-bad.example', 'x@test..example', `${'a'.repeat(65)}@test.example`, 42]) {
      expect(normalizeEmail(bad), String(bad)).toBeNull()
    }
  })
  it('only allowlisted domains can be enrolled (subdomains are different domains)', () => {
    const allowed = new Set(['test.example'])
    expect(emailDomain('a@test.example')).toBe('test.example')
    expect(isAllowedEmailDomain('a@test.example', allowed)).toBe(true)
    expect(isAllowedEmailDomain('a@evil.example', allowed)).toBe(false)
    expect(isAllowedEmailDomain('a@sub.test.example', allowed)).toBe(false)
    expect(isAllowedEmailDomain('a@test.example.evil.com', allowed)).toBe(false)
  })
})
