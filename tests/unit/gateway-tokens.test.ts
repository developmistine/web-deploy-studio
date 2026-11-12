import { describe, expect, it } from 'vitest'
import { safeRelativePath, signGatewayToken, verifyGatewayToken } from '@/server/gateway/tokens'

const secret = 'unit-test-secret-0123456789abcdefghijkl'
const exp = Math.floor(Date.now() / 1000) + 60
const host = 'dtd-sales.sites.localhost'

describe('gateway tokens', () => {
  const t = signGatewayToken(secret, { t: 'c', h: host, sid: 's'.repeat(64), u: 'user-1', exp })

  it('verifies a valid token for the same host and type', () => {
    expect(verifyGatewayToken(secret, t, { type: 'c', host })).toMatchObject({ u: 'user-1' })
  })
  it('is bound to the host (no cross-department replay)', () => {
    expect(verifyGatewayToken(secret, t, { type: 'c', host: 'erp-inventory.sites.localhost' })).toBeNull()
  })
  it('is bound to the token type (handshake ≠ cookie)', () => {
    expect(verifyGatewayToken(secret, t, { type: 'h', host })).toBeNull()
  })
  it('rejects expired, tampered, and foreign-key tokens', () => {
    const old = signGatewayToken(secret, { t: 'c', h: host, sid: 's', u: 'u', exp: Math.floor(Date.now() / 1000) - 1 })
    expect(verifyGatewayToken(secret, old, { type: 'c', host })).toBeNull()
    const [body, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ v: 1, t: 'c', h: host, sid: 'x', u: 'admin', exp })).toString('base64url')
    expect(verifyGatewayToken(secret, `${forged}.${sig}`, { type: 'c', host })).toBeNull()
    expect(verifyGatewayToken('another-secret-0123456789abcdefghijk', t, { type: 'c', host })).toBeNull()
    expect(verifyGatewayToken(secret, `${body}.${sig}.x`, { type: 'c', host })).toBeNull()
    expect(verifyGatewayToken(secret, '', { type: 'c', host })).toBeNull()
  })
  it('only allows same-origin relative return paths', () => {
    expect(safeRelativePath('/reports?q=1')).toBe('/reports?q=1')
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', 'javascript:alert(1)', null]) expect(safeRelativePath(bad)).toBe('/')
  })
})
