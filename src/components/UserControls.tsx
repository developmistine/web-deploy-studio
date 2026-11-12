'use client'

import { useMemo } from 'react'
import { ApiClient } from '@/lib/api-client'
import { ThemeToggle } from '@/components/ThemeToggle'
import { LogOutIcon } from '@/components/ui/icons'

/**
 * Header account row, one line: signed-in name (from the server session) · Light/Dark · ออกจากระบบ.
 * Passwords are changed by an administrator's one-time reset link (no self-service button here).
 */
export function UserControls({ csrfToken, label }: { csrfToken: string; label: string }) {
  const api = useMemo(() => new ApiClient(csrfToken), [csrfToken])
  async function signOut() {
    try {
      await api.logout()
    } finally {
      // Full reload after the session is gone so no client state survives sign-out.
      window.location.assign(new URL('/login?notice=signed_out', window.location.origin).toString())
    }
  }
  return (
    <div className="header-controls" data-testid="user-controls">
      <span className="signed-in-name" id="signed-in-name" title={label} aria-label={`ผู้ใช้ที่เข้าสู่ระบบ: ${label}`}>
        {label}
      </span>
      <ThemeToggle />
      <button type="button" className="sketch mini header-signout" onClick={() => void signOut()} aria-label="ออกจากระบบ">
        <LogOutIcon />
        <span className="header-signout-label">ออกจากระบบ</span>
      </button>
    </div>
  )
}
