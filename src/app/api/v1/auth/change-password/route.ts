import { json, readJson, route } from '@/server/http/handler'
import { changePasswordSchema } from '@/lib/validation'
import { changePassword } from '@/server/services/auth'
import { sessionSetCookie } from '@/server/auth/session'
import { clientIp } from '@/server/http/client-ip'

export const dynamic = 'force-dynamic'

/** Own password change. Ends every session of the user and returns a fresh one (session rotation). */
export const POST = route({ stages: ['FULL', 'PASSWORD_CHANGE'] }, async ({ req, db, session }) => {
  const input = changePasswordSchema.parse(await readJson(req))
  const s = await changePassword(db, session, input, clientIp(req))
  return json({ csrfToken: s.csrfToken }, 200, { 'set-cookie': sessionSetCookie(s.token, s.expiresAt) })
})
