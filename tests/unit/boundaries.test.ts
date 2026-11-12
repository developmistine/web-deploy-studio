import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'generated') walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const srcFiles = walk('src')
const apiRoutes = srcFiles.filter((f) => /[\\/]app[\\/]api[\\/].*route\.ts$/.test(f))

describe('architecture & security boundaries', () => {
  it('no DELETE endpoints exist (no website/deployment deletion in MVP)', () => {
    expect(apiRoutes.length).toBeGreaterThan(10)
    for (const f of apiRoutes) expect(readFileSync(f, 'utf8'), f).not.toMatch(/export\s+(const|async function|function)\s+DELETE/)
  })

  it('no service deletes websites or deployments', () => {
    for (const f of srcFiles) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\b(website|deployment)\.(delete|deleteMany)\(/)
  })

  it('the web app never spawns processes or talks to Docker', () => {
    for (const f of srcFiles) {
      const s = readFileSync(f, 'utf8')
      expect(s, f).not.toMatch(/child_process|dockerode|docker\.sock|DOCKER_HOST/)
    }
  })

  it('client components never import server-only modules', () => {
    for (const f of srcFiles.filter((f) => f.includes(`${path.sep}components${path.sep}`) || f.includes(`${path.sep}lib${path.sep}`))) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/from '@\/server\//)
    }
  })

  it('no Delete button text in UI components', () => {
    for (const f of srcFiles.filter((f) => f.endsWith('.tsx'))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/>\s*Delete\s*</)
  })

  it('localStorage holds UI preferences only (theme, admin sidebar) — never data or credentials', () => {
    for (const f of srcFiles) {
      const s = readFileSync(f, 'utf8')
      if (/localStorage/.test(s)) expect(['ThemeToggle.tsx', 'AdminShell.tsx']).toContain(path.basename(f))
    }
  })

  it('no development login backdoors exist (no test-auth route, dev identities or shared passwords)', () => {
    expect(srcFiles.filter((f) => /test-auth|dev-identity/.test(f))).toEqual([])
    for (const f of srcFiles) expect(readFileSync(f, 'utf8'), f).not.toMatch(/DEV_AUTH_ENABLED|DEV_LOGIN_PASSWORD|DEV_IDENTITIES/)
  })

  it('password hashes never leave the server: no DTO or client file mentions them', () => {
    for (const f of srcFiles.filter((f) => /[\/](components|lib)[\/]/.test(f))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/passwordHash/)
  })

  it('uploaded content is never rendered on the management origin (no srcdoc / blob previews)', () => {
    for (const f of srcFiles.filter((f) => f.endsWith('.tsx'))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/srcDoc|srcdoc|createObjectURL/)
  })
})

describe('infrastructure configuration (docker-compose.yml)', () => {
  const compose = parse(readFileSync('docker-compose.yml', 'utf8')) as {
    services: Record<string, { volumes?: string[]; ports?: string[]; networks?: string[]; environment?: Record<string, string>; privileged?: boolean }>
    networks: Record<string, { internal?: boolean; name?: string }>
  }
  const s = compose.services

  it('Docker socket is never mounted into web or worker; only the socket proxy has it (read-only)', () => {
    for (const [name, svc] of Object.entries(s)) {
      const hasSock = (svc.volumes ?? []).some((v) => v.includes('docker.sock'))
      if (name === 'docker-socket-proxy') expect((svc.volumes ?? []).every((v) => !v.includes('docker.sock') || v.endsWith(':ro'))).toBe(true)
      else expect(hasSock, name).toBe(false)
    }
    expect(s.worker!.environment!.DOCKER_HOST).toMatch(/^tcp:\/\/docker-socket-proxy:/)
  })

  it('no privileged containers', () => {
    for (const [name, svc] of Object.entries(s)) expect(svc.privileged ?? false, name).toBe(false)
  })

  it('worker builds with the classic builder only (buildx once auto-created a privileged BuildKit container — R-01)', () => {
    const runtime = readFileSync('worker/src/runtime/docker.ts', 'utf8')
    expect(runtime).toMatch(/DOCKER_BUILDKIT:\s*'0'/)
    expect(runtime).not.toMatch(/['"](buildx|--privileged)['"]/)
    expect(readFileSync('infra/site-template/Dockerfile', 'utf8')).not.toMatch(/--chmod|^\s*RUN\b/m)
  })

  it('MySQL is not publicly exposed (loopback only in dev) and only reachable on the internal db network', () => {
    for (const p of s.mysql!.ports ?? []) expect(p).toMatch(/^127\.0\.0\.1:/)
    expect(s.mysql!.networks).toEqual(['db'])
    expect(compose.networks.db!.internal).toBe(true)
  })

  it('only the proxy publishes a non-loopback port', () => {
    for (const [name, svc] of Object.entries(s)) {
      for (const p of svc.ports ?? []) if (!p.startsWith('127.0.0.1:')) expect(name).toBe('proxy')
    }
  })

  it('site containers network has no egress, and web is not on it', () => {
    expect(compose.networks['ds-sites']).toMatchObject({ internal: true, name: 'ds-sites' })
    expect(s.web!.networks).not.toContain('ds-sites')
  })

  it('the gate endpoint is excluded from the public management router', () => {
    const dyn = readFileSync('infra/traefik/dynamic/00-infra.yml', 'utf8')
    expect(dyn).toMatch(/!PathPrefix\(`\/api\/internal`\)/)
    expect(dyn).toMatch(/trustForwardHeader: false/)
  })
})
