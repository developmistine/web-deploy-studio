/**
 * Static content inspection of uploaded website files (HTML, JS, SVG, CSS) for suspicious scripts.
 *
 * This is a heuristic, defence-in-depth control — NOT a malware scanner (that is MALWARE_SCAN_MODE / ClamAV)
 * and not a guarantee. The primary runtime controls stay in place regardless: hosted sites run on their own
 * origin behind the gateway with a CSP that only allows the site's own scripts and `connect-src 'self'`.
 *
 *  - HIGH   → blocks the upload (worker, CONTENT_SCAN_MODE=block): patterns with very few legitimate uses.
 *  - MEDIUM → shown to the uploader before Deploy and written to the deployment log.
 *
 * All regular expressions use bounded quantifiers (no nested unbounded repetition) so a crafted file cannot
 * trigger catastrophic backtracking; file sizes are already capped by the upload limits.
 */

export type FindingSeverity = 'high' | 'medium'

export type ContentFinding = {
  severity: FindingSeverity
  rule: string
  path: string
  line: number
  message: string
}

type Rule = {
  id: string
  severity: FindingSeverity
  /** File kinds the rule applies to. */
  kinds: ReadonlyArray<'html' | 'js' | 'svg' | 'css'>
  pattern: RegExp
  message: string
  /** Optional second check on the matched text (e.g. "is this host external?"). */
  accept?: (match: RegExpExecArray) => boolean
}

const EXTERNAL_URL = /^\s*["']?\s*(?:https?:)?\/\//i
const IPV4_URL = /^\s*["']?\s*(?:https?:)?\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:[/"'?#\s]|$)/i
const isExternal = (v: string | undefined) => !!v && EXTERNAL_URL.test(v)

const RULES: Rule[] = [
  // ---------------- HIGH: blocked ----------------
  {
    id: 'crypto-miner',
    severity: 'high',
    kinds: ['html', 'js', 'svg'],
    pattern: /\b(?:coinhive|coin-hive|cryptonight|coinimp|cryptoloot|crypto-loot|webminepool|deepminer|minero\.cc|monerominer|webmine\.cz)\b/gi,
    message: 'พบโค้ดขุดคริปโต (crypto-miner)',
  },
  {
    id: 'obfuscated-exec',
    severity: 'high',
    kinds: ['html', 'js', 'svg'],
    pattern: /\b(?:eval|Function|setTimeout|setInterval)\s{0,5}\(\s{0,5}(?:window\.)?(?:atob|unescape|decodeURIComponent|escape|String\.fromCharCode)\s{0,5}\(/g,
    message: 'พบการรันโค้ดที่ถูกเข้ารหัส/ซ่อนไว้ (eval + atob/fromCharCode)',
  },
  {
    id: 'packed-exec',
    severity: 'high',
    kinds: ['html', 'js', 'svg'],
    pattern: /\beval\s{0,5}\(\s{0,5}function\s{0,5}\(\s{0,5}p\s{0,5},\s{0,5}a\s{0,5},\s{0,5}c\s{0,5},\s{0,5}k\s{0,5},\s{0,5}e\s{0,5},/g,
    message: 'พบโค้ดที่ถูกบีบอัดซ่อนเนื้อหา (eval(function(p,a,c,k,e,…)))',
  },
  {
    id: 'script-from-ip',
    severity: 'high',
    kinds: ['html', 'svg'],
    pattern: /<script\b[^>]{0,500}?\bsrc\s{0,3}=\s{0,3}(["']?[^\s"'>]{1,500})/gi,
    message: 'โหลดสคริปต์จากที่อยู่ IP โดยตรง',
    accept: (m) => IPV4_URL.test(m[1] ?? ''),
  },
  {
    id: 'password-form-external',
    severity: 'high',
    kinds: ['html'],
    // A form that posts to another site AND contains a password field (checked per form below).
    pattern: /<form\b[^>]{0,500}?\baction\s{0,3}=\s{0,3}(["']?[^\s"'>]{1,500})[^>]{0,500}>([\s\S]{0,20000}?)<\/form>/gi,
    message: 'ฟอร์มรหัสผ่านส่งข้อมูลออกไปเว็บไซต์ภายนอก (อาจเป็น phishing)',
    accept: (m) => isExternal(m[1]) && /<input\b[^>]{0,300}?type\s{0,3}=\s{0,3}["']?password/i.test(m[2] ?? ''),
  },

  // ---------------- MEDIUM: warnings ----------------
  {
    id: 'external-script',
    severity: 'medium',
    kinds: ['html', 'svg'],
    pattern: /<script\b[^>]{0,500}?\bsrc\s{0,3}=\s{0,3}(["']?[^\s"'>]{1,500})/gi,
    message: 'โหลดสคริปต์จากเว็บไซต์ภายนอก (จะไม่ทำงาน: นโยบายความปลอดภัยอนุญาตเฉพาะสคริปต์ในเว็บไซต์เอง)',
    accept: (m) => isExternal(m[1]) && !IPV4_URL.test(m[1] ?? ''),
  },
  {
    id: 'dynamic-code',
    severity: 'medium',
    kinds: ['html', 'js', 'svg'],
    pattern: /(?:\beval\s{0,5}\(|\bnew\s{1,5}Function\s{0,5}\()/g,
    message: 'มีการสร้าง/รันโค้ดแบบไดนามิก (eval / new Function)',
  },
  {
    id: 'external-form',
    severity: 'medium',
    kinds: ['html'],
    pattern: /<form\b[^>]{0,500}?\baction\s{0,3}=\s{0,3}(["']?[^\s"'>]{1,500})/gi,
    message: 'ฟอร์มส่งข้อมูลไปเว็บไซต์ภายนอก',
    accept: (m) => isExternal(m[1]),
  },
  {
    id: 'external-redirect',
    severity: 'medium',
    kinds: ['html', 'js'],
    pattern: /(?:http-equiv\s{0,3}=\s{0,3}["']?refresh["']?[^>]{0,200}?url\s{0,3}=\s{0,3}(?:https?:)?\/\/|(?:window\.|document\.|top\.)?location(?:\.href)?\s{0,3}=\s{0,3}["'`](?:https?:)?\/\/|location\.(?:replace|assign)\s{0,3}\(\s{0,3}["'`](?:https?:)?\/\/)/gi,
    message: 'เปลี่ยนเส้นทางผู้ใช้ไปเว็บไซต์ภายนอก',
  },
  // Channels the site CSP cannot restrict (R-24): data can leave through them even with connect-src 'self'.
  {
    id: 'window-open',
    severity: 'medium',
    kinds: ['html', 'js', 'svg'],
    pattern: /\bwindow\.open\s{0,5}\(/g,
    message: 'เปิดหน้าต่าง/แท็บใหม่ด้วยสคริปต์ (ช่องทางนี้ส่งข้อมูลออกนอกระบบได้โดยไม่ผ่าน CSP)',
  },
  {
    id: 'webrtc',
    severity: 'medium',
    kinds: ['html', 'js', 'svg'],
    pattern: /\b(?:RTCPeerConnection|webkitRTCPeerConnection|RTCDataChannel)\b/g,
    message: 'ใช้ WebRTC (ส่งข้อมูลออกนอกระบบได้โดยไม่ผ่าน CSP)',
  },
  {
    id: 'dynamic-redirect',
    severity: 'medium',
    kinds: ['html', 'js'],
    // Navigation to a URL built at runtime (not a quoted literal) — literals to other sites are `external-redirect`.
    pattern: /(?:(?:\b(?:window|document|top|self|parent)\.)?\blocation(?:\.href)?\s{0,3}=(?!=)\s{0,3}(?!["'`\s])[A-Za-z_$(]|\blocation\.(?:assign|replace)\s{0,5}\(\s{0,5}(?!["'`\s)])[A-Za-z_$(])/g,
    message: 'เปลี่ยนหน้าไปยัง URL ที่สร้างขึ้นตอนรัน (อาจใช้ส่งข้อมูลออกนอกระบบ)',
  },
  {
    id: 'external-frame',
    severity: 'medium',
    kinds: ['html'],
    pattern: /<(?:iframe|frame|embed|object)\b[^>]{0,500}?\b(?:src|data)\s{0,3}=\s{0,3}(["']?[^\s"'>]{1,500})/gi,
    message: 'ฝังหน้าเว็บ/ไฟล์จากเว็บไซต์ภายนอก',
    accept: (m) => isExternal(m[1]),
  },
  {
    id: 'cookie-access',
    severity: 'medium',
    kinds: ['html', 'js', 'svg'],
    pattern: /\bdocument\.cookie\b/g,
    message: 'อ่าน/เขียน cookie ของผู้ใช้',
  },
  {
    id: 'svg-script',
    severity: 'medium',
    kinds: ['svg'],
    pattern: /<script\b|\bon[a-z]{3,20}\s{0,3}=\s{0,3}["']/gi,
    message: 'ไฟล์ SVG มีสคริปต์หรือ event handler',
  },
  {
    id: 'obfuscated-strings',
    severity: 'medium',
    kinds: ['html', 'js', 'svg'],
    pattern: /(?:\\x[0-9a-f]{2}){40}|(?:\\u[0-9a-f]{4}){30}|["'`][A-Za-z0-9+/]{3000}={0,2}["'`]/gi,
    message: 'มีข้อความที่ถูกเข้ารหัสยาวผิดปกติ (อาจซ่อนโค้ด)',
  },
  {
    id: 'css-script',
    severity: 'medium',
    kinds: ['css', 'html'],
    pattern: /\bexpression\s{0,3}\(|url\s{0,3}\(\s{0,3}["']?\s{0,3}javascript:/gi,
    message: 'CSS พยายามรันสคริปต์ (expression / javascript:)',
  },
]

const MAX_PER_RULE_PER_FILE = 3
export const MAX_FINDINGS = 50

export function fileKind(p: string): 'html' | 'js' | 'svg' | 'css' | null {
  const ext = p.toLowerCase().split('.').pop()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'js' || ext === 'mjs') return 'js'
  if (ext === 'svg') return 'svg'
  if (ext === 'css') return 'css'
  return null
}

function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/** Scans one file's text. Pure; no I/O. */
export function scanText(path: string, text: string): ContentFinding[] {
  const kind = fileKind(path)
  if (!kind) return []
  const out: ContentFinding[] = []
  const flaggedHigh = new Set<number>() // match positions already reported as HIGH (avoid duplicate MEDIUM)
  for (const rule of RULES) {
    if (!rule.kinds.includes(kind)) continue
    rule.pattern.lastIndex = 0
    let hits = 0
    let m: RegExpExecArray | null
    while ((m = rule.pattern.exec(text)) && hits < MAX_PER_RULE_PER_FILE) {
      if (m[0].length === 0) rule.pattern.lastIndex++
      if (rule.accept && !rule.accept(m)) continue
      if (rule.severity === 'medium' && flaggedHigh.has(m.index)) continue
      if (rule.severity === 'high') flaggedHigh.add(m.index)
      out.push({ severity: rule.severity, rule: rule.id, path, line: lineAt(text, m.index), message: rule.message })
      hits++
    }
  }
  return out
}

/** Scans every text file of a validated site. HIGH findings first, capped at MAX_FINDINGS. */
export function scanSite(files: ReadonlyArray<{ path: string; text: string }>): ContentFinding[] {
  const all = files.flatMap((f) => scanText(f.path, f.text))
  all.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1))
  return all.slice(0, MAX_FINDINGS)
}
