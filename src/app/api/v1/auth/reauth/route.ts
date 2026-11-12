import { json, readJson, route } from '@/server/http/handler'
import { reauthSchema } from '@/lib/validation'
import { reauthenticate } from '@/server/services/auth'
import { clientIp } from '@/server/http/client-ip'

export const dynamic = 'force-dynamic'

/** Password confirmation before sensitive actions (enrollment writes, cross-department production changes). */
export const POST = route({}, async ({ req, db, session }) => {
  const { password } = reauthSchema.parse(await readJson(req))
  await reauthenticate(db, session, password, clientIp(req))
  return json({ ok: true })
})
