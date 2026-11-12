import { json, route } from '@/server/http/handler'
import { destroySession, sessionClearCookie } from '@/server/auth/session'
import { audit } from '@/server/audit'

export const dynamic = 'force-dynamic'

export const POST = route({ stages: ['FULL', 'PASSWORD_CHANGE'] }, async ({ db, session, actor }) => {
  await destroySession(db, session.sessionId)
  await audit(db, { action: 'LOGOUT', actorUserId: actor.userId })
  return json({ redirectTo: '/login' }, 200, { 'set-cookie': sessionClearCookie() })
})
