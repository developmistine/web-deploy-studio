/* eslint-disable @next/next/no-img-element -- static brand image */
import type { ReactNode } from 'react'
import { BrandHeader } from '@/components/BrandHeader'

/** Centred card used by sign-in and password pages (compact on short screens, see globals.css). */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="shell login-shell">
      <BrandHeader showProduct={false} />
      <main className="panel login-card">
        <img className="login-brand" alt="Deploy Studio" src="/brand/deploy-studio.png" width={900} height={337} />
        <h1>{title}</h1>
        {subtitle ? <p className="subtle">{subtitle}</p> : null}
        {children}
      </main>
    </div>
  )
}
