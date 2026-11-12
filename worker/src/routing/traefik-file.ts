import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import type { WorkerConfig } from '../config'
import type { RouteSpec, Router } from './types'

const NAME_RE = /^(site|preview)-[0-9a-f-]{36}$/
const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

/**
 * Traefik file-provider router. One YAML file per route; written to a temp name then renamed,
 * so Traefik only ever sees a complete old or new config (atomic switch).
 */
export class TraefikFileRouter implements Router {
  constructor(private readonly cfg: WorkerConfig) {}

  private file(name: string) {
    if (!NAME_RE.test(name)) throw new Error('invalid route name')
    return path.join(this.cfg.ROUTES_DIR, `${name}.yml`)
  }

  render(r: RouteSpec): string {
    if (!HOST_RE.test(r.host)) throw new Error('invalid host')
    if (!/^http:\/\/ds-(prev|site)-[0-9a-f-]{36}:8080$/.test(r.upstream)) throw new Error('invalid upstream')
    // Gateway on every route: production sites are private too. There is no unauthenticated route.
    const middlewares = [this.cfg.GATEWAY_MIDDLEWARE, ...this.cfg.SITE_MIDDLEWARES.split(',').map((s) => s.trim())].filter(Boolean)
    const entryPoints = this.cfg.ROUTER_ENTRYPOINTS.split(',').map((s) => s.trim()).filter(Boolean)
    return [
      `# managed by deploy-studio worker — do not edit`,
      `# deployment: ${r.deploymentId}`,
      `http:`,
      `  routers:`,
      `    ${r.name}:`,
      `      rule: "Host(\`${r.host}\`)"`,
      `      entryPoints: [${entryPoints.join(', ')}]`,
      `      service: ${r.name}`,
      middlewares.length ? `      middlewares: [${middlewares.join(', ')}]` : '',
      this.cfg.ROUTER_TLS ? `      tls: {}` : '',
      `  services:`,
      `    ${r.name}:`,
      `      loadBalancer:`,
      `        passHostHeader: true`,
      `        servers:`,
      `          - url: "${r.upstream}"`,
      '',
    ]
      .filter((l) => l !== '')
      .join('\n')
  }

  /**
   * Installs the infrastructure-owned config (gateway middleware + studio router) into the watched routes
   * directory. Traefik's file watcher is not recursive, so everything must live in that one directory.
   */
  async installInfraConfig(sourceFile: string) {
    await mkdir(this.cfg.ROUTES_DIR, { recursive: true })
    const target = path.join(this.cfg.ROUTES_DIR, '00-infra.yml')
    const tmp = `${target}.${process.pid}.tmp`
    await copyFile(sourceFile, tmp)
    await rename(tmp, target)
  }

  async setRoute(r: RouteSpec) {
    await mkdir(this.cfg.ROUTES_DIR, { recursive: true })
    const target = this.file(r.name)
    const tmp = `${target}.${process.pid}.tmp` // non-.yml suffix: ignored by Traefik
    await writeFile(tmp, this.render(r) + '\n', { mode: 0o644 })
    await rename(tmp, target)
  }

  async removeRoute(name: string) {
    await rm(this.file(name), { force: true })
  }

  async getRoute(name: string): Promise<RouteSpec | null> {
    try {
      const text = await readFile(this.file(name), 'utf8')
      const host = /Host\(`([^`]+)`\)/.exec(text)?.[1]
      const upstream = /url: "([^"]+)"/.exec(text)?.[1]
      const deploymentId = /# deployment: ([0-9a-f-]{36})/.exec(text)?.[1]
      if (!host || !upstream || !deploymentId) return null
      return { name, host, upstream, deploymentId, preview: name.startsWith('preview-') }
    } catch {
      return null
    }
  }

  async verifyThroughProxy(host: string, deploymentId: string, timeoutMs: number) {
    const proxy = new URL(this.cfg.PROXY_INTERNAL_URL)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const body = await new Promise<string | null>((resolve) => {
        const req = http.request(
          { host: proxy.hostname, port: Number(proxy.port || 80), path: '/__ds_health', method: 'GET', headers: { host, 'x-ds-probe': this.cfg.HEALTH_PROBE_TOKEN }, timeout: 3000 },
          (res) => {
            let data = ''
            res.setEncoding('utf8')
            res.on('data', (c: string) => (data += c.slice(0, 200)))
            res.on('end', () => resolve(res.statusCode === 200 ? data : null))
          },
        )
        req.on('timeout', () => req.destroy())
        req.on('error', () => resolve(null))
        req.end()
      })
      if (body?.includes(deploymentId)) return true
      await new Promise((r) => setTimeout(r, 500)) // Traefik reloads file changes asynchronously
    }
    return false
  }
}
