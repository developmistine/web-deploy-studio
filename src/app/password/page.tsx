import { getConfig } from '@/server/config'
import { AuthLayout } from '@/components/AuthLayout'
import { SetPasswordForm } from '@/components/AuthForms'

export const dynamic = 'force-dynamic'

/** One-time setup / reset link target (`/password#token=…`). The token stays in the fragment. */
export default function SetPasswordPage() {
  return (
    <AuthLayout title="Set your password" subtitle="ตั้งรหัสผ่านสำหรับ Deploy Studio (ลิงก์นี้ใช้ได้ครั้งเดียว)">
      <SetPasswordForm minLength={getConfig().PASSWORD_MIN_LENGTH} />
    </AuthLayout>
  )
}
