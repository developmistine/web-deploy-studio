import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

/** Per-request (or per-job) correlation data, picked up automatically by audit() and logs. */
export type RequestContext = { requestId: string; sourceIpHash: string | null }

const storage = new AsyncLocalStorage<RequestContext>()

export function runWithContext<T>(ctx: Partial<RequestContext>, fn: () => Promise<T>): Promise<T> {
  return storage.run({ requestId: ctx.requestId ?? randomUUID(), sourceIpHash: ctx.sourceIpHash ?? null }, fn)
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore()
}

/** Accept a well-formed upstream request id (from the reverse proxy) or generate one. */
export function requestIdFrom(req: Request): string {
  const v = req.headers.get('x-request-id')
  return v && /^[A-Za-z0-9._-]{8,64}$/.test(v) ? v : randomUUID()
}
