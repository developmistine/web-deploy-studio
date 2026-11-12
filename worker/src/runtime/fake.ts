import { RuntimeError, type SiteRuntime } from './types'

/**
 * In-memory runtime for tests and Docker-less local runs (RUNTIME=fake).
 * Failure injection lets tests prove the production safety invariants.
 */
export class FakeRuntime implements SiteRuntime {
  images = new Set<string>()
  containers = new Map<string, { imageRef: string; deploymentId: string; websiteId: string; kind: string; healthy: boolean }>()
  failBuildFor = new Set<string>()
  unhealthyFor = new Set<string>()
  /** Healthy as a preview, unhealthy once started as production (readiness-check failure on release). */
  unhealthyProductionFor = new Set<string>()
  failScanFor = new Set<string>()
  builds = 0

  async buildImage({ deploymentId }: { deploymentId: string; contextDir: string; signal: AbortSignal }) {
    this.builds++
    if (this.failBuildFor.has(deploymentId)) throw new RuntimeError('BUILD_FAILED', 'injected build failure')
    const imageRef = `sha256:${deploymentId.replace(/-/g, '').padEnd(64, '0').slice(0, 64)}`
    this.images.add(imageRef)
    return { imageRef }
  }
  async scanImage(imageRef: string) {
    for (const id of this.failScanFor) if (imageRef.includes(id.replace(/-/g, '').slice(0, 20))) throw new RuntimeError('IMAGE_SCAN_FAILED', 'injected')
  }
  async imageExists(imageRef: string) {
    return this.images.has(imageRef)
  }
  async startContainer(p: { name: string; imageRef: string; kind: 'preview' | 'production'; deploymentId: string; websiteId: string }) {
    if (!this.images.has(p.imageRef)) throw new RuntimeError('PREVIEW_START_FAILED', 'no image')
    this.containers.set(p.name, { imageRef: p.imageRef, deploymentId: p.deploymentId, websiteId: p.websiteId, kind: p.kind, healthy: !this.unhealthyFor.has(p.deploymentId) && !(p.kind === 'production' && this.unhealthyProductionFor.has(p.deploymentId)) })
    return { upstream: `http://${p.name}:8080` }
  }
  async stopContainer(name: string) {
    this.containers.delete(name)
  }
  async isRunning(name: string) {
    return this.containers.has(name)
  }
  async checkHealth(upstream: string, deploymentId: string) {
    const name = new URL(upstream).hostname
    const c = this.containers.get(name)
    return !!c && c.healthy && c.deploymentId === deploymentId
  }
  async listManagedContainers() {
    return [...this.containers.entries()].map(([name, c]) => ({ name, kind: c.kind, deploymentId: c.deploymentId, websiteId: c.websiteId }))
  }
}
