import path from 'node:path'
import { getDb } from '@/server/db'
import { resetConfigCache } from '@/server/config'
import { resetStorageForTests, FsArtifactStorage } from '@/server/storage'
import { clearGateCache } from '@/server/gateway/gate'
import { POST as loginRoute } from '@/app/api/v1/auth/login/route'
import { hashPassword } from '@/server/auth/password'
import { ensureDepartment } from '@/server/services/departments'
import { loadWorkerConfig } from '../../worker/src/config'
import type { WorkerContext } from '../../worker/src/context'
import { FakeRuntime } from '../../worker/src/runtime/fake'
import { MemoryRouter } from '../../worker/src/routing/memory'
import { NoopScanner } from '../../worker/src/scan'
import { runOnce } from '../../worker/src/process'

export const APP = 'http://localhost:3000'

export async function resetDb(): Promise<void> {
  const db = getDb()
  const tables = [
    'audit_logs', 'deployment_logs', 'deployment_jobs', 'idempotency_keys', 'rate_limits', 'sessions', 'password_links', 'enrollments',
  ]
  // One connection for the whole reset (FOREIGN_KEY_CHECKS is per-session). TRUNCATE is DDL, so the
  // append-only audit triggers do not apply — and the runtime account (no DDL) cannot do this.
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=0')
    try {
      for (const t of [...tables, 'deployments', 'websites', 'users', 'departments']) await tx.$executeRawUnsafe(`TRUNCATE TABLE ${t}`)
    } finally {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS=1')
    }
  }, { timeout: 30_000 })
  clearGateCache()
  resetConfigCache()
  resetStorageForTests()
}

/** Test fixture accounts (test data only — nothing like this exists in application code). */
export const FIXTURES = {
  admin: { email: 'admin@test.example', displayName: 'Test Admin', role: 'ADMIN', department: null },
  'dtd-user': { email: 'dtd1@test.example', displayName: 'Test DTD User', role: 'USER', department: 'DTD' },
  'dtd-user-2': { email: 'dtd2@test.example', displayName: 'Test DTD User 2', role: 'USER', department: 'DTD' },
  'erp-user': { email: 'erp1@test.example', displayName: 'Test ERP User', role: 'USER', department: 'ERP' },
  'ka-user': { email: 'ka1@test.example', displayName: 'Test KA User', role: 'USER', department: 'KA' },
  'unassigned-user': { email: 'none1@test.example', displayName: 'Test Unassigned User', role: 'USER', department: null },
} as const
export type FixtureKey = keyof typeof FIXTURES
export const FIXTURE_PASSWORD = 'correct horse battery staple 42'

export type Session = { cookie: string; csrf: string; identity: FixtureKey; userId: string }

let fixtureHash: Promise<string> | null = null

/** Creates (once per reset) the fixture account as an ACTIVE enrolled user with FIXTURE_PASSWORD. */
export async function ensureFixture(identity: FixtureKey): Promise<string> {
  const db = getDb()
  const f = FIXTURES[identity]
  const existing = await db.user.findUnique({ where: { activeEmail: f.email } })
  if (existing) return existing.id
  fixtureHash ??= hashPassword(FIXTURE_PASSWORD)
  const dept = f.department ? await ensureDepartment(db, f.department, null, 'test-fixture') : null
  const u = await db.user.create({
    data: {
      email: f.email, emailNormalized: f.email, activeEmail: f.email, displayName: f.displayName, role: f.role,
      departmentId: dept?.id ?? null, status: 'ACTIVE', passwordHash: await fixtureHash, passwordChangedAt: new Date(),
    },
  })
  await db.enrollment.create({ data: { userId: u.id, activationState: 'ACTIVATED' } })
  return u.id
}

/** Raw call of the real login endpoint. */
export function loginRequest(email: string, password: string, headers: Record<string, string> = {}): Promise<Response> {
  return loginRoute(
    new Request(`${APP}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP, host: 'localhost:3000', ...headers },
      body: JSON.stringify({ email, password }),
    }),
  )
}

/** Signs a fixture account in through the real login endpoint → a real server session + CSRF token. */
export async function login(identity: FixtureKey): Promise<Session> {
  const userId = await ensureFixture(identity)
  const res = await loginRequest(FIXTURES[identity].email, FIXTURE_PASSWORD)
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${await res.text()}`)
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!
  const { csrfToken } = (await res.json()) as { csrfToken: string }
  return { cookie, csrf: csrfToken, identity, userId }
}

type Handler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>

export async function call(
  handler: Handler,
  opts: {
    method?: string
    path: string
    session?: Session | null
    body?: unknown
    form?: FormData
    params?: Record<string, string>
    headers?: Record<string, string>
    csrf?: string | null
    origin?: string | null
  },
): Promise<{ status: number; json: any; headers: Headers }> {
  const method = opts.method ?? (opts.body !== undefined || opts.form ? 'POST' : 'GET')
  const headers: Record<string, string> = { host: 'localhost:3000', ...(opts.headers ?? {}) }
  if (opts.session) headers.cookie = opts.session.cookie
  if (method !== 'GET') {
    if (opts.origin !== null) headers.origin = opts.origin ?? APP
    const csrf = opts.csrf === undefined ? opts.session?.csrf : opts.csrf
    if (csrf) headers['x-csrf-token'] = csrf
  }
  let body: BodyInit | undefined
  if (opts.form) {
    const r = new Request('http://x', { method: 'POST', body: opts.form })
    const buf = Buffer.from(await r.arrayBuffer())
    headers['content-type'] = r.headers.get('content-type')!
    headers['content-length'] = String(buf.length)
    body = buf
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(opts.body)
  }
  const res = await handler(new Request(`${APP}${opts.path}`, { method, headers, body }), { params: Promise.resolve(opts.params ?? {}) })
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: res.status, json, headers: res.headers }
}

export function zipForm(zip: Buffer, name = 'site.zip'): FormData {
  const fd = new FormData()
  fd.append('files', new File([new Uint8Array(zip)], name, { type: 'application/zip' }))
  return fd
}

export function makeWorker(): { ctx: WorkerContext; runtime: FakeRuntime; router: MemoryRouter } {
  const cfg = loadWorkerConfig({ ...process.env, RUNTIME: 'fake', DRAIN_SECONDS: '0', HEALTH_CHECK_TIMEOUT_SECONDS: '1', WORKER_ID: 'test-worker' })
  const runtime = new FakeRuntime()
  const router = new MemoryRouter(runtime)
  const ctx: WorkerContext = {
    db: getDb(),
    cfg,
    storage: new FsArtifactStorage(process.env.STORAGE_ROOT!),
    runtime,
    router,
    scanner: new NoopScanner(),
    templateDir: path.resolve('infra/site-template'),
  }
  return { ctx, runtime, router }
}

/** Runs worker ticks until the queue is empty (bounded). */
export async function drain(ctx: WorkerContext, max = 20): Promise<number> {
  let n = 0
  while (n < max && (await runOnce(ctx))) n++
  // Release runAfter backoffs so retries are visible in tests when needed.
  return n
}
