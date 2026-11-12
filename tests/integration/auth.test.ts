import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/server/db'
import { getConfig } from '@/server/config'
import { sha256Hex } from '@/server/crypto'
import * as me from '@/app/api/v1/me/route'
import * as websites from '@/app/api/v1/websites/route'
import * as changePassword from '@/app/api/v1/auth/change-password/route'
import * as reauth from '@/app/api/v1/auth/reauth/route'
import * as forgot from '@/app/api/v1/auth/forgot-password/route'
import * as resetPassword from '@/app/api/v1/auth/reset-password/route'
import { issuePasswordLink } from '@/server/auth/password-links'
import { APP, call, ensureFixture, FIXTURE_PASSWORD, FIXTURES, login, loginRequest, resetDb, type Session } from '../helpers/app'

beforeEach(resetDb)

const sessionFrom = async (res: Response, identity: Session['identity'], userId: string): Promise<Session> => ({
  cookie: (res.headers.get('set-cookie') ?? '').split(';')[0]!,
  csrf: ((await res.json()) as { csrfToken: string }).csrfToken,
  identity,
  userId,
})
const linkToken = (url: string) => new URL(url).hash.replace('#token=', '')

describe('login', () => {
  it('valid credentials create a session; the response never contains the hash', async () => {
    await ensureFixture('dtd-user')
    const res = await loginRequest(FIXTURES['dtd-user'].email, FIXTURE_PASSWORD)
    expect(res.status).toBe(200)
    const text = await res.clone().text()
    expect(text).not.toMatch(/argon2|passwordHash/i)
    expect(res.headers.get('set-cookie')).toMatch(/^ds_session=[^;]+;.*HttpOnly;.*SameSite=Lax/i)
    const s = await sessionFrom(res, 'dtd-user', '')
    const r = await call(me.GET, { path: '/api/v1/me', session: s })
    expect(r.status).toBe(200)
    expect(JSON.stringify(r.json)).not.toMatch(/argon2|passwordHash/i)
    expect(await getDb().auditLog.count({ where: { action: 'LOGIN' } })).toBe(1)
  })

  it('email is case/whitespace-insensitive', async () => {
    await ensureFixture('dtd-user')
    expect((await loginRequest('  DTD1@Test.Example ', FIXTURE_PASSWORD)).status).toBe(200)
  })

  it('wrong password, unknown, disabled, revoked and not-yet-activated accounts all get the same generic answer', async () => {
    const id = await ensureFixture('dtd-user')
    const db = getDb()
    const bodies: string[] = []
    const attempt = async (email: string, password: string) => {
      const r = await loginRequest(email, password)
      expect(r.status).toBe(401)
      bodies.push(JSON.stringify((await r.json()).error))
    }
    await attempt(FIXTURES['dtd-user'].email, 'wrong password for this account')
    await attempt('nobody@test.example', FIXTURE_PASSWORD)
    await db.user.update({ where: { id }, data: { status: 'DISABLED' } })
    await attempt(FIXTURES['dtd-user'].email, FIXTURE_PASSWORD)
    await db.user.update({ where: { id }, data: { status: 'INVITED' } })
    await attempt(FIXTURES['dtd-user'].email, FIXTURE_PASSWORD)
    await db.user.update({ where: { id }, data: { status: 'REVOKED', activeEmail: null } })
    await attempt(FIXTURES['dtd-user'].email, FIXTURE_PASSWORD)
    expect(new Set(bodies).size).toBe(1)
    expect(JSON.parse(bodies[0]!).code).toBe('INVALID_CREDENTIALS')
    expect(await db.session.count()).toBe(0)
    expect(await db.auditLog.count({ where: { action: 'LOGIN_DENIED' } })).toBe(5)
  })

  it('locks an account after repeated failures — even the right password — and alerts', async () => {
    await ensureFixture('dtd-user')
    const limit = getConfig().RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT
    for (let i = 0; i < limit; i++) expect((await loginRequest(FIXTURES['dtd-user'].email, `wrong guess number ${i}`)).status).toBe(401)
    const locked = await loginRequest(FIXTURES['dtd-user'].email, FIXTURE_PASSWORD)
    expect(locked.status).toBe(429)
    expect(await getDb().session.count()).toBe(0)
    expect(await getDb().auditLog.count({ where: { action: 'SECURITY_ALERT' } })).toBeGreaterThanOrEqual(1)
  })

  it('throttles one client trying many accounts (credential stuffing)', async () => {
    const limit = getConfig().RATE_LIMIT_LOGINS_PER_10MIN
    for (let i = 0; i < limit; i++) await loginRequest(`victim${i}@test.example`, 'password guess here!!')
    expect((await loginRequest('another@test.example', 'password guess here!!')).status).toBe(429)
  })

  it('requires our Origin (login CSRF)', async () => {
    await ensureFixture('dtd-user')
    expect((await loginRequest(FIXTURES['dtd-user'].email, FIXTURE_PASSWORD, { origin: 'https://evil.example' })).status).toBe(403)
  })

  it('rejects unknown fields and oversized passwords', async () => {
    const r = await loginRequest(FIXTURES['dtd-user'].email, 'x'.repeat(600))
    expect(r.status).toBe(400)
  })
})

describe('must-change-password stage', () => {
  it('a session that must change its password can only reach me / change-password / logout', async () => {
    const id = await ensureFixture('dtd-user')
    await getDb().user.update({ where: { id }, data: { mustChangePassword: true } })
    const res = await loginRequest(FIXTURES['dtd-user'].email, FIXTURE_PASSWORD)
    const body = await res.clone().json()
    expect(body.stage).toBe('PASSWORD_CHANGE')
    const s = await sessionFrom(res, 'dtd-user', id)
    expect((await call(me.GET, { path: '/api/v1/me', session: s })).json.stage).toBe('PASSWORD_CHANGE')
    const blocked = await call(websites.GET, { path: '/api/v1/websites', session: s })
    expect(blocked.status).toBe(403)
    expect(blocked.json.error.code).toBe('PASSWORD_CHANGE_REQUIRED')

    const ch = await call(changePassword.POST, { path: '/api/v1/auth/change-password', session: s, body: { currentPassword: FIXTURE_PASSWORD, newPassword: 'a brand new long passphrase 77' } })
    expect(ch.status).toBe(200)
    expect((await getDb().user.findUniqueOrThrow({ where: { id } })).mustChangePassword).toBe(false)
  })
})

describe('change password', () => {
  it('rotates sessions, the old password stops working, and policy is enforced server-side', async () => {
    const a = await login('dtd-user')
    const other = await login('dtd-user') // a second device
    const weak = await call(changePassword.POST, { path: '/api/v1/auth/change-password', session: a, body: { currentPassword: FIXTURE_PASSWORD, newPassword: 'password12345678' } })
    expect(weak.status).toBe(422)
    expect(weak.json.error.code).toBe('PASSWORD_POLICY')
    expect(weak.json.error.details.problems).toContain('COMMON')

    const wrong = await call(changePassword.POST, { path: '/api/v1/auth/change-password', session: a, body: { currentPassword: 'not my password at all', newPassword: 'a brand new long passphrase 77' } })
    expect(wrong.json.error.code).toBe('WRONG_PASSWORD')

    const same = await call(changePassword.POST, { path: '/api/v1/auth/change-password', session: a, body: { currentPassword: FIXTURE_PASSWORD, newPassword: FIXTURE_PASSWORD } })
    expect(same.json.error.code).toBe('PASSWORD_REUSED')

    const ok = await call(changePassword.POST, { path: '/api/v1/auth/change-password', session: a, body: { currentPassword: FIXTURE_PASSWORD, newPassword: 'a brand new long passphrase 77' } })
    expect(ok.status).toBe(200)
    expect(ok.headers.get('set-cookie')).toMatch(/^ds_session=/)
    // Every previous session (both devices) is gone; only the freshly issued one remains.
    expect((await call(me.GET, { path: '/api/v1/me', session: a })).status).toBe(401)
    expect((await call(me.GET, { path: '/api/v1/me', session: other })).status).toBe(401)
    expect(await getDb().session.count()).toBe(1)
    expect((await loginRequest(FIXTURES['dtd-user'].email, FIXTURE_PASSWORD)).status).toBe(401)
    expect((await loginRequest(FIXTURES['dtd-user'].email, 'a brand new long passphrase 77')).status).toBe(200)
    expect(await getDb().auditLog.count({ where: { action: 'PASSWORD_CHANGED' } })).toBe(1)
  })
})

describe('re-authentication', () => {
  it('a correct password refreshes the window; a wrong one is refused and audited', async () => {
    const s = await login('admin')
    await getDb().session.updateMany({ data: { authenticatedAt: new Date(Date.now() - 3600_000) } })
    expect((await call(reauth.POST, { path: '/api/v1/auth/reauth', session: s, body: { password: 'definitely not it' } })).json.error.code).toBe('WRONG_PASSWORD')
    expect(await getDb().auditLog.count({ where: { action: 'REAUTH_FAILED' } })).toBe(1)
    expect((await call(reauth.POST, { path: '/api/v1/auth/reauth', session: s, body: { password: FIXTURE_PASSWORD } })).status).toBe(200)
    const row = await getDb().session.findFirstOrThrow()
    expect(Date.now() - row.authenticatedAt.getTime()).toBeLessThan(10_000)
  })
})

describe('forgot password (no email delivery)', () => {
  it('always answers the same and only flags real accounts for administrators', async () => {
    const id = await ensureFixture('dtd-user')
    const post = (email: string) => call(forgot.POST, { path: '/api/v1/auth/forgot-password', body: { email } })
    const a = await post(FIXTURES['dtd-user'].email)
    const b = await post('nobody@test.example')
    expect(a.status).toBe(202)
    expect(b.status).toBe(202)
    expect(a.json).toEqual(b.json)
    expect((await getDb().user.findUniqueOrThrow({ where: { id } })).passwordResetRequestedAt).not.toBeNull()
    expect(await getDb().passwordLink.count()).toBe(0) // nothing usable is created by an anonymous request
  })
})

describe('one-time password links', () => {
  const post = (token: string, newPassword: string) => call(resetPassword.POST, { path: '/api/v1/auth/reset-password', body: { token, newPassword } })

  it('a SETUP link activates an invited account, works once, and only its hash is stored', async () => {
    const id = await ensureFixture('erp-user')
    await getDb().user.update({ where: { id }, data: { status: 'INVITED', passwordHash: null } })
    const link = await issuePasswordLink(getDb(), id, 'SETUP', null)
    const token = linkToken(link.url)
    expect(link.url).toMatch(new RegExp(`^${APP}/password#token=`)) // fragment: never sent to servers/logs
    expect(await getDb().passwordLink.count({ where: { id: token } })).toBe(0)
    expect(await getDb().passwordLink.count({ where: { id: sha256Hex(token) } })).toBe(1)

    expect((await post(token, 'my first real passphrase 2026')).status).toBe(200)
    const u = await getDb().user.findUniqueOrThrow({ where: { id }, include: { enrollment: true } })
    expect(u.status).toBe('ACTIVE')
    expect(u.enrollment?.activationState).toBe('ACTIVATED')
    expect((await loginRequest(FIXTURES['erp-user'].email, 'my first real passphrase 2026')).status).toBe(200)

    const again = await post(token, 'another passphrase entirely 99')
    expect(again.status).toBe(400)
    expect(again.json.error.code).toBe('INVALID_LINK')
  })

  it('a rejected password keeps the link usable; expired or forged links never work', async () => {
    const id = await ensureFixture('erp-user')
    const link = await issuePasswordLink(getDb(), id, 'RESET', null)
    const token = linkToken(link.url)
    expect((await post(token, 'short')).json.error.code).toBe('PASSWORD_POLICY')
    expect((await post(token, 'still a valid long passphrase 1')).status).toBe(200)

    const expired = await issuePasswordLink(getDb(), id, 'RESET', null)
    await getDb().passwordLink.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await post(linkToken(expired.url), 'brand new valid passphrase 22')).json.error.code).toBe('INVALID_LINK')
    expect((await post('A'.repeat(43), 'brand new valid passphrase 22')).json.error.code).toBe('INVALID_LINK')
  })

  it('issuing a new link invalidates the previous one; using a link ends existing sessions', async () => {
    const s = await login('erp-user')
    const first = await issuePasswordLink(getDb(), s.userId, 'RESET', null)
    const second = await issuePasswordLink(getDb(), s.userId, 'RESET', null)
    expect((await post(linkToken(first.url), 'brand new valid passphrase 22')).json.error.code).toBe('INVALID_LINK')
    expect((await post(linkToken(second.url), 'brand new valid passphrase 22')).status).toBe(200)
    expect((await call(me.GET, { path: '/api/v1/me', session: s })).status).toBe(401)
  })

  it('requires our Origin', async () => {
    const r = await call(resetPassword.POST, { path: '/api/v1/auth/reset-password', body: { token: 'A'.repeat(43), newPassword: 'x' }, origin: 'https://evil.example' })
    expect(r.status).toBe(403)
  })
})
