import { log } from '@/server/log'
import type { Fence } from '@/server/deployments/state'
import type { WorkerContext } from './context'
import { claimNextJob, heartbeat, reapExpiredLeases, type ClaimedJob } from './jobs'
import { runBuild } from './build'
import { runRelease } from './release'
import { reconcileWebsite } from './reconcile'
import { runWithContext } from '@/server/request-context'

/** Runs one claimed job with lease heartbeats and an overall timeout. */
export async function processJob(ctx: WorkerContext, job: ClaimedJob): Promise<void> {
  // Audit events written while processing carry the job id as their correlation id.
  return runWithContext({ requestId: `job-${job.id}` }, () => processJobInner(ctx, job))
}

async function processJobInner(ctx: WorkerContext, job: ClaimedJob): Promise<void> {
  const fence: Fence = { jobId: job.id, leaseToken: job.leaseToken }
  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), ctx.cfg.JOB_TIMEOUT_SECONDS * 1000)
  const hb = setInterval(() => {
    heartbeat(ctx, fence)
      .then((ok) => {
        if (!ok) ac.abort() // lease lost: stop work; fencing blocks any further writes anyway
      })
      .catch(() => undefined)
  }, Math.max(1000, (ctx.cfg.WORKER_LEASE_SECONDS * 1000) / 3))
  try {
    log.info('worker.job_start', { jobId: job.id, type: job.jobType, deploymentId: job.deploymentId, attempt: job.attempts })
    if (job.jobType === 'BUILD') await runBuild(ctx, job, fence, ac.signal)
    else await runRelease(ctx, job, fence, ac.signal)
    log.info('worker.job_end', { jobId: job.id })
  } catch (e) {
    log.error('worker.job_crashed', { jobId: job.id, error: e })
  } finally {
    clearTimeout(timeout)
    clearInterval(hb)
  }
}

/** One scheduler tick: recover dead jobs, then run at most one job. Returns true if a job ran. */
export async function runOnce(ctx: WorkerContext): Promise<boolean> {
  const reaped = await reapExpiredLeases(ctx)
  for (const websiteId of reaped) await reconcileWebsite(ctx, websiteId).catch(() => undefined)
  const job = await claimNextJob(ctx)
  if (!job) return false
  await processJob(ctx, job)
  return true
}
