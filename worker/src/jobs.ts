import type { DeploymentJob, JobStatus } from '@/generated/prisma/client'
import type { Tx } from '@/server/db'
import { randomHex } from '@/server/crypto'
import { StaleLeaseError, type Fence } from '@/server/deployments/state'
import { audit } from '@/server/audit'
import { log } from '@/server/log'
import type { WorkerContext } from './context'
import { addLog } from './context'

export type ClaimedJob = DeploymentJob & { leaseToken: string }

/** Claims the oldest runnable job. SKIP LOCKED lets several workers poll without contention. */
export async function claimNextJob(ctx: WorkerContext): Promise<ClaimedJob | null> {
  const now = new Date()
  return ctx.db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM deployment_jobs
      WHERE status = 'QUEUED' AND run_after <= ${now}
      ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`
    const id = rows[0]?.id
    if (!id) return null
    const job = await tx.deploymentJob.update({
      where: { id },
      data: {
        status: 'RUNNING',
        attempts: { increment: 1 },
        leaseToken: randomHex(16), // new fencing token per claim
        leaseOwner: ctx.cfg.WORKER_ID.slice(0, 100),
        leaseExpiresAt: new Date(now.getTime() + ctx.cfg.WORKER_LEASE_SECONDS * 1000),
        startedAt: now,
      },
    })
    return job as ClaimedJob
  })
}

/** Extends the lease. Returns false when the lease was lost (job reaped / re-claimed elsewhere). */
export async function heartbeat(ctx: WorkerContext, fence: Fence): Promise<boolean> {
  const res = await ctx.db.deploymentJob.updateMany({
    where: { id: fence.jobId, leaseToken: fence.leaseToken, status: 'RUNNING' },
    data: { leaseExpiresAt: new Date(Date.now() + ctx.cfg.WORKER_LEASE_SECONDS * 1000) },
  })
  return res.count === 1
}

/** Fenced job completion; also releases the per-website production lock. */
export async function completeJob(tx: Tx, fence: Fence, status: Extract<JobStatus, 'SUCCEEDED' | 'FAILED'>, errorCode: string | null = null): Promise<void> {
  const res = await tx.deploymentJob.updateMany({
    where: { id: fence.jobId, leaseToken: fence.leaseToken, status: 'RUNNING' },
    data: { status, errorCode, finishedAt: new Date(), activeLockKey: null, leaseExpiresAt: null },
  })
  if (res.count !== 1) throw new StaleLeaseError()
}

/** Puts a job back in the queue for a retry with backoff (fenced). */
export async function requeueJob(ctx: WorkerContext, fence: Fence, attempts: number, errorCode: string): Promise<void> {
  const delay = Math.min(60_000, 2 ** attempts * 2_000)
  await ctx.db.deploymentJob.updateMany({
    where: { id: fence.jobId, leaseToken: fence.leaseToken, status: 'RUNNING' },
    data: { status: 'QUEUED', errorCode, leaseToken: null, leaseOwner: null, leaseExpiresAt: null, runAfter: new Date(Date.now() + delay) },
  })
}

/**
 * Recovers jobs whose worker died or hung (lease expired). Builds are retried; production changes
 * are failed (never auto-retried) and the website is reconciled back to its DB pointer.
 * Returns ids of websites that need route reconciliation.
 */
export async function reapExpiredLeases(ctx: WorkerContext): Promise<string[]> {
  const now = new Date()
  const expired = await ctx.db.deploymentJob.findMany({ where: { status: 'RUNNING', leaseExpiresAt: { lt: now } }, take: 20 })
  const touched: string[] = []
  for (const job of expired) {
    await ctx.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM deployment_jobs
        WHERE id = ${job.id} AND status = 'RUNNING' AND lease_expires_at < ${now} FOR UPDATE SKIP LOCKED`
      if (!locked.length) return
      if (job.jobType === 'BUILD' && job.attempts < job.maxAttempts) {
        await tx.deploymentJob.update({
          where: { id: job.id },
          data: { status: 'QUEUED', leaseToken: null, leaseOwner: null, leaseExpiresAt: null, errorCode: 'WORKER_LOST', runAfter: new Date(now.getTime() + 5_000) },
        })
        return
      }
      await tx.deploymentJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', errorCode: 'WORKER_LOST', activeLockKey: null, leaseToken: null, leaseExpiresAt: null, finishedAt: now },
      })
      const fromStatuses = job.jobType === 'PROMOTE' ? (['DEPLOYING'] as const) : job.jobType === 'BUILD' ? (['UPLOADED', 'VALIDATING', 'BUILDING'] as const) : ([] as const)
      if (fromStatuses.length) {
        const res = await tx.deployment.updateMany({ where: { id: job.deploymentId, status: { in: [...fromStatuses] } }, data: { status: 'FAILED', errorCode: 'WORKER_LOST' } })
        if (res.count) {
          const w = await tx.website.findUnique({ where: { id: job.websiteId }, select: { departmentId: true } })
          await audit(tx, { action: 'DEPLOYMENT_FAILED', departmentId: w?.departmentId, websiteId: job.websiteId, deploymentId: job.deploymentId, metadata: { errorCode: 'WORKER_LOST', job: job.jobType } })
        }
      }
      touched.push(job.websiteId)
    })
    if (touched.includes(job.websiteId)) {
      await addLog(ctx.db, job.deploymentId, 'The deployment worker stopped unexpectedly. Production was not changed.', 'error').catch(() => undefined)
      log.warn('worker.job_reaped', { jobId: job.id, type: job.jobType })
    }
  }
  return touched
}
