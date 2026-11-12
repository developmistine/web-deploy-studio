import { getDb } from '@/server/db'

export const dynamic = 'force-dynamic'

/** Liveness/readiness probe. Reveals nothing but up/down. */
export async function GET(): Promise<Response> {
  try {
    await getDb().$queryRaw`SELECT 1`
    return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
