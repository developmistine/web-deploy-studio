import { execFile } from 'node:child_process'
import type { WorkerConfig } from '../config'
import { RuntimeError, type SiteRuntime } from './types'
import { log } from '@/server/log'

type ExecResult = { stdout: string; stderr: string }

/** Runs the docker CLI without a shell (argument array → no injection), with timeout + abort. */
/**
 * DOCKER_BUILDKIT=0: use the daemon's classic builder through the filtered API. With a remote DOCKER_HOST,
 * `docker buildx` would otherwise auto-create a PRIVILEGED BuildKit container (docker-container driver) —
 * observed in e2e testing and never acceptable here. The site template has no RUN steps, so nothing is lost.
 */
const DOCKER_ENV = { ...process.env, DOCKER_BUILDKIT: '0', BUILDX_NO_DEFAULT_ATTESTATIONS: '1' }

function run(bin: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: opts.timeoutMs ?? 120_000, maxBuffer: 8 * 1024 * 1024, signal: opts.signal, windowsHide: true, env: DOCKER_ENV }, (err, stdout, stderr) => {
      if (err) {
        const e = err as NodeJS.ErrnoException & { killed?: boolean }
        if (e.name === 'AbortError' || e.killed) return reject(new RuntimeError('TIMEOUT', `docker ${args[0]} timed out`))
        // stderr goes to worker logs only — never to users.
        log.warn('docker.command_failed', { cmd: args.slice(0, 2).join(' '), stderr: String(stderr).slice(0, 2000) })
        return reject(Object.assign(new Error(`docker ${args[0]} failed`), { stderr: String(stderr) }))
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

export class DockerRuntime implements SiteRuntime {
  constructor(private readonly cfg: WorkerConfig) {}

  async buildImage({ deploymentId, contextDir, signal }: { deploymentId: string; contextDir: string; signal: AbortSignal }) {
    const tag = `${this.cfg.SITE_IMAGE_REPO}:${deploymentId}`
    try {
      await run(
        this.cfg.DOCKER_BIN,
        [
          'build',
          '--network=none', // the template has no RUN steps; no network needed or allowed
          '--build-arg', `BASE_IMAGE=${this.cfg.SITE_BASE_IMAGE}`,
          '--label', 'ds.managed=true',
          '--label', `ds.deployment=${deploymentId}`,
          '-t', tag,
          contextDir,
        ],
        { timeoutMs: this.cfg.JOB_TIMEOUT_SECONDS * 1000, signal },
      )
      const { stdout } = await run(this.cfg.DOCKER_BIN, ['image', 'inspect', '--format', '{{.Id}}', tag], { signal })
      const id = stdout.trim()
      if (!/^sha256:[0-9a-f]{64}$/.test(id)) throw new Error('unexpected image id')
      return { imageRef: id }
    } catch (e) {
      if (e instanceof RuntimeError) throw e
      throw new RuntimeError('BUILD_FAILED', 'image build failed')
    }
  }

  async scanImage(imageRef: string, signal: AbortSignal) {
    const cmd = this.cfg.IMAGE_SCAN_COMMAND
    if (!cmd) return
    // e.g. "trivy image --exit-code 1 --severity HIGH,CRITICAL {image}"
    const [bin, ...args] = cmd.split(/\s+/).filter(Boolean).map((a) => (a === '{image}' ? imageRef : a))
    if (!bin) return
    try {
      await run(bin, args, { timeoutMs: 600_000, signal })
    } catch (e) {
      if (e instanceof RuntimeError) throw e
      throw new RuntimeError('IMAGE_SCAN_FAILED', 'image scan reported findings')
    }
  }

  async imageExists(imageRef: string) {
    try {
      await run(this.cfg.DOCKER_BIN, ['image', 'inspect', '--format', '{{.Id}}', imageRef])
      return true
    } catch {
      return false
    }
  }

  async startContainer(p: { name: string; imageRef: string; kind: 'preview' | 'production'; deploymentId: string; websiteId: string }) {
    await this.stopContainer(p.name)
    const c = this.cfg
    try {
      await run(c.DOCKER_BIN, [
        'run', '-d',
        '--name', p.name,
        '--network', c.SITES_NETWORK, // internal network: no egress, no company services
        '--read-only',
        '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=16m',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges:true',
        '--user', '101:101',
        '--memory', c.SITE_CONTAINER_MEMORY,
        '--memory-swap', c.SITE_CONTAINER_MEMORY,
        '--cpus', c.SITE_CONTAINER_CPUS,
        '--pids-limit', String(c.SITE_CONTAINER_PIDS),
        '--restart', p.kind === 'production' ? 'unless-stopped' : 'no',
        '--log-opt', 'max-size=5m',
        '--log-opt', 'max-file=2',
        '--label', 'ds.managed=true',
        '--label', `ds.kind=${p.kind}`,
        '--label', `ds.deployment=${p.deploymentId}`,
        '--label', `ds.website=${p.websiteId}`,
        p.imageRef,
      ])
    } catch {
      throw new RuntimeError('PREVIEW_START_FAILED', 'container start failed', true)
    }
    return { upstream: `http://${p.name}:8080` }
  }

  async stopContainer(name: string) {
    await run(this.cfg.DOCKER_BIN, ['rm', '-f', name]).catch(() => undefined)
  }

  async isRunning(name: string) {
    try {
      const { stdout } = await run(this.cfg.DOCKER_BIN, ['inspect', '-f', '{{.State.Running}}', name])
      return stdout.trim() === 'true'
    } catch {
      return false
    }
  }

  async checkHealth(upstream: string, deploymentId: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${upstream}/__ds_health`, { signal: AbortSignal.timeout(3000) })
        const body = await res.text()
        if (res.ok && body.includes(deploymentId)) {
          const index = await fetch(`${upstream}/`, { signal: AbortSignal.timeout(3000) })
          if (index.ok) return true
        }
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    return false
  }

  async listManagedContainers() {
    try {
      const { stdout } = await run(this.cfg.DOCKER_BIN, [
        'ps', '-a', '--filter', 'label=ds.managed=true',
        '--format', '{{.Names}}|{{.Label "ds.kind"}}|{{.Label "ds.deployment"}}|{{.Label "ds.website"}}',
      ])
      return stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [name = '', kind = '', deploymentId = '', websiteId = ''] = l.split('|')
          return { name, kind, deploymentId, websiteId }
        })
    } catch {
      return []
    }
  }
}
