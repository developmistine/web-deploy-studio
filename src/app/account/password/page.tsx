import Link from 'next/link'
import { getConfig } from '@/server/config'
import { requirePageSession } from '@/server/auth/page-session'
import { AuthLayout } from '@/components/AuthLayout'
import { ChangePasswordForm } from '@/components/AuthForms'

export const dynamic = 'force-dynamic'

export default async function ChangePasswordPage() {
  const session = await requirePageSession({ allowPasswordChange: true, returnTo: '/account/password' })
  return (
    <AuthLayout title="Change password" subtitle={session.actor.email}>
      <ChangePasswordForm csrfToken={session.csrfToken} minLength={getConfig().PASSWORD_MIN_LENGTH} required={session.stage !== 'FULL'} />
      {session.stage === 'FULL' ? (
        <Link className="login-link" href="/">
          ← กลับ Deploy Studio
        </Link>
      ) : null}
    </AuthLayout>
  )
}
