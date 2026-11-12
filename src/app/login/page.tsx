import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getDb } from '@/server/db'
import { resolveSession } from '@/server/auth/session'
import { AuthLayout } from '@/components/AuthLayout'
import { LoginForm } from '@/components/AuthForms'

export const dynamic = 'force-dynamic'

const NOTICES: Record<string, string> = {
  password_set: 'ตั้งรหัสผ่านเรียบร้อยแล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย',
  signed_out: 'ออกจากระบบแล้ว',
}

function safeReturnTo(v: string | undefined): string {
  return v && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : '/'
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const returnTo = safeReturnTo(sp.returnTo)
  const session = await resolveSession(getDb(), (await headers()).get('cookie'))
  if (session) redirect(session.stage === 'FULL' ? returnTo : '/account/password')
  const notice = sp.notice ? NOTICES[sp.notice] : null

  return (
    <AuthLayout title="Sign in" subtitle="เข้าสู่ระบบด้วยอีเมลบริษัทและรหัสผ่าน Deploy Studio">
      {notice ? (
        <p className="success-note" role="status">
          {notice}
        </p>
      ) : null}
      <LoginForm returnTo={returnTo} />
      <p className="login-env">รหัสผ่านนี้ใช้เฉพาะ Deploy Studio ไม่ใช่รหัสผ่านอีเมลบริษัท</p>
    </AuthLayout>
  )
}
