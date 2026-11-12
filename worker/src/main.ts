import 'dotenv/config'
import path from 'node:path'
import { createPrismaClient } from '@/server/db'
import { FsArtifactStorage } from '@/server/storage'
import { pruneRateLimits } from '@/server/rate-limit'
import { log } from '@/server/log'
import { loadWorkerConfig } from './config'
import type { WorkerContext } from './context'
import { DockerRuntime } from './runtime/docker'
import { FakeRuntime } from './runtime/fake'
import { TraefikFileRouter } from './routing/traefik-file'
import { MemoryRouter } from './routing/memory'
import { createScanner } from './scan'
import { runOnce } from './process'
import { reconcileAll, reconcileWebsite } from './reconcile'

/**
 * Deployment worker entrypoint. The ONLY process with access to the container runtime and proxy routes.
 * Talks to the web app exclusively through MySQL (deployment_jobs).
 */
async function main(): Promise<void> {
  const cfg = loadWorkerConfig()
  const db = createPrismaClient(cfg.DATABASE_URL)
  const fake = cfg.RUNTIME === 'fake' ? new FakeRuntime() : null
  const ctx: WorkerContext = {
    db,
    cfg,
    storage: new FsArtifactStorage(cfg.STORAGE_ROOT),
    runtime: fake ?? new DockerRuntime(cfg),
    router: fake ? new MemoryRouter(fake) : new TraefikFileRouter(cfg),
    scanner: createScanner(cfg),
    templateDir: process.env.SITE_TEMPLATE_DIR ?? path.resolve('infra/site-template'),
  }
  if (fake) log.warn('worker.fake_runtime', { note: 'RUNTIME=fake: nothing is actually built or served' })
  else await (ctx.router as TraefikFileRouter).installInfraConfig(process.env.PROXY_INFRA_CONFIG ?? path.resolve('infra/traefik/dynamic/00-infra.yml'))

  let stopping = false
  const stop = () => {
    stopping = true
    log.info('worker.stopping')
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)

  log.info('worker.started', { workerId: cfg.WORKER_ID, runtime: cfg.RUNTIME, scanner: ctx.scanner.name })
  await reconcileAll(ctx).catch((e: unknown) => log.error('worker.reconcile_failed', { error: e }))
  let lastReconcile = Date.now()
  // Websites changed since this instant are reconciled on the next loop (rename → new route host within seconds).
  let changedSince = new Date()

  while (!stopping) {
    let ran = false
    try {
      ran = await runOnce(ctx)
      const now = new Date()
      const changed = await db.website.findMany({ where: { updatedAt: { gte: changedSince } }, select: { id: true } })
      changedSince = now
      for (const w of changed) await reconcileWebsite(ctx, w.id).catch((e: unknown) => log.error('worker.reconcile_failed', { websiteId: w.id, error: e }))
      if (Date.now() - lastReconcile > cfg.RECONCILE_INTERVAL_SECONDS * 1000) {
        await reconcileAll(ctx)
        await pruneRateLimits(db)
        await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })
        await db.passwordLink.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } })
        await db.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } })
        lastReconcile = Date.now()
      }
    } catch (e) {
      log.error('worker.loop_error', { error: e })
    }
    if (!ran) await new Promise((r) => setTimeout(r, cfg.WORKER_POLL_MS))
  }
  await db.$disconnect()
}

main().catch((e: unknown) => {
  log.error('worker.fatal', { error: e })
  process.exit(1)
})
