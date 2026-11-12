import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')
export const randomHex = (bytes = 16): string => randomBytes(bytes).toString('hex')
export const sha256Hex = (input: string | Buffer): string => createHash('sha256').update(input).digest('hex')
export const hmac = (key: string, data: string): string => createHmac('sha256', key).update(data).digest('base64url')

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Lowercase base32 label safe for DNS (26 chars ≈ 130 bits). */
export function randomDnsLabel(chars = 26): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  const bytes = randomBytes(chars)
  let out = ''
  for (let i = 0; i < chars; i++) out += alphabet[(bytes[i] ?? 0) % 32]
  return out
}
