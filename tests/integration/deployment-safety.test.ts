import { chmodSync, appendFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/server/db'
import * as websites from '@/app/api/v1/websites/route'
import * as websiteById from '@/app/api/v1/websites/[id]/route'
import * as deploymentsRoute from '@/app/api/v1/websites/[id]/deployments/route'
import { getStorage } from '@/server/storage'
import { call, drain, login, makeWorker, resetDb, type Session } from '../helpers/app'
import { activeOf, createSite, deployLive, openPreview, requestPromote, requestRollback, statusOf, upload, uploadAndBuild } from '../helpers/flow'
import { claimNextJob, reapExpiredLeases } from '../../worker/src/jobs'
import { runRelease } from '../../worker/src/release'
import { routeName } from '../../worker/src/routing/types'
import { containerName } from '../../worker/src/runtime/types'

let dtd: Session, dtd2: Session, erp: Session, admin: Session
let w: ReturnType<typeof makeWorker>

beforeEach(async () => {
  await resetDb()
  ;[dtd, dtd2, erp, admin] = await Promise.all([login('dtd-user'), login('dtd-user-2'), login('erp-user'), login('admin')])
  w = makeWorker()
})

const routedTo = (websiteId: string) => w.router.routes.get(routeName.site(websiteId))?.deploymentId ?? null

describe('one website per department', () => {
  it('first deployment creates the website and makes it live', async () => {
    const site = await createSite(dtd, 'sales-dashboard')
    const v1 = await deployLive(w.ctx, dtd, site)
    expect(await activeOf(site)).toBe(v1)
    expect(await statusOf(v1)).toBe('LIVE')
    expect(routedTo(site)).toBe(v1)
    expect(w.runtime.containers.has(containerName.production(v1))).toBe(true)
    const route = w.router.routes.get(routeName.site(site))!
    expect(route.host).toBe('dtd-sales-dashboard.sites.localhost')
  })

  it('second deployment creates a new revision, not a second website', async () => {
    const site = await createSite(dtd, 'sales-dashboard')
    const v1 = await deployLive(w.ctx, dtd, site)
    const v2 = await deployLive(w.ctx, dtd2, site) // a different employee of the same department
    expect(await getDb().website.count()).toBe(1)
    const revs = await getDb().deployment.findMany({ where: { websiteId: site }, orderBy: { version: 'asc' } })
    expect(revs.map((r) => r.version)).toEqual([1, 2])
    expect(await activeOf(site)).toBe(v2)
    expect(await statusOf(v1)).toBe('LIVE') // previous known-good stays available for rollback
    const again = await call(websites.POST, { path: '/api/v1/websites', session: dtd2, body: { siteName: 'other-name' } })
    expect(again.status).toBe(409)
    expect(again.json.error.code).toBe('WEBSITE_EXISTS')
    expect(again.json.error.details.websiteId).toBe(site)
  })

  it('department uniqueness cannot be bypassed by concurrent requests', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, (_, i) => call(websites.POST, { path: '/api/v1/websites', session: i % 2 ? dtd : dtd2, body: { siteName: `site-${i}` } })),
    )
    const created = attempts.filter((a) => a.status === 201)
    expect(created).toHaveLength(1)
    for (const a of attempts.filter((a) => a.status !== 201)) expect(a.json.error.code).toBe('WEBSITE_EXISTS')
    expect(await getDb().website.count({ where: { department: { code: 'dtd' } } })).toBe(1)
  })

  it('no deletion functionality exists in the API', () => {
    for (const mod of [websites, websiteById, deploymentsRoute]) expect('DELETE' in mod).toBe(false)
  })
})

describe('deployment safety: failures never break production', () => {
  it('a failed build preserves the previous production version', async () => {
    const site = await createSite(dtd, 'sales')
    const v1 = await deployLive(w.ctx, dtd, site)
    const r = await upload(dtd, site)
    w.runtime.failBuildFor.add(r.json.deployment.id)
    await drain(w.ctx)
    // BUILD_FAILED is not retryable → FAILED immediately
    expect(await statusOf(r.json.deployment.id)).toBe('FAILED')
    expect(await activeOf(site)).toBe(v1)
    expect(routedTo(site)).toBe(v1)
    expect(w.runtime.containers.has(containerName.production(v1))).toBe(true)
  })

  it('a failed readiness check preserves the previous production version', async () => {
    const site = await createSite(dtd, 'sales')
    const v1 = await deployLive(w.ctx, dtd, site)
    const v2 = await uploadAndBuild(w.ctx, dtd, site)
    w.runtime.unhealthyProductionFor.add(v2)
    await openPreview(dtd, v2)
    expect((await requestPromote(dtd, v2)).status).toBe(202)
    await drain(w.ctx)
    expect(await statusOf(v2)).toBe('FAILED')
    expect((await getDb().deployment.findUniqueOrThrow({ where: { id: v2 } })).errorCode).toBe('HEALTH_CHECK_FAILED')
    expect(await activeOf(site)).toBe(v1)
    expect(routedTo(site)).toBe(v1)
    expect(w.runtime.containers.has(containerName.production(v2))).toBe(false)
    expect(w.runtime.containers.has(containerName.production(v1))).toBe(true)
  })

  it('a preview is only reported ready once the proxy actually serves it', async () => {
    const site = await createSite(dtd, 'sales')
    const r = await upload(dtd, site)
    const id = r.json.deployment.id as string
    w.router.failVerifyFor.add(id)
    await drain(w.ctx)
    expect(await statusOf(id)).not.toBe('PREVIEW_READY')
    // Never servable to users: a preview is only live with an expiry, which is set together with PREVIEW_READY.
    expect((await getDb().deployment.findUniqueOrThrow({ where: { id } })).previewExpiresAt).toBeNull()
  })

  it('a failed proxy verification restores the previous route', async () => {
    const site = await createSite(dtd, 'sales')
    const v1 = await deployLive(w.ctx, dtd, site)
    const v2 = await uploadAndBuild(w.ctx, dtd, site)
    w.router.failVerifyFor.add(v2)
    await openPreview(dtd, v2)
    await requestPromote(dtd, v2)
    await drain(w.ctx)
    expect(await statusOf(v2)).toBe('FAILED')
    expect(await activeOf(site)).toBe(v1)
    expect(routedTo(site)).toBe(v1)
    expect(w.router.history.filter((h) => h.name === routeName.site(site)).map((h) => h.deploymentId)).toEqual([v1, v2, v1])
  })

  it('concurrent promotions are serialized and cannot corrupt the production pointer', async () => {
    const site = await createSite(dtd, 'sales')
    const v1 = await deployLive(w.ctx, dtd, site)
    const a = await uploadAndBuild(w.ctx, dtd, site)
    const b = await uploadAndBuild(w.ctx, dtd2, site)
    await openPreview(dtd, a)
    await openPreview(dtd2, b)
    const [ra, rb] = await Promise.all([requestPromote(dtd, a), requestPromote(dtd2, b)])
    const statuses = [ra.status, rb.status].sort()
    expect(statuses).toEqual([202, 409])
    const loser = ra.status === 409 ? ra : rb
    expect(loser.json.error.code).toBe('PROMOTION_IN_PROGRESS')
    expect(await getDb().deploymentJob.count({ where: { jobType: 'PROMOTE', status: { in: ['QUEUED', 'RUNNING'] } } })).toBe(1)
    await drain(w.ctx)
    const winner = ra.status === 202 ? a : b
    expect(await activeOf(site)).toBe(winner)
    expect(routedTo(site)).toBe(winner)
    expect(await statusOf(v1)).toBe('LIVE')
  })

  it('duplicate deployment requests are idempotent', async () => {
    const site = await createSite(dtd, 'sales')
    const key = 'abcdef0123456789abcdef'
    const r1 = await upload(dtd, site, { key })
    const r2 = await upload(dtd, site, { key })
    expect(r1.status).toBe(202)
    expect(r2.status).toBe(202)
    expect(r2.json.deployment.id).toBe(r1.json.deployment.id)
    expect(await getDb().deployment.count()).toBe(1)
    await drain(w.ctx)
    const id = r1.json.deployment.id
    await openPreview(dtd, id)
    const p1 = await requestPromote(dtd, id)
    const p2 = await requestPromote(dtd2, id) // same department, double click / retry
    expect([p1.status, p2.status]).toEqual([202, 202])
    expect(await getDb().deploymentJob.count({ where: { jobType: 'PROMOTE' } })).toBe(1)
  })

  it('unauthorized or premature promotions fail', async () => {
    const site = await createSite(dtd, 'sales')
    const r = await upload(dtd, site)
    const id = r.json.deployment.id
    expect((await requestPromote(dtd, id)).json.error.code).toBe('INVALID_STATE') // not built yet
    await drain(w.ctx)
    expect((await requestPromote(dtd, id)).json.error.code).toBe('PREVIEW_REQUIRED') // preview never opened
    expect((await requestPromote(erp, id)).status).toBe(404) // other department
    expect(await getDb().deploymentJob.count({ where: { jobType: 'PROMOTE' } })).toBe(0)
  })

  it('rollback restores the previous known-good revision', async () => {
    const site = await createSite(dtd, 'sales')
    const v1 = await deployLive(w.ctx, dtd, site)
    const v2 = await deployLive(w.ctx, dtd, site)
    expect(await activeOf(site)).toBe(v2)
    const r = await requestRollback(dtd2, site)
    expect(r.status).toBe(202)
    expect(r.json.deployment.id).toBe(v1)
    await drain(w.ctx)
    expect(await activeOf(site)).toBe(v1)
    expect(await statusOf(v1)).toBe('LIVE')
    expect(await statusOf(v2)).toBe('ROLLED_BACK')
    expect(routedTo(site)).toBe(v1)
    expect((await requestRollback(erp, site)).status).toBe(404)
  })

  it('rollback rebuilds from the immutable build artifact if the image was pruned', async () => {
    const site = await createSite(dtd, 'sales')
    const v1 = await deployLive(w.ctx, dtd, site)
    await deployLive(w.ctx, dtd, site)
    const img = (await getDb().deployment.findUniqueOrThrow({ where: { id: v1 } })).imageReference!
    w.runtime.images.delete(img)
    const before = w.runtime.builds
    await requestRollback(dtd, site, v1)
    await drain(w.ctx)
    expect(w.runtime.builds).toBe(before + 1)
    expect(await activeOf(site)).toBe(v1)
  })

  it('a stale worker cannot commit a production switch after its lease was lost', async () => {
    const site = await createSite(dtd, 'sales')
    const v1 = await deployLive(w.ctx, dtd, site)
    const v2 = await uploadAndBuild(w.ctx, dtd, site)
    await openPreview(dtd, v2)
    await requestPromote(dtd, v2)
    const job = (await claimNextJob(w.ctx))!
    // Simulate: the worker hangs after switching the route; its lease expires; the reaper recovers.
    w.ctx.hooks = {
      beforePointerCommit: async () => {
        await getDb().deploymentJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } })
        await reapExpiredLeases(w.ctx)
      },
    }
    await runRelease(w.ctx, job, { jobId: job.id, leaseToken: job.leaseToken }, new AbortController().signal)
    expect(await activeOf(site)).toBe(v1)
    expect(await statusOf(v2)).toBe('FAILED')
    expect((await getDb().deploymentJob.findUniqueOrThrow({ where: { id: job.id } })).errorCode).toBe('WORKER_LOST')
    expect(routedTo(site)).toBe(v1) // route converged back to the DB pointer
    expect(await getDb().deploymentJob.count({ where: { activeLockKey: { not: null } } })).toBe(0)
  })

  it('a tampered build artifact is refused at promotion (preview-to-production integrity)', async () => {
    const site = await createSite(dtd, 'sales')
    const v1 = await deployLive(w.ctx, dtd, site)
    const v2 = await uploadAndBuild(w.ctx, dtd, site)
    const d = await getDb().deployment.findUniqueOrThrow({ where: { id: v2 } })
    const file = getStorage().localPath(d.buildArtifactKey!)
    chmodSync(file, 0o644)
    appendFileSync(file, 'tampered')
    await openPreview(dtd, v2)
    await requestPromote(dtd, v2)
    await drain(w.ctx)
    expect(await statusOf(v2)).toBe('FAILED')
    expect((await getDb().deployment.findUniqueOrThrow({ where: { id: v2 } })).errorCode).toBe('ARTIFACT_INTEGRITY_FAILED')
    expect(await activeOf(site)).toBe(v1)
    expect(await getDb().auditLog.count({ where: { action: 'SECURITY_ALERT' } })).toBeGreaterThan(0)
  })

  it('quarantined revisions cannot be promoted or used as rollback targets', async () => {
    const site = await createSite(dtd, 'sales')
    const v1 = await deployLive(w.ctx, dtd, site)
    const v2 = await deployLive(w.ctx, dtd, site)
    await getDb().deployment.update({ where: { id: v1 }, data: { quarantinedAt: new Date() } })
    expect((await requestRollback(dtd, site)).json.error.code).toBe('NO_ROLLBACK_TARGET')
    const v3 = await uploadAndBuild(w.ctx, dtd, site)
    await openPreview(dtd, v3)
    await getDb().deployment.update({ where: { id: v3 }, data: { quarantinedAt: new Date() } })
    expect((await requestPromote(dtd, v3)).json.error.code).toBe('INVALID_STATE')
    expect(await activeOf(site)).toBe(v2)
  })

  it('a suspended website blocks uploads and production changes', async () => {
    const site = await createSite(dtd, 'sales')
    await deployLive(w.ctx, dtd, site)
    await getDb().website.update({ where: { id: site }, data: { suspendedAt: new Date() } })
    expect((await upload(dtd, site)).json.error.code).toBe('WEBSITE_SUSPENDED')
    expect((await requestRollback(dtd, site)).json.error.code).toBe('WEBSITE_SUSPENDED')
  })

  it('admin cross-department production changes require recent authentication (step-up)', async () => {
    const site = await createSite(dtd, 'sales')
    const v1 = await uploadAndBuild(w.ctx, dtd, site)
    await openPreview(admin, v1)
    await getDb().session.updateMany({ where: { user: { role: 'ADMIN' } }, data: { authenticatedAt: new Date(Date.now() - 60 * 60_000) } })
    const r = await requestPromote(admin, v1)
    expect(r.status).toBe(401)
    expect(r.json.error.code).toBe('REAUTH_REQUIRED')
    await getDb().session.updateMany({ where: { user: { role: 'ADMIN' } }, data: { authenticatedAt: new Date() } })
    expect((await requestPromote(admin, v1)).status).toBe(202)
  })

  it('records an audit trail for the full lifecycle with correlation ids', async () => {
    const site = await createSite(dtd, 'sales')
    await deployLive(w.ctx, dtd, site)
    const actions = (await getDb().auditLog.findMany({ where: { websiteId: site }, orderBy: { id: 'asc' } })).map((a) => a.action)
    for (const a of ['WEBSITE_CREATED', 'DEPLOYMENT_UPLOADED', 'DEPLOYMENT_PREVIEW_READY', 'PREVIEW_OPENED', 'PROMOTION_REQUESTED', 'DEPLOYMENT_LIVE']) expect(actions).toContain(a)
    const live = await getDb().auditLog.findFirstOrThrow({ where: { action: 'DEPLOYMENT_LIVE' } })
    expect(live.requestId).toMatch(/^job-/)
  })
})
