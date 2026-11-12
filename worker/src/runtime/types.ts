/** Container runtime abstraction. Only the worker implements/uses this; the web app never does. */
export interface SiteRuntime {
  /** Builds an image from a controlled build context (template Dockerfile + validated static files). */
  buildImage(p: { deploymentId: string; contextDir: string; signal: AbortSignal }): Promise<{ imageRef: string }>
  /** Throws if the image scanner reports findings (no-op when no scanner is configured). */
  scanImage(imageRef: string, signal: AbortSignal): Promise<void>
  imageExists(imageRef: string): Promise<boolean>
  /** Starts a hardened container; returns the internal upstream URL (e.g. http://name:8080). */
  startContainer(p: { name: string; imageRef: string; kind: 'preview' | 'production'; deploymentId: string; websiteId: string }): Promise<{ upstream: string }>
  stopContainer(name: string): Promise<void>
  isRunning(name: string): Promise<boolean>
  /** Polls GET /__ds_health until it answers with the expected deployment id or times out. */
  checkHealth(upstream: string, deploymentId: string, timeoutMs: number): Promise<boolean>
  listManagedContainers(): Promise<{ name: string; kind: string; deploymentId: string; websiteId: string }[]>
}

export const containerName = {
  preview: (deploymentId: string) => `ds-prev-${deploymentId}`,
  production: (deploymentId: string) => `ds-site-${deploymentId}`,
}

export class RuntimeError extends Error {
  constructor(
    readonly code: 'BUILD_FAILED' | 'IMAGE_SCAN_FAILED' | 'PREVIEW_START_FAILED' | 'HEALTH_CHECK_FAILED' | 'TIMEOUT' | 'RUNTIME_UNAVAILABLE',
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'RuntimeError'
  }
}
