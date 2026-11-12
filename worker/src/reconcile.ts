import { log } from '@/server/log'
import type { WorkerContext } from './context'
import { containerName } from './runtime/types'
import { routeName } from './routing/types'

/**
 * Converges proxy routing + containers to the DB production pointer (the source of truth).
 * Skips websites with a production change in flight — that job owns the routing until it ends.
 */
export async function reconcileWebsite(ctx: WorkerContext, websiteId: string): Promise<void> {
  const w = await ctx.db.website.findUnique({ where: { id: websiteId }, include: { activeDeployment: true } })
  if (!w) return
  const inFlight = await ctx.db.deploymentJob.findFirst({ where: { activeLockKey: websiteId, status: 'RUNNING' } })
  if (inFlight) return
  const name = routeName.site(websiteId)
  const active = w.activeDeployment
  // Emergency route disablement: suspended websites (or quarantined active revisions) are not served.
  if (w.suspendedAt || active?.quarantinedAt) {
    await ctx.router.removeRoute(name)
    if (active) await ctx.runtime.stopContainer(containerName.production(active.id))
    return
  }
  if (!active || !active.imageReference) {
    await ctx.router.removeRoute(name)
    return
  }
  const cname = containerName.production(active.id)
  let upstream = `http://${cname}:8080`
  if (!(await ctx.runtime.isRunning(cname))) {
    if (!(await ctx.runtime.imageExists(active.imageReference))) {
      log.error('worker.reconcile_image_missing', { websiteId, deploymentId: active.id })
      return
    }
    upstream = (await ctx.runtime.startContainer({ name: cname, imageRef: active.imageReference, kind: 'production', deploymentId: active.id, websiteId })).upstream
  }
  const route = await ctx.router.getRoute(name)
  if (!route || route.deploymentId !== active.id || route.host !== w.hostname) {
    await ctx.router.setRoute({ name, host: w.hostname, upstream, preview: false, deploymentId: active.id })
    log.info('worker.route_reconciled', { websiteId, deploymentId: active.id })
  }
}

/** Periodic housekeeping: routes for all websites, expired previews, orphaned production containers. */
export async function reconcileAll(ctx: WorkerContext): Promise<void> {
  const websites = await ctx.db.website.findMany({ select: { id: true } })
  for (const w of websites) await reconcileWebsite(ctx, w.id).catch((e: unknown) => log.error('worker.reconcile_failed', { websiteId: w.id, error: e }))

  // Expire previews: stop container + remove route. Status stays PREVIEW_READY; reopening restarts it.
  const managed = await ctx.runtime.listManagedContainers()
  for (const c of managed) {
    if (c.kind !== 'preview') continue
    const d = await ctx.db.deployment.findUnique({ where: { id: c.deploymentId }, select: { status: true, previewExpiresAt: true } })
    const building = d?.status === 'BUILDING' || d?.status === 'VALIDATING'
    const expired = !d || d.status === 'FAILED' || (!building && (!d.previewExpiresAt || d.previewExpiresAt.getTime() < Date.now()))
    if (expired) {
      await ctx.runtime.stopContainer(c.name)
      await ctx.router.removeRoute(routeName.preview(c.deploymentId))
    }
  }

  // Remove production containers that are neither active nor the target of an in-flight release.
  // Re-check against fresh DB state per container (another worker may have just switched production).
  for (const c of managed) {
    if (c.kind !== 'production') continue
    const [site, job] = await Promise.all([
      ctx.db.website.findUnique({ where: { id: c.websiteId }, select: { activeDeploymentId: true } }),
      ctx.db.deploymentJob.findFirst({ where: { deploymentId: c.deploymentId, status: { in: ['QUEUED', 'RUNNING'] }, jobType: { in: ['PROMOTE', 'ROLLBACK'] } } }),
    ])
    if (site && site.activeDeploymentId !== c.deploymentId && !job) await ctx.runtime.stopContainer(c.name)
  }
}
