import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/server/db'
import { resetConfigCache } from '@/server/config'
import * as websites from '@/app/api/v1/websites/route'
import * as me from '@/app/api/v1/me/route'
import * as logout from '@/app/api/v1/auth/logout/route'
import { revokeUserSessions } from '@/server/auth/session'
import { call, login, resetDb } from '../helpers/app'

beforeEach(resetDb)
afterEach(() => {
  delete process.env.APP_ALLOWED_HOSTS
  resetConfigCache()
})

describe('sessions', () => {
  it('expired sessions are rejected', async () => {
    const s = await login('dtd-user')
    await getDb().session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await call(me.GET, { path: '/api/v1/me', session: s })).status).toBe(401)
  })

  it('idle sessions are rejected', async () => {
    const s = await login('dtd-user')
    await getDb().session.updateMany({ data: { lastSeenAt: new Date(Date.now() - 2 * 3600_000) } })
    expect((await call(me.GET, { path: '/api/v1/me', session: s })).status).toBe(401)
  })

  it('revoked sessions are rejected', async () => {
    const s = await login('dtd-user')
    const u = await getDb().user.findFirstOrThrow()
    await revokeUserSessions(getDb(), u.id)
    expect((await call(me.GET, { path: '/api/v1/me', session: s })).status).toBe(401)
  })

  it('deprovisioned (disabled) users lose access immediately', async () => {
    const s = await login('dtd-user')
    await getDb().user.updateMany({ data: { status: 'DISABLED', disabledAt: new Date() } })
    expect((await call(me.GET, { path: '/api/v1/me', session: s })).status).toBe(401)
    expect(await getDb().session.count()).toBe(0)
  })

  it('logout destroys the server session', async () => {
    const s = await login('dtd-user')
    expect((await call(logout.POST, { path: '/api/v1/auth/logout', session: s, body: {} })).status).toBe(200)
    expect((await call(me.GET, { path: '/api/v1/me', session: s })).status).toBe(401)
  })

  it('forged session cookies are rejected', async () => {
    const r = await call(me.GET, { path: '/api/v1/me', session: { cookie: 'ds_session=' + 'A'.repeat(43), csrf: 'x', identity: 'admin', userId: 'x' } })
    expect(r.status).toBe(401)
  })
})

describe('CSRF protection on state-changing endpoints', () => {
  it('rejects a missing CSRF token', async () => {
    const s = await login('dtd-user')
    const r = await call(websites.POST, { path: '/api/v1/websites', session: s, body: { siteName: 'x1' }, csrf: null })
    expect(r.status).toBe(403)
    expect(r.json.error.code).toBe('CSRF_FAILED')
  })
  it('rejects a wrong CSRF token (e.g. from another session)', async () => {
    const a = await login('dtd-user')
    const b = await login('erp-user')
    expect((await call(websites.POST, { path: '/api/v1/websites', session: a, body: { siteName: 'x1' }, csrf: b.csrf })).status).toBe(403)
  })
  it('rejects cross-origin requests even with a valid token', async () => {
    const s = await login('dtd-user')
    expect((await call(websites.POST, { path: '/api/v1/websites', session: s, body: { siteName: 'x1' }, origin: 'https://evil.example' })).status).toBe(403)
    expect((await call(websites.POST, { path: '/api/v1/websites', session: s, body: { siteName: 'x1' }, origin: 'http://dtd-x.sites.localhost:8080' })).status).toBe(403)
  })
  it('API responses never include CORS allowances', async () => {
    const s = await login('dtd-user')
    const r = await call(me.GET, { path: '/api/v1/me', session: s, headers: { origin: 'http://dtd-x.sites.localhost:8080' } })
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
    expect(r.headers.get('cross-origin-resource-policy')).toBe('same-origin')
  })
})

describe('host validation', () => {
  it('rejects unexpected Host headers', async () => {
    const s = await login('dtd-user')
    const r = await call(me.GET, { path: '/api/v1/me', session: s, headers: { host: 'evil.example' } })
    expect(r.status).toBe(421)
  })

})
