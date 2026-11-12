import { NextResponse, type NextRequest } from 'next/server'

/**
 * Security headers + per-request CSP nonce for Deploy Studio pages (management origin).
 * API routes are excluded (they set their own headers and must not be body-buffered by the proxy).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV === 'development'
  const previewOrigin = originPattern(process.env.PREVIEW_BASE_URL)
  const https = (process.env.APP_URL ?? '').startsWith('https:')

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    // Only the isolated preview origins may be framed; nothing may frame Deploy Studio.
    `frame-src ${previewOrigin ?? "'none'"}`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ')

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  response.headers.set('Cache-Control', 'no-store')
  if (https) response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  return response
}

/** "https://preview.corp-preview.example:8443" → "https://*.preview.corp-preview.example:8443" */
function originPattern(base: string | undefined): string | null {
  if (!base) return null
  try {
    const u = new URL(base)
    return `${u.protocol}//*.${u.hostname}${u.port ? `:${u.port}` : ''}`
  } catch {
    return null
  }
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico|brand/).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
}
