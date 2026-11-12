import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { getDb } from '@/server/db'
import { resolveSession, type SessionContext } from '@/server/auth/session'
import { isAdmin } from '@/server/authz/policy'

/**
 * Server-side guard for pages (the API enforces the same rules independently):
 *  - no session → sign-in page; a session that must change its password → the change-password page;
 *  - `admin: true` → non-admins get a 404 (admin pages are not advertised).
 */
export async function requirePageSession(opts: { admin?: boolean; allowPasswordChange?: boolean; returnTo?: string } = {}): Promise<SessionContext> {
  const session = await resolveSession(getDb(), (await headers()).get('cookie'))
  if (!session) redirect(`/login${opts.returnTo ? `?returnTo=${encodeURIComponent(opts.returnTo)}` : ''}`)
  if (session.stage !== 'FULL' && !opts.allowPasswordChange) redirect('/account/password')
  if (opts.admin && !isAdmin(session.actor)) notFound()
  return session
}
