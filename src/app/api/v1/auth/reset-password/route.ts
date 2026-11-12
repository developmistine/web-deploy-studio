import { assertSameOrigin, json, readJson, route } from '@/server/http/handler'
import { resetPasswordSchema } from '@/lib/validation'
import { completePasswordLink } from '@/server/services/auth'
import { clientIp } from '@/server/http/client-ip'

export const dynamic = 'force-dynamic'

/** Completes a one-time SETUP/RESET link (token from the URL fragment, sent in the body). */
export const POST = route({ auth: false, mutating: false }, async ({ req, db }) => {
  assertSameOrigin(req)
  const input = resetPasswordSchema.parse(await readJson(req))
  await completePasswordLink(db, input, clientIp(req))
  return json({ ok: true })
})
