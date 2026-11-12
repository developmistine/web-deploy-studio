/**
 * Minimal structured logger. Redacts anything that looks like a credential so tokens,
 * cookies and secrets never reach log storage.
 */
const SENSITIVE = /(token|secret|password|cookie|authorization|code_verifier|codeverifier|nonce|session)/i

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]'
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (value && typeof value === 'object') {
    if (value instanceof Error) return { name: value.name, message: value.message }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1)
    return out
  }
  return value
}

type Level = 'debug' | 'info' | 'warn' | 'error'

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'test' && level !== 'error' && !process.env.LOG_IN_TESTS) return
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(fields ? (redact(fields) as object) : {}) })
  if (level === 'error' || level === 'warn') console.error(line)
  else console.log(line)
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => write('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => write('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => write('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => write('error', m, f),
}
