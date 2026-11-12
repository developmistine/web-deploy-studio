import { reject } from '@/server/uploads/limits'

type Rule = { kind: 'text' } | { kind: 'binary'; magic: (head: Buffer) => boolean }

const startsWith = (head: Buffer, bytes: number[], offset = 0) => bytes.every((b, i) => head[offset + i] === b)
const ascii = (head: Buffer, s: string, offset = 0) => head.subarray(offset, offset + s.length).toString('latin1') === s

const TEXT: Rule = { kind: 'text' }

/** Allowlist for static websites. Anything else (exe, php, sh, zip, Dockerfile, …) is rejected. */
export const FILE_RULES: Record<string, Rule> = {
  html: TEXT,
  htm: TEXT,
  css: TEXT,
  js: TEXT,
  mjs: TEXT,
  json: TEXT,
  map: TEXT,
  txt: TEXT,
  xml: TEXT,
  csv: TEXT,
  md: TEXT,
  svg: TEXT,
  webmanifest: TEXT,
  png: { kind: 'binary', magic: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  jpg: { kind: 'binary', magic: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  jpeg: { kind: 'binary', magic: (h) => startsWith(h, [0xff, 0xd8, 0xff]) },
  gif: { kind: 'binary', magic: (h) => ascii(h, 'GIF87a') || ascii(h, 'GIF89a') },
  webp: { kind: 'binary', magic: (h) => ascii(h, 'RIFF') && ascii(h, 'WEBP', 8) },
  avif: { kind: 'binary', magic: (h) => ascii(h, 'ftyp', 4) },
  ico: { kind: 'binary', magic: (h) => startsWith(h, [0x00, 0x00, 0x01, 0x00]) },
  woff: { kind: 'binary', magic: (h) => ascii(h, 'wOFF') },
  woff2: { kind: 'binary', magic: (h) => ascii(h, 'wOF2') },
  ttf: { kind: 'binary', magic: (h) => startsWith(h, [0x00, 0x01, 0x00, 0x00]) || ascii(h, 'true') },
  otf: { kind: 'binary', magic: (h) => ascii(h, 'OTTO') },
}

const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'jar', 'war'])

export function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? ''
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

export function ruleFor(path: string): Rule {
  const ext = extensionOf(path)
  if (ARCHIVE_EXT.has(ext)) throw reject('NESTED_ARCHIVE', path)
  const rule = FILE_RULES[ext]
  if (!rule) throw reject('UNSUPPORTED_FILE_TYPE', path)
  return rule
}

/**
 * Streaming content validator: text files must be valid UTF-8 without NUL bytes,
 * binary files must start with the expected magic bytes.
 */
export class ContentValidator {
  private readonly rule: Rule
  private head = Buffer.alloc(0)
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })

  constructor(private readonly path: string) {
    this.rule = ruleFor(path)
  }

  update(chunk: Buffer): void {
    if (this.head.length < 16) this.head = Buffer.concat([this.head, chunk.subarray(0, 16 - this.head.length)])
    if (this.rule.kind === 'text') {
      if (chunk.includes(0)) throw reject('CONTENT_MISMATCH', this.path)
      try {
        this.decoder.decode(chunk, { stream: true })
      } catch {
        throw reject('CONTENT_MISMATCH', this.path)
      }
    }
  }

  finish(): void {
    if (this.rule.kind === 'text') {
      try {
        this.decoder.decode()
      } catch {
        throw reject('CONTENT_MISMATCH', this.path)
      }
      return
    }
    if (!this.rule.magic(this.head)) throw reject('CONTENT_MISMATCH', this.path)
  }
}

export function validateBuffer(path: string, data: Buffer): void {
  const v = new ContentValidator(path)
  v.update(data)
  v.finish()
}
