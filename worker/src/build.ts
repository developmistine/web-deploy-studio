import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import type { DeploymentStatus } from '@/generated/prisma/client'
import { AppError } from '@/server/http/errors'
import { extractZip } from '@/server/uploads/archive'
import { rejectReason } from '@/server/uploads/limits'
import { fileKind, scanSite } from '@/server/uploads/content-scan'
import { raiseAlert } from '@/server/security-alerts'
import { sha256File, storageKeys } from '@/server/storage'
import { assertLease, StaleLeaseError, transition, type Fence } from '@/server/deployments/state'
import { previewHostFor, urlForHost } from '@/server/deployments/hostnames'
import { randomDnsLabel } from '@/server/crypto'
import { audit } from '@/server/audit'
import { log } from '@/server/log'
import type { WorkerContext } from './context'
import { addLog } from './context'
import { completeJob, requeueJob, type ClaimedJob } from './jobs'
import { containerName, RuntimeError } from './runtime/types'
import { routeName } from './routing/types'

class BuildFailure extends Error {
  constructor(readonly code: string, readonly retryable: boolean) {
    super(code)
  }
}

/** Writes the controlled build context: template Dockerfile, rendered nginx conf, validated files under site/. */
export async function prepareContext(ctx: WorkerContext, contextDir: string, deploymentId: string): Promise<void> {
  const dockerfile = await readFile(path.join(ctx.templateDir, 'Dockerfile'), 'utf8')
  const conf = (await readFile(path.join(ctx.templateDir, 'default.conf.template'), 'utf8'))
    .replaceAll('__DEPLOYMENT_ID__', deploymentId)
    .replaceAll('__FRAME_ANCESTORS__', new URL(ctx.cfg.APP_URL).origin)
    .replaceAll('__SITE_CSP__', ctx.cfg.SITE_CSP)
  await writeFile(path.join(contextDir, 'Dockerfile'), dockerfile)
  await writeFile(path.join(contextDir, 'default.conf'), conf)
}

async function writeCanonicalZip(siteDir: string, files: { path: string }[], out: string): Promise<void> {
  const zip = new yazl.ZipFile()
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    zip.addFile(path.join(siteDir, ...f.path.split('/')), f.path, { mtime: new Date(0), mode: 0o100644 })
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(out, { flags: 'wx' }))
}

const PIPELINE: DeploymentStatus[] = ['UPLOADED', 'VALIDATING', 'BUILDING']

/**
 * Moves the deployment forward along UPLOADED → VALIDATING → BUILDING. When a retried job finds the
 * deployment already at or past `to` (crash after a transition), it resumes instead of failing.
 */
async function advance(ctx: WorkerContext, fence: Fence, id: string, to: DeploymentStatus, from: DeploymentStatus[], data = {}) {
  await ctx.db.$transaction(async (tx) => {
    const d = await tx.deployment.findUniqueOrThrow({ where: { id } })
    if (PIPELINE.includes(d.status) && PIPELINE.indexOf(d.status) >= PIPELINE.indexOf(to)) {
      await assertLease(tx, fence)
      if (Object.keys(data).length) await tx.deployment.update({ where: { id }, data })
      return
    }
    await transition(tx, id, from, to, data, fence)
  })
}

/**
 * Suspicious-script check (heuristic, see src/server/uploads/content-scan.ts). Findings are stored on the revision
 * and logged; HIGH findings block the upload when CONTENT_SCAN_MODE=block and raise a security alert.
 */
async function inspectContent(ctx: WorkerContext, fence: Fence, d: { id: string; websiteId: string; website: { departmentId: string } }, siteDir: string, paths: string[]) {
  if (ctx.cfg.CONTENT_SCAN_MODE === 'off') {
    await addLog(ctx.db, d.id, 'Suspicious-script check is disabled in this environment.', 'warn')
    return
  }
  const texts = await Promise.all(
    paths.filter((p) => fileKind(p)).map(async (p) => ({ path: p, text: await readFile(path.join(siteDir, p), 'utf8') })),
  )
  const findings = scanSite(texts)
  await ctx.db.$transaction(async (tx) => {
    await assertLease(tx, fence)
    await tx.deployment.update({ where: { id: d.id }, data: { contentFindings: findings } })
  })
  if (!findings.length) {
    await addLog(ctx.db, d.id, 'Suspicious-script check: nothing found.')
    return
  }
  for (const f of findings.slice(0, 20)) {
    await addLog(ctx.db, d.id, `${f.severity === 'high' ? 'BLOCKED' : 'Review'}: ${f.path}:${f.line} — ${f.message}`, f.severity === 'high' ? 'error' : 'warn')
  }
  const high = findings.filter((f) => f.severity === 'high')
  if (high.length && ctx.cfg.CONTENT_SCAN_MODE === 'block') {
    await raiseAlert(ctx.db, 'SUSPICIOUS_CONTENT', { departmentId: d.website.departmentId, deploymentId: d.id, rules: [...new Set(high.map((f) => f.rule))] })
    throw new BuildFailure('SUSPICIOUS_CONTENT', false)
  }
}

export async function runBuild(ctx: WorkerContext, job: ClaimedJob, fence: Fence, signal: AbortSignal): Promise<void> {
  const d = await ctx.db.deployment.findUniqueOrThrow({ where: { id: job.deploymentId }, include: { website: true } })
  const work = await mkdtemp(path.join(ctx.cfg.WORK_DIR ?? tmpdir(), 'ds-build-'))
  try {
    if (!d.imageReference) {
      // ---- VALIDATING -------------------------------------------------------------
      await advance(ctx, fence, d.id, 'VALIDATING', ['UPLOADED'])
      await addLog(ctx.db, d.id, 'Validating uploaded files.')
      if (!d.sourceArtifactKey || !d.sourceSha256) throw new BuildFailure('ARTIFACT_MISSING', false)
      const source = ctx.storage.localPath(d.sourceArtifactKey)
      if ((await sha256File(source).catch(() => null)) !== d.sourceSha256) throw new BuildFailure('ARTIFACT_MISSING', false)

      const scan = await ctx.scanner.scanFile(source).catch((e: unknown) => {
        log.error('worker.malware_scan_error', { deploymentId: d.id, error: e })
        throw new BuildFailure('MALWARE_SCAN_UNAVAILABLE', true)
      })
      if (!scan.clean) {
        log.warn('worker.malware_detected', { deploymentId: d.id, signature: scan.signature })
        throw new BuildFailure('MALWARE_DETECTED', false)
      }
      if (ctx.scanner.name === 'none') await addLog(ctx.db, d.id, 'Malware scanning is not configured in this environment.', 'warn')

      const contextDir = path.join(work, 'context')
      const siteDir = path.join(contextDir, 'site')
      await mkdir(siteDir, { recursive: true })
      const manifest = await extractZip(source, siteDir, ctx.cfg.limits)
      await addLog(ctx.db, d.id, `Validated ${manifest.files.length} files (${Math.ceil(manifest.totalBytes / 1024)} KB).`)
      await inspectContent(ctx, fence, d, siteDir, manifest.files.map((f) => f.path))

      // Immutable build artifact (canonical, validated bundle) — reused for rebuilds/rollback.
      const buildKey = storageKeys.build(d.websiteId, d.id)
      let buildSha256: string
      if (await ctx.storage.exists(buildKey)) {
        buildSha256 = await sha256File(ctx.storage.localPath(buildKey))
      } else {
        const bundle = path.join(work, 'bundle.zip')
        await writeCanonicalZip(siteDir, manifest.files, bundle)
        buildSha256 = (await ctx.storage.putFile(buildKey, bundle)).sha256
      }

      // ---- BUILDING ---------------------------------------------------------------
      await advance(ctx, fence, d.id, 'BUILDING', ['VALIDATING'], { buildArtifactKey: buildKey, buildSha256 })
      await addLog(ctx.db, d.id, 'Packaging website with the standard static-site image.')
      await prepareContext(ctx, contextDir, d.id)
      const { imageRef } = await ctx.runtime.buildImage({ deploymentId: d.id, contextDir, signal })
      await ctx.runtime.scanImage(imageRef, signal)
      await ctx.db.$transaction(async (tx) => {
        await assertLease(tx, fence)
        await tx.deployment.update({ where: { id: d.id }, data: { imageReference: imageRef } })
      })
      d.imageReference = imageRef
    } else {
      await addLog(ctx.db, d.id, 'Restarting preview environment.')
    }

    // ---- ISOLATED PREVIEW -----------------------------------------------------------
    const label = d.previewUrl ? new URL(d.previewUrl).hostname.split('.')[0]! : randomDnsLabel()
    const host = previewHostFor(label, ctx.cfg.PREVIEW_BASE_URL)
    const name = containerName.preview(d.id)
    const { upstream } = await ctx.runtime.startContainer({ name, imageRef: d.imageReference, kind: 'preview', deploymentId: d.id, websiteId: d.websiteId })
    if (!(await ctx.runtime.checkHealth(upstream, d.id, ctx.cfg.HEALTH_CHECK_TIMEOUT_SECONDS * 1000))) {
      throw new RuntimeError('PREVIEW_START_FAILED', 'preview did not become healthy', true)
    }
    // Register the host first so the gateway recognises it for the worker's probe. It stays non-servable to users
    // until PREVIEW_READY sets previewExpiresAt (see resolveHostTarget: preview `live` requires an expiry).
    await ctx.db.$transaction(async (tx) => {
      await assertLease(tx, fence)
      await tx.deployment.update({ where: { id: d.id }, data: { previewUrl: urlForHost(host, ctx.cfg.PREVIEW_BASE_URL) } })
    })
    await ctx.router.setRoute({ name: routeName.preview(d.id), host, upstream, preview: true, deploymentId: d.id })
    // Traefik reloads route files asynchronously: only report PREVIEW_READY once the proxy actually serves this
    // revision on the preview host — otherwise the browser loads the proxy's 404 and Deploy would unlock on it.
    if (!(await ctx.router.verifyThroughProxy(host, d.id, ctx.cfg.HEALTH_CHECK_TIMEOUT_SECONDS * 1000))) {
      throw new RuntimeError('PREVIEW_START_FAILED', 'preview route not reachable through the proxy', true)
    }

    await ctx.db.$transaction(async (tx) => {
      await transition(
        tx,
        d.id,
        ['BUILDING'],
        'PREVIEW_READY',
        { previewUrl: urlForHost(host, ctx.cfg.PREVIEW_BASE_URL), previewExpiresAt: new Date(Date.now() + ctx.cfg.PREVIEW_TTL_MINUTES * 60_000), errorCode: null },
        fence,
      )
      await completeJob(tx, fence, 'SUCCEEDED')
      await audit(tx, { action: 'DEPLOYMENT_PREVIEW_READY', departmentId: d.website.departmentId, websiteId: d.websiteId, deploymentId: d.id })
    })
    await addLog(ctx.db, d.id, 'Preview is ready. Review it before deploying to production.')
  } catch (e) {
    await handleBuildError(ctx, job, fence, e)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function handleBuildError(ctx: WorkerContext, job: ClaimedJob, fence: Fence, e: unknown): Promise<void> {
  if (e instanceof StaleLeaseError) {
    log.warn('worker.stale_lease', { jobId: job.id })
    return // another worker owns this job now; write nothing
  }
  let code = 'INTERNAL'
  let retryable = true
  const reason = rejectReason(e)
  if (reason) {
    code = reason === 'MALWARE_DETECTED' ? 'MALWARE_DETECTED' : `UPLOAD_REJECTED:${reason}`
    retryable = false
  } else if (e instanceof BuildFailure) {
    code = e.code
    retryable = e.retryable
  } else if (e instanceof RuntimeError) {
    code = e.code
    retryable = e.retryable
  } else if (e instanceof AppError) {
    code = e.code
    retryable = false
  } else {
    log.error('worker.build_error', { jobId: job.id, deploymentId: job.deploymentId, error: e })
  }

  // Preview resources from a failed attempt are removed; production is never touched by BUILD jobs.
  await ctx.runtime.stopContainer(containerName.preview(job.deploymentId)).catch(() => undefined)
  await ctx.router.removeRoute(routeName.preview(job.deploymentId)).catch(() => undefined)

  if (retryable && job.attempts < job.maxAttempts) {
    await addLog(ctx.db, job.deploymentId, 'A temporary problem occurred. Retrying shortly.', 'warn')
    await requeueJob(ctx, fence, job.attempts, code)
    return
  }
  try {
    await ctx.db.$transaction(async (tx) => {
      await assertLease(tx, fence)
      const d = await tx.deployment.findUniqueOrThrow({ where: { id: job.deploymentId }, include: { website: true } })
      if (['UPLOADED', 'VALIDATING', 'BUILDING', 'PREVIEW_READY'].includes(d.status)) {
        await transition(tx, d.id, [d.status], 'FAILED', { errorCode: code })
      }
      await completeJob(tx, fence, 'FAILED', code)
      await audit(tx, { action: 'DEPLOYMENT_FAILED', departmentId: d.website.departmentId, websiteId: d.websiteId, deploymentId: d.id, metadata: { errorCode: code } })
    })
    await addLog(ctx.db, job.deploymentId, code.startsWith('UPLOAD_REJECTED') ? `Validation failed: ${code.split(':')[1]}.` : 'Build failed. The current production website was not changed.', 'error')
  } catch (err) {
    if (!(err instanceof StaleLeaseError)) throw err
  }
}
