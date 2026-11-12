'use client'

import { useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import { ApiClient, ApiError, passwordProblemText, postPublic } from '@/lib/api-client'

/** Only same-site relative paths are followed after sign-in (no open redirects). */
function safeReturnTo(v: string | null | undefined): string {
  return v && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : '/'
}

function errorText(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.code === 'PASSWORD_POLICY') return `รหัสผ่านใช้ไม่ได้: ${passwordProblemText(e.details?.problems, e.details?.minLength)}`
    return e.message
  }
  return fallback
}

function PasswordField({ id, label, value, onChange, autoComplete, hint }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; hint?: ReactNode }) {
  const [show, setShow] = useState(false)
  return (
    <label className="field" htmlFor={id}>
      {label}
      <span className="password-wrap">
        <input id={id} className="text-ui" type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} required maxLength={512} />
        <button type="button" className="password-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          {show ? 'Hide' : 'Show'}
        </button>
      </span>
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function PasswordHint({ minLength }: { minLength: number }) {
  return <>อย่างน้อย {minLength} ตัวอักษร ต้องมีตัวอักษรและตัวเลขอย่างน้อยอย่างละ 1 ตัว · ห้ามเป็นคำที่เดาง่ายหรือมีชื่อ/อีเมลของคุณ</>
}

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const r = await postPublic<{ stage: 'FULL' | 'PASSWORD_CHANGE' }>('/api/v1/auth/login', { email, password })
      window.location.assign(r.stage === 'PASSWORD_CHANGE' ? '/account/password' : safeReturnTo(returnTo))
    } catch (err) {
      setPassword('')
      setError(errorText(err, 'Sign-in could not be completed. Please try again.'))
      setBusy(false)
    }
  }

  return (
    <form className="login-form" onSubmit={(e) => void submit(e)} noValidate>
      {error ? (
        <p className="message" role="alert">
          {error}
        </p>
      ) : null}
      <label className="field" htmlFor="login-email">
        Corporate email
        <input id="login-email" className="text-ui" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required autoFocus maxLength={320} />
      </label>
      <PasswordField id="login-password" label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      <button type="submit" className="primary" disabled={busy || !email || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <a className="login-link" href="/password/forgot">
        ลืมรหัสผ่าน?
      </a>
    </form>
  )
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await postPublic('/api/v1/auth/forgot-password', { email })
      setDone(true)
    } catch (err) {
      setError(errorText(err, 'Please try again later.'))
    }
  }

  if (done) {
    return (
      <p className="success-note" role="status">
        บันทึกคำขอแล้ว กรุณาติดต่อผู้ดูแล Deploy Studio เพื่อรับลิงก์ตั้งรหัสผ่านใหม่ (ระบบไม่ส่งอีเมล)
      </p>
    )
  }
  return (
    <form className="login-form" onSubmit={(e) => void submit(e)}>
      {error ? (
        <p className="message" role="alert">
          {error}
        </p>
      ) : null}
      <label className="field" htmlFor="forgot-email">
        Corporate email
        <input id="forgot-email" className="text-ui" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required maxLength={320} />
      </label>
      <button type="submit" className="primary" disabled={!email}>
        แจ้งผู้ดูแลระบบ
      </button>
      <a className="login-link" href="/login">
        กลับไปหน้าเข้าสู่ระบบ
      </a>
    </form>
  )
}

const subscribeHash = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const tokenFromHash = () => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''

/** One-time setup/reset link. The token is read from the URL fragment (never sent to servers or logs). */
export function SetPasswordForm({ minLength }: { minLength: number }) {
  // Server render: null (unknown yet); browser: the fragment's token, or '' when missing.
  const token = useSyncExternalStore(subscribeHash, tokenFromHash, () => null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
    setBusy(true)
    setError('')
    try {
      await postPublic('/api/v1/auth/reset-password', { token, newPassword: password })
      // Drop the token from the address bar/history before leaving.
      window.history.replaceState(null, '', '/password')
      // Full reload (not client routing): no client state may survive a credential change.
      window.location.assign(new URL('/login?notice=password_set', window.location.origin).toString())
    } catch (err) {
      setError(errorText(err, 'Please try again.'))
      setBusy(false)
    }
  }

  if (token === null) return null
  if (!token) {
    return (
      <p className="message" role="alert">
        ลิงก์ไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากผู้ดูแลระบบ
      </p>
    )
  }
  return (
    <form className="login-form" onSubmit={(e) => void submit(e)}>
      {error ? (
        <p className="message" role="alert">
          {error}
        </p>
      ) : null}
      <PasswordField id="new-password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint={<PasswordHint minLength={minLength} />} />
      <PasswordField id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <button type="submit" className="primary" disabled={busy || !password || !confirm}>
        {busy ? 'Saving…' : 'Set password'}
      </button>
    </form>
  )
}

export function ChangePasswordForm({ csrfToken, minLength, required }: { csrfToken: string; minLength: number; required: boolean }) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน')
    setBusy(true)
    setError('')
    try {
      await new ApiClient(csrfToken).changePassword(current, password)
      window.location.assign(new URL('/', window.location.origin).toString())
    } catch (err) {
      setError(errorText(err, 'Please try again.'))
      setBusy(false)
    }
  }

  return (
    <form className="login-form" onSubmit={(e) => void submit(e)}>
      {required ? <p className="notice">ต้องตั้งรหัสผ่านใหม่ก่อนใช้งาน</p> : null}
      {error ? (
        <p className="message" role="alert">
          {error}
        </p>
      ) : null}
      <PasswordField id="current-password" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
      <PasswordField id="new-password" label="New password" value={password} onChange={setPassword} autoComplete="new-password" hint={<PasswordHint minLength={minLength} />} />
      <PasswordField id="confirm-password" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <button type="submit" className="primary" disabled={busy || !current || !password || !confirm}>
        {busy ? 'Saving…' : 'Change password'}
      </button>
      <p className="login-env">เปลี่ยนรหัสผ่านแล้ว ระบบจะออกจากระบบทุกอุปกรณ์อื่นของคุณ</p>
    </form>
  )
}
