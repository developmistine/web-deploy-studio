import type { DeploymentStatus, Prisma } from '@/generated/prisma/client'
import type { Tx } from '@/server/db'

/**
 * The deployment state machine — the ONLY place transitions are defined.
 * LIVE = released successfully at least once (known-good). Which LIVE revision serves traffic
 * is decided solely by websites.active_deployment_id.
 */
export const TRANSITIONS: Record<DeploymentStatus, readonly DeploymentStatus[]> = {
  DRAFT: ['UPLOADED', 'FAILED'],
  UPLOADED: ['VALIDATING', 'FAILED'],
  VALIDATING: ['BUILDING', 'FAILED'],
  // BUILDING → PREVIEW_READY also covers "restart an expired preview from the existing image".
  BUILDING: ['PREVIEW_READY', 'FAILED'],
  PREVIEW_READY: ['DEPLOYING', 'BUILDING', 'FAILED'],
  DEPLOYING: ['LIVE', 'FAILED'],
  LIVE: ['ROLLED_BACK'],
  ROLLED_BACK: ['LIVE'],
  FAILED: [],
}

export function canTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  return TRANSITIONS[from].includes(to)
}

export class StaleLeaseError extends Error {
  constructor() {
    super('stale job lease')
    this.name = 'StaleLeaseError'
  }
}

export class InvalidTransitionError extends Error {
  constructor(id: string, to: DeploymentStatus) {
    super(`deployment ${id} cannot transition to ${to}`)
    this.name = 'InvalidTransitionError'
  }
}

export type Fence = { jobId: string; leaseToken: string }

/** Verifies (and row-locks) the job lease. A stale worker fails here and writes nothing. */
export async function assertLease(tx: Tx, fence: Fence): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM deployment_jobs
    WHERE id = ${fence.jobId} AND lease_token = ${fence.leaseToken} AND status = 'RUNNING' FOR UPDATE`
  if (rows.length !== 1) throw new StaleLeaseError()
}

/**
 * Compare-and-set status change. Only succeeds if the current status is one of `from`
 * and (optionally) the caller still holds the job lease.
 */
export async function transition(
  tx: Tx,
  deploymentId: string,
  from: readonly DeploymentStatus[],
  to: DeploymentStatus,
  data: Omit<Prisma.DeploymentUpdateManyMutationInput, 'status'> = {},
  fence?: Fence,
): Promise<void> {
  for (const f of from) if (!canTransition(f, to)) throw new InvalidTransitionError(deploymentId, to)
  if (fence) await assertLease(tx, fence)
  const res = await tx.deployment.updateMany({ where: { id: deploymentId, status: { in: [...from] } }, data: { ...data, status: to } })
  if (res.count !== 1) throw new InvalidTransitionError(deploymentId, to)
}
