import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/server/db'
import * as websites from '@/app/api/v1/websites/route'
import * as website from '@/app/api/v1/websites/[id]/route'
import * as deployments from '@/app/api/v1/websites/[id]/deployments/route'
import * as deployment from '@/app/api/v1/deployments/[id]/route'
import * as logs from '@/app/api/v1/deployments/[id]/logs/route'
import * as preview from '@/app/api/v1/deployments/[id]/preview/route'
import * as promote from '@/app/api/v1/deployments/[id]/promote/route'
import * as rollback from '@/app/api/v1/websites/[id]/rollback/route'
import * as me from '@/app/api/v1/me/route'
import * as departments from '@/app/api/v1/departments/route'
import * as auditLogs from '@/app/api/v1/audit-logs/route'
import { call, drain, login, makeWorker, resetDb, zipForm, type Session } from '../helpers/app'
import { siteZip } from '../helpers/zip'

let dtd: Session, dtd2: Session, erp: Session, ka: Session, admin: Session
let dtdSite: string, erpSite: string, erpDeployment: string

beforeEach(async () => {
  await resetDb()
  ;[dtd, dtd2, erp, ka, admin] = await Promise.all([login('dtd-user'), login('dtd-user-2'), login('erp-user'), login('ka-user'), login('admin')])
  dtdSite = (await call(websites.POST, { path: '/api/v1/websites', session: dtd, body: { siteName: 'sales-dashboard' } })).json.website.id
  erpSite = (await call(websites.POST, { path: '/api/v1/websites', session: erp, body: { siteName: 'inventory' } })).json.website.id
  const up = await call(deployments.POST, { path: `/api/v1/websites/${erpSite}/deployments`, session: erp, form: zipForm(siteZip()), params: { id: erpSite } })
  expect(up.status).toBe(202)
  erpDeployment = up.json.deployment.id
})

describe('authentication', () => {
  it('rejects unauthenticated API calls', async () => {
    for (const [h, p, params] of [
      [me.GET, '/api/v1/me', {}],
      [websites.GET, '/api/v1/websites', {}],
      [website.GET, `/api/v1/websites/${dtdSite}`, { id: dtdSite }],
      [deployment.GET, `/api/v1/deployments/${erpDeployment}`, { id: erpDeployment }],
      [auditLogs.GET, '/api/v1/audit-logs', {}],
    ] as const) {
      const r = await call(h, { path: p, params })
      expect(r.status, p).toBe(401)
    }
    const r = await call(websites.POST, { path: '/api/v1/websites', body: { siteName: 'x1' }, csrf: null })
    expect(r.status).toBe(401)
  })
})

describe('USER isolation (role + department, not uploader)', () => {
  it('USER from DTD can access DTD and sees only DTD in lists', async () => {
    expect((await call(website.GET, { path: `/api/v1/websites/${dtdSite}`, session: dtd, params: { id: dtdSite } })).status).toBe(200)
    const list = await call(websites.GET, { path: '/api/v1/websites', session: dtd })
    expect(list.json.websites.map((w: { id: string }) => w.id)).toEqual([dtdSite])
    const depts = await call(departments.GET, { path: '/api/v1/departments', session: dtd })
    expect(depts.json.departments.map((d: { code: string }) => d.code)).toEqual(['dtd'])
  })

  it('USER from DTD cannot read ERP or KA resources (concealed as 404)', async () => {
    expect((await call(website.GET, { path: `/api/v1/websites/${erpSite}`, session: dtd, params: { id: erpSite } })).status).toBe(404)
    expect((await call(deployments.GET, { path: `/api/v1/websites/${erpSite}/deployments`, session: dtd, params: { id: erpSite } })).status).toBe(404)
    expect((await call(deployment.GET, { path: `/api/v1/deployments/${erpDeployment}`, session: dtd, params: { id: erpDeployment } })).status).toBe(404)
    expect((await call(logs.GET, { path: `/api/v1/deployments/${erpDeployment}/logs`, session: ka, params: { id: erpDeployment } })).status).toBe(404)
  })

  it('USER from DTD cannot upload, preview, promote or roll back ERP', async () => {
    expect((await call(deployments.POST, { path: `/api/v1/websites/${erpSite}/deployments`, session: dtd, form: zipForm(siteZip()), params: { id: erpSite } })).status).toBe(404)
    expect((await call(preview.POST, { path: `/api/v1/deployments/${erpDeployment}/preview`, session: dtd, body: {}, params: { id: erpDeployment } })).status).toBe(404)
    expect((await call(promote.POST, { path: `/api/v1/deployments/${erpDeployment}/promote`, session: dtd, body: {}, params: { id: erpDeployment } })).status).toBe(404)
    expect((await call(rollback.POST, { path: `/api/v1/websites/${erpSite}/rollback`, session: dtd, body: {}, params: { id: erpSite } })).status).toBe(404)
    const denials = await getDb().auditLog.count({ where: { action: 'AUTHZ_DENIED', result: 'DENIED' } })
    expect(denials).toBeGreaterThanOrEqual(4)
  })

  it('different employees of the same department share the department website', async () => {
    const r = await call(website.GET, { path: `/api/v1/websites/${dtdSite}`, session: dtd2, params: { id: dtdSite } })
    expect(r.status).toBe(200)
    const up = await call(deployments.POST, { path: `/api/v1/websites/${dtdSite}/deployments`, session: dtd2, form: zipForm(siteZip()), params: { id: dtdSite } })
    expect(up.status).toBe(202)
    // ...and the first employee can see the revision uploaded by the second.
    const seen = await call(deployment.GET, { path: `/api/v1/deployments/${up.json.deployment.id}`, session: dtd, params: { id: up.json.deployment.id } })
    expect(seen.status).toBe(200)
  })

  it('client-side department tampering is rejected and audited', async () => {
    await resetDb()
    const u = await login('dtd-user')
    const r = await call(websites.POST, { path: '/api/v1/websites', session: u, body: { department: 'ERP', siteName: 'evil' } })
    expect(r.status).toBe(403)
    expect(r.json.error.code).toBe('DEPARTMENT_MISMATCH')
    expect(await getDb().website.count()).toBe(0)
    expect(await getDb().auditLog.count({ where: { action: 'AUTHZ_DENIED' } })).toBe(1)
  })

  it('USER may send their own department label in any letter case (what the UI sends)', async () => {
    for (const label of ['DTD', 'dtd', ' Dtd ']) {
      await resetDb()
      const u = await login('dtd-user')
      const r = await call(websites.POST, { path: '/api/v1/websites', session: u, body: { department: label, siteName: 'sales' } })
      expect(r.status, label).toBe(201)
    }
  })

  it('department codes are always lower-case in the database (case-insensitive collation must not hide drift)', async () => {
    await expect(
      getDb().$executeRaw`INSERT INTO departments (id, code, name) VALUES (UUID(), 'HR', 'HR')`,
    ).rejects.toThrow(/departments_code_lowercase|3819/)
  })

  it('typing a brand-new department does not create it or grant membership', async () => {
    const r = await call(websites.POST, { path: '/api/v1/websites', session: dtd, body: { department: 'Finance', siteName: 'x' } })
    expect(r.status).toBe(403)
    expect(await getDb().department.findUnique({ where: { code: 'finance' } })).toBeNull()
  })

  it('role escalation attempts are rejected', async () => {
    const r = await call(websites.POST, { path: '/api/v1/websites', session: ka, body: { siteName: 'kasite', role: 'ADMIN' } })
    expect(r.status).toBe(400)
    const meRes = await call(me.GET, { path: '/api/v1/me', session: ka })
    expect(meRes.json.user.role).toBe('USER')
    // A forged role header/cookie changes nothing either.
    const list = await call(websites.GET, { path: '/api/v1/websites', session: ka, headers: { 'x-role': 'ADMIN' } })
    expect(list.json.websites).toEqual([])
  })

  it('unassigned users can sign in but are denied everything', async () => {
    const none = await login('unassigned-user')
    expect((await call(websites.GET, { path: '/api/v1/websites', session: none })).json.websites).toEqual([])
    expect((await call(website.GET, { path: `/api/v1/websites/${dtdSite}`, session: none, params: { id: dtdSite } })).status).toBe(404)
    const r = await call(websites.POST, { path: '/api/v1/websites', session: none, body: { department: 'DTD', siteName: 'x' } })
    expect(r.json.error.code).toBe('NO_DEPARTMENT')
  })
})

describe('ADMIN', () => {
  it('can access all departments and filter by department', async () => {
    const all = await call(websites.GET, { path: '/api/v1/websites', session: admin })
    expect(all.json.websites).toHaveLength(2)
    const erpOnly = await call(websites.GET, { path: '/api/v1/websites?department=ERP', session: admin })
    expect(erpOnly.json.websites.map((w: { id: string }) => w.id)).toEqual([erpSite])
    expect((await call(deployment.GET, { path: `/api/v1/deployments/${erpDeployment}`, session: admin, params: { id: erpDeployment } })).status).toBe(200)
    expect((await call(logs.GET, { path: `/api/v1/deployments/${erpDeployment}/logs`, session: admin, params: { id: erpDeployment } })).status).toBe(200)
    const audit = await call(auditLogs.GET, { path: '/api/v1/audit-logs', session: admin })
    expect(audit.status).toBe(200)
  })

  it('can create a website for a new (dynamic) department', async () => {
    const r = await call(websites.POST, { path: '/api/v1/websites', session: admin, body: { department: 'Sales Ops', siteName: 'pipeline' } })
    expect(r.status).toBe(201)
    expect(r.json.website.department).toMatchObject({ code: 'sales-ops', name: 'Sales Ops' })
    expect(r.json.website.hostname).toBe('sales-ops-pipeline.sites.localhost')
  })

  it('USER audit view is limited to their department', async () => {
    const r = await call(auditLogs.GET, { path: '/api/v1/audit-logs', session: erp })
    const dtdDept = await getDb().department.findUniqueOrThrow({ where: { code: 'dtd' } })
    expect(r.json.auditLogs.every((a: { departmentCode: string | null }) => a.departmentCode === 'erp')).toBe(true)
    expect(r.json.auditLogs.some((a: { departmentCode: string | null }) => a.departmentCode === dtdDept.code)).toBe(false)
  })
})

describe('worker does not widen access', () => {
  it('build results are visible only within the department', async () => {
    const { ctx } = makeWorker()
    await drain(ctx)
    const d = await call(deployment.GET, { path: `/api/v1/deployments/${erpDeployment}`, session: erp, params: { id: erpDeployment } })
    expect(d.json.deployment.status).toBe('PREVIEW_READY')
    expect((await call(deployment.GET, { path: `/api/v1/deployments/${erpDeployment}`, session: dtd, params: { id: erpDeployment } })).status).toBe(404)
  })
})
