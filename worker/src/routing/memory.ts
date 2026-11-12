import type { FakeRuntime } from '../runtime/fake'
import type { RouteSpec, Router } from './types'

/** In-memory router for tests; "proxy verification" consults the fake runtime's containers. */
export class MemoryRouter implements Router {
  routes = new Map<string, RouteSpec>()
  failVerifyFor = new Set<string>()
  history: { name: string; deploymentId: string | null }[] = []

  constructor(private readonly runtime: FakeRuntime) {}

  async setRoute(r: RouteSpec) {
    this.routes.set(r.name, { ...r })
    this.history.push({ name: r.name, deploymentId: r.deploymentId })
  }
  async removeRoute(name: string) {
    this.routes.delete(name)
    this.history.push({ name, deploymentId: null })
  }
  async getRoute(name: string) {
    const r = this.routes.get(name)
    return r ? { ...r } : null
  }
  async verifyThroughProxy(host: string, deploymentId: string) {
    if (this.failVerifyFor.has(deploymentId)) return false
    const route = [...this.routes.values()].find((r) => r.host === host)
    if (!route || route.deploymentId !== deploymentId) return false
    return this.runtime.checkHealth(route.upstream, deploymentId)
  }
}
