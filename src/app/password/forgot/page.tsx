import { AuthLayout } from '@/components/AuthLayout'
import { ForgotPasswordForm } from '@/components/AuthForms'

export const dynamic = 'force-dynamic'

export default function ForgotPasswordPage() {
  return (
    <AuthLayout title="Forgot password" subtitle="ระบบจะบันทึกคำขอให้ผู้ดูแล ผู้ดูแลจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้ทางช่องทางภายใน">
      <ForgotPasswordForm />
    </AuthLayout>
  )
}
