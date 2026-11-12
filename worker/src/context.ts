import type { Db } from '@/server/db'
import type { ArtifactStorage } from '@/server/storage'
import type { WorkerConfig } from './config'
import type { SiteRuntime } from './runtime/types'
import type { Router } from './routing/types'
import type { MalwareScanner } from './scan'

export type WorkerContext = {
  db: Db
  cfg: WorkerConfig
  storage: ArtifactStorage
  runtime: SiteRuntime
  router: Router
  scanner: MalwareScanner
  /** Directory holding the controlled Dockerfile + nginx config template. */
  templateDir: string
  /** Test hook: lets tests simulate a crash between steps. */
  hooks?: { beforePointerCommit?: () => Promise<void> }
}

export async function addLog(db: Db, deploymentId: string, message: string, level: 'info' | 'warn' | 'error' = 'info'): Promise<void> {
  await db.deploymentLog.create({ data: { deploymentId, level, message: message.slice(0, 500) } })
}
