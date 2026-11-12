import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { assertLease, StaleLeaseError, transition, type Fence } from '@/server/deployments/state'
import { audit } from '@/server/audit'
import { log } from '@/server/log'
import { extractZip } from '@/server/uploads/archive'
import type { WorkerContext } from './context'
import { addLog } from './context'
import { completeJob, type ClaimedJob } from './jobs'
import { containerName, RuntimeError } from './runtime/types'
import { routeName, type RouteSpec } from './routing/types'
import { prepareContext } from './build'
import { reconcileWebsite } from './reconcile'
import { sha256File } from '@/server/storage'
import { raiseAlert } from '@/server/security-alerts'

class ReleaseFailure extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

/**
 * PROMOTE and ROLLBACK. Safety invariant: the current production site keeps serving until the new
 * version is running, healthy, routed and verified through the proxy; only then is the DB pointer
 * committed (fenced). Any failure restores the previous route and leaves the pointer untouched.
 */
export async function runRelease(ctx: WorkerContext, job: ClaimedJob, fence: Fence, signal: AbortSignal): Promise<void> {
  const isRollback = job.jobType === 'ROLLBACK'
  const target = await ctx.db.deployment.findUniqueOrThrow({ where: { id: job.deploymentId }, include: { website: true } })
  const website = target.website
  const previousActiveId = website.activeDeploymentId
  const siteRoute = routeName.site(website.id)
  const newName = containerName.production(target.id)
  let previousRoute: RouteSpec | null = null
  let switched = false

  try {
    if (!isRollback && target.status !== 'DEPLOYING') throw new ReleaseFailure('INVALID_STATE')
    if (isRollback && !['LIVE', 'ROLLED_BACK'].includes(target.status)) throw new ReleaseFailure('INVALID_STATE')
    if (!target.imageReference || !target.buildArtifactKey || !target.buildSha256) throw new ReleaseFailure('ARTIFACT_MISSING')
    if (target.quarantinedAt) throw new ReleaseFailure('QUARANTINED')
    if (website.suspendedAt) throw new ReleaseFailure('SUSPENDED')

    // Preview-to-production integrity: the stored build artifact must still match the hash recorded at
    // validation time (the image id itself is content-addressed). Any mismatch = tampering → refuse.
    const actual = await sha256File(ctx.storage.localPath(target.buildArtifactKey)).catch(() => null)
    if (actual !== target.buildSha256) {
      await raiseAlert(ctx.db, 'ARTIFACT_INTEGRITY', { departmentId: website.departmentId, deploymentId: target.id })
      throw new ReleaseFailure('ARTIFACT_INTEGRITY_FAILED')
    }

    await addLog(ctx.db, target.id, isRollback ? 'Rolling back: starting this version.' : 'Starting the new version alongside production.')
    let imageRef = target.imageReference
    if (!(await ctx.runtime.imageExists(imageRef))) {
      imageRef = await rebuildFromArtifact(ctx, fence, target.id, target.buildArtifactKey, signal)
    }

    // 1. Start the new version next to the current one.
    const { upstream } = await ctx.runtime.startContainer({ name: newName, imageRef, kind: 'production', deploymentId: target.id, websiteId: website.id })

    // 2. Readiness check directly against the new container.
    if (!(await ctx.runtime.checkHealth(upstream, target.id, ctx.cfg.HEALTH_CHECK_TIMEOUT_SECONDS * 1000))) {
      throw new ReleaseFailure('HEALTH_CHECK_FAILED')
    }
    await addLog(ctx.db, target.id, 'Readiness checks passed. Switching traffic.')

    // 3. Make sure we still own the job before touching production routing.
    await ctx.db.$transaction((tx) => assertLease(tx, fence))
    previousRoute = await ctx.router.getRoute(siteRoute)
    await ctx.router.setRoute({ name: siteRoute, host: website.hostname, upstream, preview: false, deploymentId: target.id })
    switched = true

    // 4. Verify end-to-end through the reverse proxy.
    if (!(await ctx.router.verifyThroughProxy(website.hostname, target.id, ctx.cfg.HEALTH_CHECK_TIMEOUT_SECONDS * 1000))) {
      throw new ReleaseFailure('ROUTE_SWITCH_FAILED')
    }

    await ctx.hooks?.beforePointerCommit?.()

    // 5. Commit the production pointer atomically, fenced by the job lease and the website row lock.
    await ctx.db.$transaction(async (tx) => {
      await assertLease(tx, fence)
      await tx.$queryRaw`SELECT id FROM websites WHERE id = ${website.id} FOR UPDATE`
      const current = await tx.website.findUniqueOrThrow({ where: { id: website.id } })
      if (current.activeDeploymentId !== previousActiveId) throw new ReleaseFailure('SUPERSEDED')
      const now = new Date()
      if (isRollback) {
        if (target.status === 'ROLLED_BACK') await transition(tx, target.id, ['ROLLED_BACK'], 'LIVE', { deployedAt: now })
        else await tx.deployment.update({ where: { id: target.id }, data: { deployedAt: now } })
        if (previousActiveId) await tx.deployment.updateMany({ where: { id: previousActiveId, status: 'LIVE' }, data: { status: 'ROLLED_BACK' } })
      } else {
        await transition(tx, target.id, ['DEPLOYING'], 'LIVE', { deployedAt: now, errorCode: null })
      }
      await tx.website.update({ where: { id: website.id }, data: { activeDeploymentId: target.id } })
      await completeJob(tx, fence, 'SUCCEEDED')
      await audit(tx, {
        action: isRollback ? 'ROLLBACK_COMPLETED' : 'DEPLOYMENT_LIVE',
        actorUserId: job.requestedByUserId,
        departmentId: website.departmentId,
        websiteId: website.id,
        deploymentId: target.id,
        metadata: { previous: previousActiveId, version: target.version },
      })
    })
    await addLog(ctx.db, target.id, isRollback ? 'Rollback complete. This version is now live.' : 'Deployment complete. This version is now live.')

    // 6. Retire the previous container after a short drain. Its image stays for rollback.
    if (previousActiveId && previousActiveId !== target.id) {
      if (ctx.cfg.DRAIN_SECONDS > 0) await new Promise((r) => setTimeout(r, ctx.cfg.DRAIN_SECONDS * 1000))
      await ctx.runtime.stopContainer(containerName.production(previousActiveId)).catch(() => undefined)
    }
  } catch (e) {
    await handleReleaseError(ctx, job, fence, e, { switched, previousRoute, siteRoute, newName, websiteId: website.id, departmentId: website.departmentId, isRollback })
  }
}

async function rebuildFromArtifact(ctx: WorkerContext, fence: Fence, deploymentId: string, buildKey: string | null, signal: AbortSignal): Promise<string> {
  if (!buildKey || !(await ctx.storage.exists(buildKey))) throw new ReleaseFailure('ARTIFACT_MISSING')
  await addLog(ctx.db, deploymentId, 'Image not found locally; rebuilding from the stored build artifact.', 'warn')
  const work = await mkdtemp(path.join(ctx.cfg.WORK_DIR ?? tmpdir(), 'ds-rebuild-'))
  try {
    const siteDir = path.join(work, 'site')
    await mkdir(siteDir)
    await extractZip(ctx.storage.localPath(buildKey), siteDir, ctx.cfg.limits)
    await prepareContext(ctx, work, deploymentId)
    const { imageRef } = await ctx.runtime.buildImage({ deploymentId, contextDir: work, signal })
    await ctx.db.$transaction(async (tx) => {
      await assertLease(tx, fence)
      await tx.deployment.update({ where: { id: deploymentId }, data: { imageReference: imageRef } })
    })
    return imageRef
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function handleReleaseError(
  ctx: WorkerContext,
  job: ClaimedJob,
  fence: Fence,
  e: unknown,
  s: { switched: boolean; previousRoute: RouteSpec | null; siteRoute: string; newName: string; websiteId: string; departmentId: string; isRollback: boolean },
): Promise<void> {
  const code = e instanceof ReleaseFailure ? e.code : e instanceof RuntimeError ? e.code : e instanceof StaleLeaseError ? 'STALE' : 'INTERNAL'
  if (code === 'INTERNAL') log.error('worker.release_error', { jobId: job.id, error: e })

  // Restore production routing to what it was before this job touched it.
  if (s.switched) {
    try {
      if (s.previousRoute) await ctx.router.setRoute(s.previousRoute)
      else await ctx.router.removeRoute(s.siteRoute)
    } catch (err) {
      log.error('worker.route_restore_failed', { jobId: job.id, error: err })
    }
  }

  if (code === 'STALE') {
    // Someone else (reaper/newer worker) owns the outcome; converge routes to the DB pointer and stop.
    await reconcileWebsite(ctx, s.websiteId).catch(() => undefined)
    return
  }

  const active = await ctx.db.website.findUnique({ where: { id: s.websiteId }, select: { activeDeploymentId: true } })
  if (active?.activeDeploymentId !== job.deploymentId) await ctx.runtime.stopContainer(s.newName).catch(() => undefined)

  try {
    await ctx.db.$transaction(async (tx) => {
      await assertLease(tx, fence)
      if (!s.isRollback) {
        await tx.deployment.updateMany({ where: { id: job.deploymentId, status: 'DEPLOYING' }, data: { status: 'FAILED', errorCode: code } })
      }
      await completeJob(tx, fence, 'FAILED', code)
      await audit(tx, {
        action: s.isRollback ? 'ROLLBACK_FAILED' : 'DEPLOYMENT_FAILED',
        actorUserId: job.requestedByUserId,
        departmentId: s.departmentId,
        websiteId: s.websiteId,
        deploymentId: job.deploymentId,
        metadata: { errorCode: code },
      })
    })
  } catch (err) {
    if (!(err instanceof StaleLeaseError)) throw err
  }
  await addLog(ctx.db, job.deploymentId, `${s.isRollback ? 'Rollback' : 'Deployment'} failed (${code}). The previous production version is still live.`, 'error')
  await reconcileWebsite(ctx, s.websiteId).catch(() => undefined)
}
