export type RouteSpec = { name: string; host: string; upstream: string; preview: boolean; deploymentId: string }

/** Reverse-proxy routing control. Each route is replaced atomically (single file rename / map set). */
export interface Router {
  setRoute(r: RouteSpec): Promise<void>
  removeRoute(name: string): Promise<void>
  getRoute(name: string): Promise<RouteSpec | null>
  /** Requests GET /__ds_health through the proxy for `host`; true when the expected deployment answers. */
  verifyThroughProxy(host: string, deploymentId: string, timeoutMs: number): Promise<boolean>
}

export const routeName = {
  site: (websiteId: string) => `site-${websiteId}`,
  preview: (deploymentId: string) => `preview-${deploymentId}`,
}
