import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { themeInitScript } from '@/components/ThemeToggle'
import './globals.css'

export const metadata: Metadata = {
  title: 'Deploy Studio',
  description: 'Internal department website deployment',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Nonce generated per request in src/proxy.ts (strict CSP, no 'unsafe-inline' scripts).
  const nonce = (await headers()).get('x-nonce') ?? undefined
  return (
    <html lang="th" data-theme="light" suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
