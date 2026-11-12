import { mkdtempSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractZip, inspectZip } from '@/server/uploads/archive'
import { limitsFromEnvNumbers, rejectReason } from '@/server/uploads/limits'
import { normalizeEntryPath } from '@/server/uploads/paths'
import { buildZip, PNG_1PX, siteZip, type RawEntry } from '../helpers/zip'

const limits = limitsFromEnvNumbers({ archiveMb: 5, files: 20, extractedMb: 3, fileMb: 2, ratio: 50 })

function writeZip(buf: Buffer): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ds-zip-'))
  const f = path.join(dir, 'u.zip')
  writeFileSync(f, buf)
  return f
}

async function reasonOf(entries: RawEntry[] | Buffer, mode: 'inspect' | 'extract' = 'extract'): Promise<string | null> {
  const file = writeZip(Buffer.isBuffer(entries) ? entries : buildZip(entries))
  const dest = mkdtempSync(path.join(tmpdir(), 'ds-out-'))
  try {
    if (mode === 'inspect') await inspectZip(file, limits)
    else await extractZip(file, dest, limits)
    return null
  } catch (e) {
    const r = rejectReason(e)
    if (!r) throw e
    return r
  }
}

const index = { name: 'index.html', data: '<h1>x</h1>' }

describe('upload security: archive validation', () => {
  it('accepts a valid static site and hashes every file', async () => {
    const dest = mkdtempSync(path.join(tmpdir(), 'ds-ok-'))
    const res = await extractZip(writeZip(siteZip()), dest, limits)
    expect(res.files.map((f) => f.path).sort()).toEqual(['img/logo.png', 'index.html', 'style.css'])
    expect(res.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true)
  })

  it('accepts a project zipped inside a single top-level folder (strips the prefix)', async () => {
    const dest = mkdtempSync(path.join(tmpdir(), 'ds-ok-'))
    const res = await extractZip(writeZip(buildZip([{ name: 'proj/index.html', data: '<p>' }, { name: 'proj/a.css', data: 'a{}' }])), dest, limits)
    expect(res.files.map((f) => f.path).sort()).toEqual(['a.css', 'index.html'])
  })

  it.each([
    ['../evil.html'],
    ['a/../../evil.html'],
    ['/etc/passwd.txt'],
    ['C:/Windows/x.html'],
    ['a\\..\\b.html'],
    ['.hidden/x.html'],
    ['a/./b.html'],
    ['-rf.html'],
  ])('rejects path traversal / unsafe path %s', async (name) => {
    expect(await reasonOf([index, { name, data: 'x' }])).toBe('UNSAFE_PATH')
  })

  it('rejects symlink entries', async () => {
    expect(await reasonOf([index, { name: 'link.html', data: '/etc/passwd', mode: 0o120777 }])).toBe('SYMLINK')
  })

  it('rejects device/fifo entries', async () => {
    expect(await reasonOf([index, { name: 'fifo.html', data: '', mode: 0o010644 }])).toBe('UNSAFE_ENTRY')
  })

  it('rejects ZIP bombs by compression ratio', async () => {
    expect(await reasonOf([index, { name: 'bomb.txt', data: Buffer.alloc(1.5 * 1024 * 1024, 0x61), deflate: true }])).toBe('COMPRESSION_RATIO')
  })

  it('rejects archives whose headers lie about size (bomb with small declared size)', async () => {
    const r = await reasonOf([index, { name: 'big.txt', data: Buffer.alloc(3 * 1024 * 1024, 0x61), deflate: true, fakeUncompressedSize: 10 }])
    expect(['CORRUPT_ARCHIVE', 'FILE_TOO_LARGE', 'EXTRACTED_TOO_LARGE']).toContain(r)
  })

  it('enforces total extracted size', async () => {
    const chunk = Buffer.alloc(1.5 * 1024 * 1024, 0x62)
    expect(await reasonOf([index, { name: 'a.txt', data: chunk }, { name: 'b.txt', data: chunk }, { name: 'c.txt', data: chunk }])).toBe('EXTRACTED_TOO_LARGE')
  })

  it('enforces per-file size', async () => {
    expect(await reasonOf([index, { name: 'a.txt', data: Buffer.alloc(2.5 * 1024 * 1024, 0x62) }])).toBe('FILE_TOO_LARGE')
  })

  it('enforces file count', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `f${i}.css`, data: 'a{}' }))
    expect(await reasonOf([index, ...many])).toBe('TOO_MANY_FILES')
  })

  it.each(['run.exe', 'x.php', 'deploy.sh', 'Dockerfile', 'app.py', 'x.wasm'])('rejects unsupported file type %s', async (name) => {
    expect(await reasonOf([index, { name, data: 'x' }])).toBe('UNSUPPORTED_FILE_TYPE')
  })

  it('rejects nested archives', async () => {
    expect(await reasonOf([index, { name: 'inner.zip', data: 'PK' }])).toBe('NESTED_ARCHIVE')
  })

  it('rejects missing index.html', async () => {
    expect(await reasonOf([{ name: 'home.html', data: '<p>' }])).toBe('MISSING_INDEX')
    expect(await reasonOf([{ name: 'a/index.html', data: '<p>' }, { name: 'b/x.css', data: 'a{}' }])).toBe('MISSING_INDEX')
  })

  it('rejects content that does not match its extension', async () => {
    expect(await reasonOf([index, { name: 'logo.png', data: 'not a png' }])).toBe('CONTENT_MISMATCH')
    expect(await reasonOf([index, { name: 'app.js', data: Buffer.from([0x4d, 0x5a, 0x00, 0x01]) }])).toBe('CONTENT_MISMATCH')
    expect(await reasonOf([index, { name: 'ok.png', data: PNG_1PX }])).toBeNull()
  })

  it('rejects encrypted entries', async () => {
    expect(await reasonOf([index, { name: 'secret.txt', data: 'x', encrypted: true }])).toBe('ENCRYPTED_ENTRY')
  })

  it('rejects case-insensitive duplicate paths', async () => {
    expect(await reasonOf([index, { name: 'A.css', data: 'a{}' }, { name: 'a.css', data: 'b{}' }])).toBe('DUPLICATE_PATH')
  })

  it('rejects corrupt archives', async () => {
    expect(await reasonOf(Buffer.from('this is not a zip at all'))).toBe('CORRUPT_ARCHIVE')
  })

  it('ignores OS metadata and never writes outside the destination', async () => {
    const dest = mkdtempSync(path.join(tmpdir(), 'ds-ok-'))
    await extractZip(writeZip(buildZip([index, { name: '__MACOSX/._index.html', data: 'x' }, { name: '.DS_Store', data: 'x' }])), dest, limits)
    expect(readdirSync(dest)).toEqual(['index.html'])
    expect(existsSync(path.join(dest, '..', 'evil.html'))).toBe(false)
  })

  it('path normalizer allows nested safe paths and .well-known', () => {
    expect(normalizeEntryPath('assets/css/main.css', limits)).toBe('assets/css/main.css')
    expect(normalizeEntryPath('.well-known/security.txt', limits)).toBe('.well-known/security.txt')
  })
})

describe('loose-file home page', () => {
  it('a single root HTML file becomes index.html; ambiguous or existing index → no rename', async () => {
    const { homePageCandidate } = await import('@/server/uploads/paths')
    expect(homePageCandidate(['demo-dashboard.html', 'style.css'])).toBe('demo-dashboard.html')
    expect(homePageCandidate(['page.HTM'])).toBe('page.HTM')
    expect(homePageCandidate(['index.html', 'about.html'])).toBeNull()
    expect(homePageCandidate(['site/index.html', 'x.html'])).toBeNull()
    expect(homePageCandidate(['a.html', 'b.html'])).toBeNull()
    expect(homePageCandidate(['docs/a.html'])).toBeNull()
    expect(homePageCandidate(['style.css'])).toBeNull()
  })
})
