import { assertSameOrigin, json, readJson, route } from '@/server/http/handler'
import { loginSchema } from '@/lib/validation'
import { login } from '@/server/services/auth'
import { sessionSetCookie } from '@/server/auth/session'
import { clientIp } from '@/server/http/client-ip'

export const dynamic = 'force-dynamic'

/** Email + password sign-in. Generic errors only; rate limited per IP and per account; audited. */
export const POST = route({ auth: false, mutating: false }, async ({ req, db }) => {
  assertSameOrigin(req)
  const input = loginSchema.parse(await readJson(req))
  const s = await login(db, input, clientIp(req))
  return json({ csrfToken: s.csrfToken, stage: s.stage }, 200, { 'set-cookie': sessionSetCookie(s.token, s.expiresAt) })
})
