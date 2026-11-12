import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadWorkerConfig } from '../../worker/src/config'
import { TraefikFileRouter } from '../../worker/src/routing/traefik-file'

const cfg = loadWorkerConfig({ ...process.env, ROUTES_DIR: './data/test-routes' })
const router = new TraefikFileRouter(cfg)
const id = '0190aaaa-bbbb-7ccc-8ddd-eeeeffff0000'

describe('reverse proxy routes', () => {
  it('every production site route is behind the gateway (no unauthenticated fallback)', () => {
    const yml = router.render({ name: `site-${id}`, host: 'dtd-sales.sites.localhost', upstream: `http://ds-site-${id}:8080`, preview: false, deploymentId: id })
    expect(yml).toContain('ds-gateway@file')
  })
  it('every preview route is behind the gateway', () => {
    const yml = router.render({ name: `preview-${id}`, host: 'abcdefghijklmnopqrstuvwxyz.preview.localhost', upstream: `http://ds-prev-${id}:8080`, preview: true, deploymentId: id })
    expect(yml).toContain('ds-gateway@file')
  })
  it('rejects host/upstream injection into the proxy config', () => {
    expect(() => router.render({ name: `site-${id}`, host: 'x`) || Host(`evil', upstream: `http://ds-site-${id}:8080`, preview: false, deploymentId: id })).toThrow()
    expect(() => router.render({ name: `site-${id}`, host: 'a.b', upstream: 'http://169.254.169.254', preview: false, deploymentId: id })).toThrow()
  })
})

describe('controlled site image template', () => {
  const dockerfile = readFileSync('infra/site-template/Dockerfile', 'utf8')
  const conf = readFileSync('infra/site-template/default.conf.template', 'utf8')
  it('copies static files only — no RUN steps, non-root user', () => {
    expect(dockerfile).not.toMatch(/^\s*RUN\b/m)
    expect(dockerfile).toMatch(/^USER 101$/m)
  })
  it('serves private, read-only content with a restrictive policy and no service workers', () => {
    expect(conf).toContain('Cache-Control "private, no-store"')
    expect(conf).toContain('limit_except GET HEAD')
    expect(conf).toContain('$http_service_worker')
    expect(conf).toContain('frame-ancestors')
  })
})
