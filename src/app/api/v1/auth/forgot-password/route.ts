import { assertSameOrigin, json, readJson, route } from '@/server/http/handler'
import { forgotPasswordSchema } from '@/lib/validation'
import { requestPasswordReset } from '@/server/services/auth'
import { clientIp } from '@/server/http/client-ip'

export const dynamic = 'force-dynamic'

/** Records a reset request for administrators (no email is sent). Identical response for every input. */
export const POST = route({ auth: false, mutating: false }, async ({ req, db }) => {
  assertSameOrigin(req)
  const { email } = forgotPasswordSchema.parse(await readJson(req))
  await requestPasswordReset(db, email, clientIp(req))
  return json({ ok: true }, 202)
})
