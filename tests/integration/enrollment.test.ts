import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/server/db'
import * as users from '@/app/api/v1/admin/users/route'
import * as userById from '@/app/api/v1/admin/users/[id]/route'
import * as resetPw from '@/app/api/v1/admin/users/[id]/reset-password/route'
import * as revoke from '@/app/api/v1/admin/users/[id]/revoke/route'
import * as resetWithLink from '@/app/api/v1/auth/reset-password/route'
import * as me from '@/app/api/v1/me/route'
import * as websites from '@/app/api/v1/websites/route'
import { call, ensureFixture, FIXTURES, login, loginRequest, resetDb, type Session } from '../helpers/app'

beforeEach(resetDb)

const create = (s: Session, body: unknown) => call(users.POST, { path: '/api/v1/admin/users', session: s, body })
const patch = (s: Session, id: string, body: unknown) => call(userById.PATCH, { method: 'PATCH', path: `/api/v1/admin/users/${id}`, session: s, body, params: { id } })
const tokenOf = (url: string) => new URL(url).hash.replace('#token=', '')
const activate = (url: string, pw: string) => call(resetWithLink.POST, { path: '/api/v1/auth/reset-password', body: { token: tokenOf(url), newPassword: pw } })

describe('Enroll IDs: admin only', () => {
  it('USER can neither read nor change enrollments', async () => {
    const u = await login('dtd-user')
    const target = await ensureFixture('erp-user')
    expect((await call(users.GET, { path: '/api/v1/admin/users', session: u })).status).toBe(403)
    expect((await create(u, { displayName: 'X', email: 'x@test.example', role: 'ADMIN' })).status).toBe(403)
    expect((await patch(u, target, { role: 'ADMIN' })).status).toBe(403)
    expect((await patch(u, u.userId, { role: 'ADMIN' })).status).toBe(403) // no self-escalation either
    expect((await call(resetPw.POST, { path: `/api/v1/admin/users/${target}/reset-password`, session: u, body: {}, params: { id: target } })).status).toBe(403)
    expect((await call(revoke.POST, { path: `/api/v1/admin/users/${target}/revoke`, session: u, body: {}, params: { id: target } })).status).toBe(403)
    expect(await getDb().auditLog.count({ where: { action: 'AUTHZ_DENIED' } })).toBeGreaterThanOrEqual(5)
  })

  it('anonymous requests are refused', async () => {
    expect((await call(users.GET, { path: '/api/v1/admin/users' })).status).toBe(401)
  })
})

describe('create', () => {
  it('creates an INVITED account with a one-time setup link; the user activates it and signs in', async () => {
    const a = await login('admin')
    const r = await create(a, { displayName: 'Napat S.', email: 'Napat.S@Test.Example', department: 'Marketing', role: 'USER' })
    expect(r.status).toBe(201)
    expect(r.json.user).toMatchObject({ email: 'Napat.S@Test.Example', status: 'INVITED', role: 'USER', passwordSet: false, department: { code: 'marketing', name: 'Marketing' } })
    expect(JSON.stringify(r.json)).not.toMatch(/passwordHash|argon2/)
    expect(r.json.setupLink.url).toMatch(/\/password#token=/)
    // Not usable before activation.
    expect((await loginRequest('napat.s@test.example', 'anything at all 12345')).status).toBe(401)
    expect((await activate(r.json.setupLink.url, 'violet lantern 42')).status).toBe(200)
    expect((await loginRequest('napat.s@test.example', 'violet lantern 42')).status).toBe(200)
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { action: 'USER_CREATED' } })
    expect(audit).toMatchObject({ actorUserId: a.userId, targetUserId: r.json.user.id })
  })

  it('validates email domain, duplicates, departments and fields', async () => {
    const a = await login('admin')
    expect((await create(a, { displayName: 'X', email: 'x@gmail.com', department: 'DTD', role: 'USER' })).json.error.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED')
    expect((await create(a, { displayName: 'X', email: 'not-an-email', department: 'DTD', role: 'USER' })).json.error.code).toBe('INVALID_EMAIL')
    expect((await create(a, { displayName: 'X', email: 'x@test.example', role: 'USER' })).json.error.code).toBe('DEPARTMENT_REQUIRED')
    expect((await create(a, { displayName: 'X', email: 'x@test.example', department: '!!', role: 'USER' })).json.error.code).toBe('INVALID_DEPARTMENT')
    expect((await create(a, { displayName: 'X', email: 'x@test.example', department: 'DTD', role: 'USER', status: 'ACTIVE' })).status).toBe(400)
    expect((await create(a, { displayName: 'X', email: 'x@test.example', department: 'DTD', role: 'USER' })).status).toBe(201)
    expect((await create(a, { displayName: 'Y', email: 'X@TEST.EXAMPLE', department: 'DTD', role: 'USER' })).json.error.code).toBe('EMAIL_IN_USE')
  })

  it('a department typed for an enrollment is the trusted membership (it is the admin who decides)', async () => {
    const a = await login('admin')
    const r = await create(a, { displayName: 'Ops', email: 'ops@test.example', department: 'Operations Team', role: 'USER' })
    await activate(r.json.setupLink.url, 'operations team 7')
    const res = await loginRequest('ops@test.example', 'operations team 7')
    const s: Session = { cookie: res.headers.get('set-cookie')!.split(';')[0]!, csrf: (await res.json()).csrfToken, identity: 'dtd-user', userId: r.json.user.id }
    expect((await call(me.GET, { path: '/api/v1/me', session: s })).json.user.department.code).toBe('operations-team')
  })
})

describe('list, search, filters, pagination', () => {
  it('searches by name/email and filters by department, role and status', async () => {
    const a = await login('admin')
    for (const k of ['dtd-user', 'dtd-user-2', 'erp-user', 'ka-user'] as const) await ensureFixture(k)
    const list = (q: string) => call(users.GET, { path: `/api/v1/admin/users${q}`, session: a })
    expect((await list('')).json.total).toBe(5)
    expect((await list('?q=erp1')).json.users.map((u: { email: string }) => u.email)).toEqual([FIXTURES['erp-user'].email])
    expect((await list('?q=dtd%20user')).json.total).toBe(2)
    expect((await list('?department=dtd')).json.total).toBe(2)
    expect((await list('?role=ADMIN')).json.total).toBe(1)
    const p1 = await list('?pageSize=5&page=1')
    expect(p1.json.users).toHaveLength(5)
    expect((await list('?pageSize=5&page=2')).json.users).toHaveLength(0)
    // Department filter options are generated from the database, not hard-coded.
    expect((await list('')).json.departments.map((d: { code: string }) => d.code).sort()).toEqual(['dtd', 'erp', 'ka'])
    expect(JSON.stringify((await list('')).json)).not.toMatch(/passwordHash|argon2/)
  })
})

describe('edit', () => {
  it('role and department changes end the user\'s sessions immediately (no stale authorization)', async () => {
    const a = await login('admin')
    const u = await login('dtd-user')
    expect((await call(websites.GET, { path: '/api/v1/websites', session: u })).status).toBe(200)
    const r = await patch(a, u.userId, { department: 'ERP' })
    expect(r.status).toBe(200)
    expect(r.json.user.department.code).toBe('erp')
    expect((await call(me.GET, { path: '/api/v1/me', session: u })).status).toBe(401)
    expect(await getDb().auditLog.count({ where: { action: 'MEMBERSHIP_CHANGED', targetUserId: u.userId } })).toBe(1)

    const u2 = await login('dtd-user')
    expect((await patch(a, u2.userId, { role: 'ADMIN' })).status).toBe(200)
    expect((await call(me.GET, { path: '/api/v1/me', session: u2 })).status).toBe(401)
    expect(await getDb().auditLog.count({ where: { action: 'SECURITY_ALERT' } })).toBeGreaterThanOrEqual(1) // promotion to admin
  })

  it('disabling blocks sign-in; re-enabling restores it; display-name edits keep sessions', async () => {
    const a = await login('admin')
    const u = await login('ka-user')
    expect((await patch(a, u.userId, { displayName: 'KA Person' })).status).toBe(200)
    expect((await call(me.GET, { path: '/api/v1/me', session: u })).status).toBe(200)
    expect((await patch(a, u.userId, { status: 'DISABLED' })).json.user.status).toBe('DISABLED')
    expect((await call(me.GET, { path: '/api/v1/me', session: u })).status).toBe(401)
    expect((await loginRequest(FIXTURES['ka-user'].email, 'correct horse battery staple 42')).status).toBe(401)
    expect((await patch(a, u.userId, { status: 'ACTIVE' })).json.user.status).toBe('ACTIVE')
    expect((await loginRequest(FIXTURES['ka-user'].email, 'correct horse battery staple 42')).status).toBe(200)
  })

  it('a USER cannot be left without a department; email cannot be changed', async () => {
    const a = await login('admin')
    const id = await ensureFixture('dtd-user')
    expect((await patch(a, id, { department: null })).json.error.code).toBe('DEPARTMENT_REQUIRED')
    expect((await patch(a, id, { email: 'other@test.example' })).status).toBe(400)
  })

  it('admins cannot change their own role or status', async () => {
    const a = await login('admin')
    expect((await patch(a, a.userId, { role: 'USER' })).json.error.code).toBe('SELF_CHANGE_NOT_ALLOWED')
    expect((await patch(a, a.userId, { status: 'DISABLED' })).json.error.code).toBe('SELF_CHANGE_NOT_ALLOWED')
    expect((await patch(a, a.userId, { displayName: 'Renamed Admin' })).status).toBe(200)
  })

  it('the last active administrator can never be demoted, disabled or removed (also under races)', async () => {
    const a = await login('admin')
    const r = await create(a, { displayName: 'Second Admin', email: 'admin2@test.example', role: 'ADMIN' })
    await activate(r.json.setupLink.url, 'quiet harbor 88')
    const res = await loginRequest('admin2@test.example', 'quiet harbor 88')
    const b: Session = { cookie: res.headers.get('set-cookie')!.split(';')[0]!, csrf: (await res.json()).csrfToken, identity: 'admin', userId: r.json.user.id }

    // Two admins demote each other at the same moment: the row locks let exactly one succeed.
    const [x, y] = await Promise.all([patch(a, b.userId, { role: 'USER', department: 'DTD' }), patch(b, a.userId, { role: 'USER', department: 'DTD' })])
    expect([x.status, y.status].filter((s) => s === 200)).toHaveLength(1)
    expect(await getDb().user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } })).toBe(1)

    // Any path that reaches the service (e.g. a stale admin session in a race) is refused for the lone admin.
    const { updateUser, revokeUser } = await import('@/server/services/users')
    const lone = await getDb().user.findFirstOrThrow({ where: { role: 'ADMIN', status: 'ACTIVE' } })
    const other = { userId: 'someone-else', role: 'ADMIN' as const, departmentId: null, departmentCode: null, displayName: 'x', email: 'x@test.example', authenticatedAt: new Date() }
    await expect(updateUser(getDb(), other, lone.id, { status: 'DISABLED' })).rejects.toMatchObject({ code: 'LAST_ADMIN' })
    await expect(updateUser(getDb(), other, lone.id, { role: 'USER', department: 'DTD' })).rejects.toMatchObject({ code: 'LAST_ADMIN' })
    await expect(revokeUser(getDb(), other, lone.id)).rejects.toMatchObject({ code: 'LAST_ADMIN' })
    expect((await getDb().user.findUniqueOrThrow({ where: { id: lone.id } })).status).toBe('ACTIVE')
  })
})

describe('reset password & remove', () => {
  it('reset issues a one-time link and ends the user\'s sessions', async () => {
    const a = await login('admin')
    const u = await login('erp-user')
    const r = await call(resetPw.POST, { path: `/api/v1/admin/users/${u.userId}/reset-password`, session: a, body: {}, params: { id: u.userId } })
    expect(r.status).toBe(200)
    expect(r.json.resetLink.url).toMatch(/#token=/)
    expect((await call(me.GET, { path: '/api/v1/me', session: u })).status).toBe(401)
    expect((await activate(r.json.resetLink.url, 'fresh start 2026')).status).toBe(200)
    expect((await loginRequest(FIXTURES['erp-user'].email, 'fresh start 2026')).status).toBe(200)
    // An admin may reset their own password: a link is issued and every own session (including this one) ends.
    const self = await call(resetPw.POST, { path: `/api/v1/admin/users/${a.userId}/reset-password`, session: a, body: {}, params: { id: a.userId } })
    expect(self.status).toBe(200)
    expect(self.json.resetLink.url).toMatch(/#token=/)
    expect((await call(me.GET, { path: '/api/v1/me', session: a })).status).toBe(401)
    expect((await activate(self.json.resetLink.url, 'blue river 9')).status).toBe(200)
    expect((await loginRequest(FIXTURES.admin.email, 'blue river 9')).status).toBe(200)
  })

  it('remove is a soft revocation: sign-in impossible, email reusable, history kept', async () => {
    const a = await login('admin')
    const u = await login('dtd-user')
    const site = await call(websites.POST, { path: '/api/v1/websites', session: u, body: { siteName: 'sales' } })
    expect(site.status).toBe(201)
    const r = await call(revoke.POST, { path: `/api/v1/admin/users/${u.userId}/revoke`, session: a, body: {}, params: { id: u.userId } })
    expect(r.json.user.status).toBe('REVOKED')
    expect((await call(me.GET, { path: '/api/v1/me', session: u })).status).toBe(401)
    expect((await loginRequest(FIXTURES['dtd-user'].email, 'correct horse battery staple 42')).status).toBe(401)
    // The row, its enrollment and everything it created remain.
    const row = await getDb().user.findUniqueOrThrow({ where: { id: u.userId }, include: { enrollment: true } })
    expect(row.enrollment).toMatchObject({ status: 'REVOKED', revokedById: a.userId })
    expect(await getDb().website.count({ where: { createdByUserId: u.userId } })).toBe(1)
    // Removed accounts cannot be edited back; the email can be enrolled again as a new account.
    expect((await patch(a, u.userId, { status: 'ACTIVE' })).json.error.code).toBe('ACCOUNT_REVOKED')
    expect((await create(a, { displayName: 'Again', email: FIXTURES['dtd-user'].email, department: 'DTD', role: 'USER' })).status).toBe(201)
  })
})

describe('re-authentication for enrollment writes', () => {
  it('a stale password check blocks writes until the admin confirms the password', async () => {
    const a = await login('admin')
    await getDb().session.updateMany({ where: { userId: a.userId }, data: { authenticatedAt: new Date(Date.now() - 3600_000) } })
    const r = await create(a, { displayName: 'X', email: 'x@test.example', department: 'DTD', role: 'USER' })
    expect(r.status).toBe(401)
    expect(r.json.error.code).toBe('REAUTH_REQUIRED')
    expect(await getDb().user.count({ where: { email: 'x@test.example' } })).toBe(0)
    // Reading is still allowed.
    expect((await call(users.GET, { path: '/api/v1/admin/users', session: a })).status).toBe(200)
  })
})
