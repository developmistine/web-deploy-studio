import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/server/db'
import * as website from '@/app/api/v1/websites/[id]/route'
import { resolveHostTarget } from '@/server/gateway/access'
import { routeName } from '../../worker/src/routing/types'
import { reconcileWebsite } from '../../worker/src/reconcile'
import { call, login, makeWorker, resetDb, type Session } from '../helpers/app'
import { createSite, deployLive, openPreview, requestPromote, uploadAndBuild } from '../helpers/flow'

let dtd: Session, erp: Session, admin: Session
beforeEach(async () => {
  await resetDb()
  ;[dtd, erp, admin] = await Promise.all([login('dtd-user'), login('erp-user'), login('admin')])
})

const rename = (s: Session, id: string, siteName: unknown) =>
  call(website.PATCH, { method: 'PATCH', path: `/api/v1/websites/${id}`, session: s, body: { siteName }, params: { id } })

describe('rename website (site name → hostname)', () => {
  it('a department member renames the live site; the old address stops resolving and the worker re-points the route', async () => {
    const w = makeWorker()
    const site = await createSite(dtd, 'sales')
    await deployLive(w.ctx, dtd, site)
    expect(await resolveHostTarget(getDb(), 'dtd-sales.sites.localhost')).not.toBeNull()

    const r = await rename(dtd, site, 'reports')
    expect(r.status).toBe(200)
    expect(r.json.website).toMatchObject({ siteName: 'reports', logicalName: 'dtd.reports', hostname: 'dtd-reports.sites.localhost' })
    expect(await resolveHostTarget(getDb(), 'dtd-sales.sites.localhost')).toBeNull() // old address: unknown host
    expect(await resolveHostTarget(getDb(), 'dtd-reports.sites.localhost')).toMatchObject({ kind: 'site', websiteId: site, live: true })

    await reconcileWebsite(w.ctx, site)
    expect(w.router.routes.get(routeName.site(site))?.host).toBe('dtd-reports.sites.localhost')
    const audit = await getDb().auditLog.findFirstOrThrow({ where: { action: 'WEBSITE_RENAMED' } })
    expect(audit).toMatchObject({ actorUserId: dtd.userId, websiteId: site })
    expect(audit.metadata).toMatchObject({ from: 'sales', to: 'reports', toHostname: 'dtd-reports.sites.localhost' })
  })

  it('another department cannot rename it (concealed), and invalid names are rejected', async () => {
    const site = await createSite(dtd, 'sales')
    expect((await rename(erp, site, 'hijacked')).status).toBe(404)
    expect((await rename(dtd, site, '-bad-')).status).toBe(400)
    expect((await rename(dtd, site, 'has space')).status).toBe(400)
    expect((await call(website.PATCH, { method: 'PATCH', path: `/api/v1/websites/${site}`, session: dtd, body: { siteName: 'ok', departmentId: 'x' }, params: { id: site } })).status).toBe(400)
    expect((await getDb().website.findUniqueOrThrow({ where: { id: site } })).siteName).toBe('sales')
  })

  it('names are normalised like on creation (trim, lower-case)', async () => {
    const site = await createSite(dtd, 'sales')
    expect((await rename(dtd, site, '  Reports ')).json.website.siteName).toBe('reports')
  })

  it('the same name is a no-op (no audit)', async () => {
    const site = await createSite(dtd, 'sales')
    expect((await rename(dtd, site, 'sales')).status).toBe(200)
    expect(await getDb().auditLog.count({ where: { action: 'WEBSITE_RENAMED' } })).toBe(0)
  })

  it('an admin renaming another department needs a recent password confirmation', async () => {
    const site = await createSite(dtd, 'sales')
    await getDb().session.updateMany({ where: { userId: admin.userId }, data: { authenticatedAt: new Date(Date.now() - 3600_000) } })
    const r = await rename(admin, site, 'by-admin')
    expect(r.status).toBe(401)
    expect(r.json.error.code).toBe('REAUTH_REQUIRED')
    await getDb().session.updateMany({ where: { userId: admin.userId }, data: { authenticatedAt: new Date() } })
    expect((await rename(admin, site, 'by-admin')).status).toBe(200)
  })

  it('is refused while a promotion is in flight and while the website is suspended', async () => {
    const w = makeWorker()
    const site = await createSite(dtd, 'sales')
    const v1 = await uploadAndBuild(w.ctx, dtd, site)
    await openPreview(dtd, v1)
    expect((await requestPromote(dtd, v1)).status).toBe(202)
    const busy = await rename(dtd, site, 'reports')
    expect(busy.status).toBe(409)
    expect(busy.json.error.code).toBe('PROMOTION_IN_PROGRESS')

    await getDb().website.update({ where: { id: site }, data: { suspendedAt: new Date() } })
    expect((await rename(dtd, site, 'reports')).json.error.code).toBe('WEBSITE_SUSPENDED')
  })
})
