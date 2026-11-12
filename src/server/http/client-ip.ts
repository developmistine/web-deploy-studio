/**
 * Client IP for rate limiting. Only the first X-Forwarded-For hop set by our own reverse proxy is
 * meaningful; deployments must ensure the proxy overwrites (not appends to) client-supplied values.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  const first = xff?.split(',')[0]?.trim()
  if (first && /^[0-9a-fA-F:.]{2,45}$/.test(first)) return first
  return 'unknown'
}
