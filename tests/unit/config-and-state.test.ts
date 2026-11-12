import { describe, expect, it } from 'vitest'
import { loadConfig, registrableDomain } from '@/server/config'
import { canTransition, TRANSITIONS } from '@/server/deployments/state'

const base = { ...process.env } as NodeJS.ProcessEnv

describe('configuration guards', () => {
  const prod = {
    ...base, NODE_ENV: 'production' as const, APP_URL: 'https://deploy.company.com', ALLOWED_EMAIL_DOMAINS: 'company.com',
    ARGON2_MEMORY_KIB: '19456', ARGON2_TIME_COST: '2',
    SITES_BASE_URL: 'https://sites.company-host.net', PREVIEW_BASE_URL: 'https://preview.company-preview.net',
  }
  it('production needs an email-domain allowlist (no open enrollment)', () => {
    expect(() => loadConfig(prod)).not.toThrow()
    expect(() => loadConfig({ ...prod, ALLOWED_EMAIL_DOMAINS: '' })).toThrow(/ALLOWED_EMAIL_DOMAINS/)
    expect(() => loadConfig({ ...prod, ALLOWED_EMAIL_DOMAINS: 'not a domain' })).toThrow(/ALLOWED_EMAIL_DOMAINS/)
  })
  it('production refuses Argon2id cost below the OWASP minimum', () => {
    expect(() => loadConfig({ ...prod, ARGON2_MEMORY_KIB: '4096' })).toThrow(/Argon2id/)
    expect(() => loadConfig({ ...prod, ARGON2_TIME_COST: '1' })).toThrow(/Argon2id/)
  })
  it('passwords shorter than 8 characters can never be configured', () => {
    expect(() => loadConfig({ ...base, PASSWORD_MIN_LENGTH: '6' })).toThrow(/PASSWORD_MIN_LENGTH/)
  })
  it('there is no development login switch any more', () => {
    const c = loadConfig({ ...base, DEV_AUTH_ENABLED: 'true' } as NodeJS.ProcessEnv) as unknown as Record<string, unknown>
    expect(c.DEV_AUTH_ENABLED).toBeUndefined()
  })
  it('requires hosted content on a different host / registrable domain than management in production', () => {
    expect(() => loadConfig({ ...prod, SITES_BASE_URL: 'https://sites.company.com', PREVIEW_BASE_URL: 'https://preview.other.net' })).toThrow(/registrable domain/)
    expect(() => loadConfig({ ...base, SITES_BASE_URL: 'http://localhost:9000', PREVIEW_BASE_URL: 'http://preview.localhost' })).toThrow(/management host/)
  })
  it('treats empty env values (KEY=) as unset', () => {
    expect(() => loadConfig({ ...base, UPLOAD_TMP_DIR: '', APP_ALLOWED_HOSTS: '' })).not.toThrow()
  })
  it('registrable domain heuristic handles ccSLDs', () => {
    expect(registrableDomain('a.b.company.co.th')).toBe('company.co.th')
    expect(registrableDomain('x.company.com')).toBe('company.com')
  })
})

describe('deployment state machine', () => {
  it('only allows the documented forward path and failure exits', () => {
    expect(canTransition('UPLOADED', 'VALIDATING')).toBe(true)
    expect(canTransition('PREVIEW_READY', 'DEPLOYING')).toBe(true)
    expect(canTransition('DEPLOYING', 'LIVE')).toBe(true)
    expect(canTransition('UPLOADED', 'LIVE')).toBe(false) // cannot skip validation/build/preview
    expect(canTransition('BUILDING', 'DEPLOYING')).toBe(false) // cannot skip preview
    expect(canTransition('FAILED', 'LIVE')).toBe(false)
    expect(TRANSITIONS.FAILED).toEqual([])
  })
})
