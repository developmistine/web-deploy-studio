import { Prisma } from '@/generated/prisma/client'
import type { Db, Tx } from '@/server/db'
import type { Actor } from '@/server/auth/session'
import type { DeploymentDTO, DeploymentLogDTO } from '@/lib/types'
import { rollbackSchema } from '@/lib/validation'
import { authorizeDepartment } from '@/server/services/guard'
import { AppError } from '@/server/http/errors'
import { audit } from '@/server/audit'
import { getConfig } from '@/server/config'
import { getStorage, storageKeys } from '@/server/storage'
import { transition } from '@/server/deployments/state'
import { handshakeUrl } from '@/server/gateway/access'
import { requiresStepUp } from '@/server/authz/policy'
import { deploymentInclude, toDeploymentDTO } from '@/server/services/dto'
import type { ReceivedUpload } from '@/server/uploads/intake'
import { log } from '@/server/log'

async function lockWebsite(tx: Tx, websiteId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM websites WHERE id = ${websiteId} FOR UPDATE`
}

async function loadDeploymentForActor(db: Db, actor: Actor, id: string, action: string) {
  const d = await db.deployment.findUnique({ where: { id }, include: { ...deploymentInclude, website: true } })
  if (!d) throw new AppError('NOT_FOUND')
  await authorizeDepartment(db, actor, d.website.departmentId, { action, websiteId: d.websiteId, deploymentId: id })
  return d
}

/** Incident-response flags set by the protected admin CLI block every change. */
function assertNotSuspended(website: { suspendedAt: Date | null }) {
  if (website.suspendedAt) throw new AppError('WEBSITE_SUSPENDED')
}

/** Sensitive admin cross-department production changes require a recent password confirmation. */
async function assertStepUp(db: Db, actor: Actor, departmentId: string, websiteId: string) {
  if (!requiresStepUp(actor, departmentId, getConfig().ADMIN_STEP_UP_MAX_AGE_MINUTES)) return
  await audit(db, { action: 'REAUTH_REQUIRED', actorUserId: actor.userId, departmentId, websiteId })
  throw new AppError('REAUTH_REQUIRED')
}

export async function getDeployment(db: Db, actor: Actor, id: string): Promise<DeploymentDTO> {
  const d = await loadDeploymentForActor(db, actor, id, 'deployment.read')
  return toDeploymentDTO(d, d.website.activeDeploymentId)
}

export async function listDeployments(db: Db, actor: Actor, websiteId: string, limit = 50): Promise<DeploymentDTO[]> {
  const w = await db.website.findUnique({ where: { id: websiteId } })
  if (!w) throw new AppError('NOT_FOUND')
  await authorizeDepartment(db, actor, w.departmentId, { action: 'deployment.list', websiteId })
  const rows = await db.deployment.findMany({
    where: { websiteId },
    orderBy: { version: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
    include: deploymentInclude,
  })
  return rows.map((d) => toDeploymentDTO(d, w.activeDeploymentId))
}

export async function getDeploymentLogs(db: Db, actor: Actor, id: string): Promise<DeploymentLogDTO[]> {
  await loadDeploymentForActor(db, actor, id, 'deployment.logs')
  const rows = await db.deploymentLog.findMany({ where: { deploymentId: id }, orderBy: { id: 'asc' }, take: 500 })
  return rows.map((r) => ({ id: r.id.toString(), level: r.level, message: r.message, createdAt: r.createdAt.toISOString() }))
}

/**
 * Creates an immutable revision for the department's website from a validated upload, stores the
 * source artifact privately and enqueues the asynchronous BUILD job. Never builds synchronously.
 */
export async function createDeployment(db: Db, actor: Actor, websiteId: string, upload: ReceivedUpload): Promise<DeploymentDTO> {
  const website = await db.website.findUnique({ where: { id: websiteId } })
  if (!website) throw new AppError('NOT_FOUND')
  await authorizeDepartment(db, actor, website.departmentId, { action: 'deployment.create', websiteId })
  assertNotSuspended(website)

  // 1. Allocate the next version under a row lock (serializes concurrent uploads per website).
  const draft = await db.$transaction(async (tx) => {
    await lockWebsite(tx, websiteId)
    const w = await tx.website.update({ where: { id: websiteId }, data: { nextVersion: { increment: 1 } } })
    return tx.deployment.create({
      data: {
        websiteId,
        version: w.nextVersion - 1,
        uploadedByUserId: actor.userId,
        originalFilename: upload.originalFilename,
        fileCount: upload.fileCount,
        sourceSizeBytes: upload.size,
        sourceSha256: upload.sha256,
        status: 'DRAFT',
      },
    })
  })

  // 2. Persist the source artifact (write-once) outside the DB transaction.
  const key = storageKeys.source(websiteId, draft.id)
  try {
    const stored = await getStorage().putFile(key, upload.zipPath)
    if (stored.sha256 !== upload.sha256) throw new Error('artifact hash mismatch after store')
  } catch (e) {
    log.error('deployment.store_failed', { deploymentId: draft.id, error: e })
    await db.$transaction((tx) => transition(tx, draft.id, ['DRAFT'], 'FAILED', { errorCode: 'ARTIFACT_MISSING' }))
    throw new AppError('INTERNAL')
  }

  // 3. Mark UPLOADED + enqueue BUILD atomically.
  await db.$transaction(async (tx) => {
    await transition(tx, draft.id, ['DRAFT'], 'UPLOADED', { sourceArtifactKey: key })
    await tx.deploymentJob.create({
      data: { deploymentId: draft.id, websiteId, jobType: 'BUILD', requestedByUserId: actor.userId },
    })
    await tx.deploymentLog.create({ data: { deploymentId: draft.id, level: 'info', message: `Upload received (${upload.fileCount} files). Queued for validation.` } })
    await audit(tx, {
      action: 'DEPLOYMENT_UPLOADED',
      actorUserId: actor.userId,
      departmentId: website.departmentId,
      websiteId,
      deploymentId: draft.id,
      metadata: { version: draft.version, sha256: upload.sha256, size: upload.size, files: upload.fileCount },
    })
  })
  return getDeployment(db, actor, draft.id)
}

export type PreviewLaunch = { status: 'READY'; launchUrl: string; expiresAt: string } | { status: 'RESTARTING' }

/**
 * Issues a short-lived, deployment-bound preview capability after server-side authorization.
 * If the isolated preview has expired, enqueues a restart (from the existing immutable image).
 */
export async function openPreview(db: Db, actor: Actor, id: string, sessionId: string): Promise<PreviewLaunch> {
  const d = await loadDeploymentForActor(db, actor, id, 'deployment.preview')
  assertNotSuspended(d.website)
  if (d.quarantinedAt || d.status !== 'PREVIEW_READY' || !d.previewUrl) throw new AppError('INVALID_STATE')

  if (!d.previewExpiresAt || d.previewExpiresAt.getTime() <= Date.now()) {
    await db.$transaction(async (tx) => {
      const pending = await tx.deploymentJob.findFirst({ where: { deploymentId: id, jobType: 'BUILD', status: { in: ['QUEUED', 'RUNNING'] } } })
      if (pending) return
      await transition(tx, id, ['PREVIEW_READY'], 'BUILDING')
      await tx.deploymentJob.create({ data: { deploymentId: id, websiteId: d.websiteId, jobType: 'BUILD', requestedByUserId: actor.userId } })
      await tx.deploymentLog.create({ data: { deploymentId: id, level: 'info', message: 'Preview expired. Restarting preview environment.' } })
    })
    return { status: 'RESTARTING' }
  }

  // Handshake bound to this preview host + the caller's session; the gate re-checks authorization per request.
  const launchUrl = handshakeUrl(
    { kind: 'preview', host: new URL(d.previewUrl).hostname, departmentId: d.website.departmentId, websiteId: d.websiteId, deploymentId: d.id, suspended: false, live: true },
    sessionId,
    actor.userId,
  )

  await db.$transaction(async (tx) => {
    await tx.deployment.update({ where: { id }, data: { previewViewedAt: d.previewViewedAt ?? new Date() } })
    await audit(tx, { action: 'PREVIEW_OPENED', actorUserId: actor.userId, departmentId: d.website.departmentId, websiteId: d.websiteId, deploymentId: id })
  })
  return { status: 'READY', launchUrl, expiresAt: d.previewExpiresAt.toISOString() }
}

function isLockConflict(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}

/**
 * Requests production promotion. Requirements: PREVIEW_READY, preview opened, image built.
 * Serialized per website by the active_lock_key UNIQUE index. Idempotent: re-requesting an
 * in-flight promotion of the same deployment returns its current state.
 */
export async function promote(db: Db, actor: Actor, id: string): Promise<DeploymentDTO> {
  const d = await loadDeploymentForActor(db, actor, id, 'deployment.promote')
  if (d.status === 'DEPLOYING' || (d.status === 'LIVE' && d.id === d.website.activeDeploymentId)) {
    return toDeploymentDTO(d, d.website.activeDeploymentId)
  }
  assertNotSuspended(d.website)
  // Preview-to-production integrity: only the exact validated, built and previewed revision can be promoted.
  if (d.quarantinedAt || d.status !== 'PREVIEW_READY' || !d.imageReference || !d.buildArtifactKey || !d.buildSha256) {
    throw new AppError('INVALID_STATE')
  }
  if (!d.previewViewedAt) throw new AppError('PREVIEW_REQUIRED')
  await assertStepUp(db, actor, d.website.departmentId, d.websiteId)

  try {
    await db.$transaction(async (tx) => {
      await lockWebsite(tx, d.websiteId)
      const busy = await tx.deploymentJob.findUnique({ where: { activeLockKey: d.websiteId } })
      if (busy) throw new AppError('PROMOTION_IN_PROGRESS')
      await transition(tx, id, ['PREVIEW_READY'], 'DEPLOYING', { errorCode: null })
      await tx.deploymentJob.create({
        data: { deploymentId: id, websiteId: d.websiteId, jobType: 'PROMOTE', activeLockKey: d.websiteId, maxAttempts: 1, requestedByUserId: actor.userId },
      })
      await tx.deploymentLog.create({ data: { deploymentId: id, level: 'info', message: 'Production release requested.' } })
      await audit(tx, {
        action: 'PROMOTION_REQUESTED',
        actorUserId: actor.userId,
        departmentId: d.website.departmentId,
        websiteId: d.websiteId,
        deploymentId: id,
        metadata: { version: d.version, previousActive: d.website.activeDeploymentId },
      })
    })
  } catch (e) {
    if (isLockConflict(e)) throw new AppError('PROMOTION_IN_PROGRESS')
    if (e instanceof Error && e.name === 'InvalidTransitionError') {
      // Lost a race with a concurrent identical request: report current state.
      return getDeployment(db, actor, id)
    }
    throw e
  }
  return getDeployment(db, actor, id)
}

/** Requests a rollback to a known-good revision (default: the most recently deployed non-active one). */
export async function rollback(db: Db, actor: Actor, websiteId: string, input: unknown): Promise<DeploymentDTO> {
  const body = rollbackSchema.parse(input ?? {})
  const website = await db.website.findUnique({ where: { id: websiteId } })
  if (!website) throw new AppError('NOT_FOUND')
  await authorizeDepartment(db, actor, website.departmentId, { action: 'website.rollback', websiteId })
  assertNotSuspended(website)
  await assertStepUp(db, actor, website.departmentId, websiteId)

  let targetId: string | null = null
  try {
    targetId = await db.$transaction(async (tx) => {
      await lockWebsite(tx, websiteId)
      const current = await tx.website.findUniqueOrThrow({ where: { id: websiteId } })
      const busy = await tx.deploymentJob.findUnique({ where: { activeLockKey: websiteId } })
      if (busy) throw new AppError('PROMOTION_IN_PROGRESS')
      const candidates = await tx.deployment.findMany({
        where: {
          websiteId,
          status: { in: ['LIVE', 'ROLLED_BACK'] },
          quarantinedAt: null,
          imageReference: { not: null },
          buildSha256: { not: null },
          deployedAt: { not: null },
          ...(current.activeDeploymentId ? { id: { not: current.activeDeploymentId } } : {}),
          ...(body.targetDeploymentId ? { id: body.targetDeploymentId } : {}),
        },
        orderBy: { deployedAt: 'desc' },
        take: 1,
      })
      const target = candidates[0]
      if (body.targetDeploymentId && target?.id === current.activeDeploymentId) throw new AppError('INVALID_STATE')
      if (!target) throw new AppError('NO_ROLLBACK_TARGET')
      await tx.deploymentJob.create({
        data: {
          deploymentId: target.id,
          websiteId,
          jobType: 'ROLLBACK',
          activeLockKey: websiteId,
          maxAttempts: 1,
          fromDeploymentId: current.activeDeploymentId,
          requestedByUserId: actor.userId,
        },
      })
      await tx.deploymentLog.create({ data: { deploymentId: target.id, level: 'info', message: 'Rollback to this version requested.' } })
      await audit(tx, {
        action: 'ROLLBACK_REQUESTED',
        actorUserId: actor.userId,
        departmentId: website.departmentId,
        websiteId,
        deploymentId: target.id,
        metadata: { from: current.activeDeploymentId, toVersion: target.version },
      })
      return target.id
    })
  } catch (e) {
    if (isLockConflict(e)) throw new AppError('PROMOTION_IN_PROGRESS')
    throw e
  }
  return getDeployment(db, actor, targetId!)
}
