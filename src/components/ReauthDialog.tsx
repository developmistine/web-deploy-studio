'use client'

import { useState, type FormEvent } from 'react'
import { ApiError, type ApiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FormField } from '@/components/ui/FormField'

/**
 * Password confirmation for sensitive actions (server answered REAUTH_REQUIRED). On success the caller retries the
 * original request; the server decides again — this dialog grants nothing by itself.
 */
export function ReauthDialog({ api, onDone, onCancel }: { api: ApiClient; onDone: () => void; onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError('')
    try {
      await api.reauth(password)
      onDone()
    } catch (err) {
      setPassword('')
      setError(err instanceof ApiError && err.code === 'WRONG_PASSWORD' ? 'รหัสผ่านไม่ถูกต้อง' : err instanceof ApiError ? err.message : 'กรุณาลองใหม่อีกครั้ง')
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onCancel() : undefined)}
      busy={busy}
      title="ยืนยันรหัสผ่าน"
      description="การทำรายการนี้ต้องยืนยันรหัสผ่านอีกครั้ง"
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            ยกเลิก
          </Button>
          <Button variant="primary" type="submit" form="reauth-form" loading={busy} disabled={!password}>
            ยืนยัน
          </Button>
        </>
      }
    >
      <form id="reauth-form" className="ds-form" onSubmit={(e) => void submit(e)}>
        <FormField id="reauth-password" label="รหัสผ่าน" error={error}>
          <input id="reauth-password" className="ds-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        </FormField>
      </form>
    </Dialog>
  )
}
