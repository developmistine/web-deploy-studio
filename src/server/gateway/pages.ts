/** Minimal static status pages for the gateway. Messages are constants — never echo request data. */
export function statusPage(status: number, message: string, extraHeaders: Record<string, string> = {}): Response {
  const safe = message.replace(/[<>&"']/g, '')
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deploy Studio</title><body style="font-family:system-ui;padding:40px;color:#555;background:#f6f6f6">${safe}</body>`,
    {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        ...extraHeaders,
      },
    },
  )
}
