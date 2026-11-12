import { reject, type UploadLimits } from '@/server/uploads/limits'

/** Entries silently skipped (OS metadata), never extracted. */
export function isIgnoredEntry(path: string): boolean {
  const lower = path.toLowerCase()
  const base = lower.split('/').pop() ?? ''
  return lower.startsWith('__macosx/') || base === '.ds_store' || base === 'thumbs.db' || base === 'desktop.ini'
}

const SEGMENT_RE = /^[\p{L}\p{N} ._()+@~,=-]+$/u

/**
 * Converts an archive / upload path into a safe relative POSIX path, or throws UNSAFE_PATH.
 * Rejects rather than "fixes" anything suspicious.
 */
export function normalizeEntryPath(raw: string, limits: Pick<UploadLimits, 'maxPathLength' | 'maxPathDepth'>): string {
  if (typeof raw !== 'string' || raw.length === 0) throw reject('UNSAFE_PATH', raw)
  const p = raw.normalize('NFC')
  if (p.includes('\\') || p.includes('\u0000') || /[\u0000-\u001f\u007f]/.test(p)) throw reject('UNSAFE_PATH', raw)
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) throw reject('UNSAFE_PATH', raw)
  const trimmed = p.endsWith('/') ? p.slice(0, -1) : p
  const segments = trimmed.split('/')
  if (segments.length > limits.maxPathDepth || trimmed.length > limits.maxPathLength) throw reject('UNSAFE_PATH', raw)
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..') throw reject('UNSAFE_PATH', raw)
    if (s.startsWith('.') && s !== '.well-known') throw reject('UNSAFE_PATH', raw)
    if (s.endsWith('.') || s.endsWith(' ') || s.startsWith('-')) throw reject('UNSAFE_PATH', raw)
    if (!SEGMENT_RE.test(s)) throw reject('UNSAFE_PATH', raw)
  }
  return trimmed
}

/**
 * Finds the site root: index.html at the archive root, or inside a single top-level folder
 * (the common "zip the project folder" case). Returns the prefix to strip.
 */
export function determineRootPrefix(paths: string[]): string {
  if (paths.includes('index.html')) return ''
  const firstSegments = new Set(paths.map((p) => p.split('/')[0]))
  if (firstSegments.size === 1) {
    const [only] = [...firstSegments]
    if (only && paths.includes(`${only}/index.html`)) return `${only}/`
  }
  throw reject('MISSING_INDEX')
}

/**
 * Loose-file uploads only: when no index.html exists anywhere and exactly ONE .html/.htm file sits at the
 * root (e.g. "demo-dashboard.html" dropped on its own, optionally with its CSS/JS), it becomes the home
 * page. Returns the path to rename, or null. Ambiguous uploads (several root HTML files) still fail with
 * MISSING_INDEX rather than guessing which page is the home page.
 */
export function homePageCandidate(paths: string[]): string | null {
  if (paths.some((p) => p === 'index.html' || p.endsWith('/index.html'))) return null
  const rootHtml = paths.filter((p) => !p.includes('/') && /\.html?$/i.test(p))
  return rootHtml.length === 1 ? rootHtml[0]! : null
}

/** Throws DUPLICATE_PATH for case-insensitive collisions (unsafe on some filesystems / proxies). */
export function assertUniquePaths(paths: string[]): void {
  const seen = new Set<string>()
  for (const p of paths) {
    const k = p.toLowerCase()
    if (seen.has(k)) throw reject('DUPLICATE_PATH', p)
    seen.add(k)
  }
}
