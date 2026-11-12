import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { reject, type UploadLimits } from '@/server/uploads/limits'
import { assertUniquePaths, determineRootPrefix, isIgnoredEntry, normalizeEntryPath } from '@/server/uploads/paths'
import { ContentValidator, ruleFor } from '@/server/uploads/file-types'
import { AppError } from '@/server/http/errors'

export type InspectedEntry = { rawName: string; path: string; size: number; compressedSize: number; entry: yauzl.Entry }
export type InspectResult = { entries: InspectedEntry[]; rootPrefix: string; totalBytes: number }
export type ManifestFile = { path: string; size: number; sha256: string }
export type ExtractResult = { files: ManifestFile[]; totalBytes: number }

const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, rejectP) => {
    // decodeStrings:false → we decode and validate names ourselves for precise rejection codes.
    yauzl.open(file, { lazyEntries: true, autoClose: false, decodeStrings: false, validateEntrySizes: true, strictFileNames: true }, (err, zf) => {
      if (err || !zf) return rejectP(reject('CORRUPT_ARCHIVE'))
      resolve(zf)
    })
  })
}

function decodeName(entry: yauzl.Entry): string {
  const raw = entry.fileName as unknown as Buffer
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    throw reject('UNSAFE_PATH')
  }
}

/** Reads the central directory and validates every entry WITHOUT extracting anything. */
export async function inspectZip(file: string, limits: UploadLimits): Promise<InspectResult> {
  const zf = await openZip(file)
  try {
    if (zf.entryCount > limits.maxFiles * 2 + 100) throw reject('TOO_MANY_FILES')
    const entries: InspectedEntry[] = []
    let totalBytes = 0
    await new Promise<void>((resolve, rejectP) => {
      zf.on('error', () => rejectP(reject('CORRUPT_ARCHIVE')))
      zf.on('end', () => resolve())
      zf.on('entry', (entry: yauzl.Entry) => {
        try {
          const rawName = decodeName(entry)
          if (isIgnoredEntry(rawName)) return zf.readEntry()
          const isDir = rawName.endsWith('/')
          const mode = (entry.externalFileAttributes >>> 16) & S_IFMT
          if (mode === S_IFLNK) throw reject('SYMLINK', rawName)
          if (mode !== 0 && mode !== S_IFREG && mode !== S_IFDIR) throw reject('UNSAFE_ENTRY', rawName)
          const normalized = normalizeEntryPath(rawName, limits)
          if (isDir) return zf.readEntry()
          if ((entry.generalPurposeBitFlag & 0x1) !== 0) throw reject('ENCRYPTED_ENTRY', rawName)
          if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) throw reject('UNSUPPORTED_COMPRESSION', rawName)
          ruleFor(normalized) // extension allowlist
          if (entry.uncompressedSize > limits.maxFileBytes) throw reject('FILE_TOO_LARGE', rawName)
          if (
            entry.uncompressedSize > limits.ratioThresholdBytes &&
            entry.uncompressedSize / Math.max(1, entry.compressedSize) > limits.maxRatio
          ) {
            throw reject('COMPRESSION_RATIO', rawName)
          }
          totalBytes += entry.uncompressedSize
          if (totalBytes > limits.maxExtractedBytes) throw reject('EXTRACTED_TOO_LARGE')
          entries.push({ rawName, path: normalized, size: entry.uncompressedSize, compressedSize: entry.compressedSize, entry })
          if (entries.length > limits.maxFiles) throw reject('TOO_MANY_FILES')
          zf.readEntry()
        } catch (e) {
          rejectP(e)
        }
      })
      zf.readEntry()
    })
    if (entries.length === 0) throw reject('EMPTY_UPLOAD')
    const paths = entries.map((e) => e.path)
    assertUniquePaths(paths)
    const rootPrefix = determineRootPrefix(paths)
    return { entries, rootPrefix, totalBytes }
  } finally {
    zf.close()
  }
}

/** Counts real decompressed bytes (never trusts headers), hashes, and validates content. */
class GuardStream extends Transform {
  readonly hash = createHash('sha256')
  bytes = 0
  private readonly validator: ContentValidator
  constructor(
    private readonly entryPath: string,
    private readonly limits: UploadLimits,
    private readonly total: { bytes: number },
  ) {
    super()
    this.validator = new ContentValidator(entryPath)
  }
  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    try {
      this.bytes += chunk.length
      this.total.bytes += chunk.length
      if (this.bytes > this.limits.maxFileBytes) throw reject('FILE_TOO_LARGE', this.entryPath)
      if (this.total.bytes > this.limits.maxExtractedBytes) throw reject('EXTRACTED_TOO_LARGE')
      this.validator.update(chunk)
      this.hash.update(chunk)
      cb(null, chunk)
    } catch (e) {
      cb(e as Error)
    }
  }
  override _flush(cb: TransformCallback): void {
    try {
      this.validator.finish()
      cb()
    } catch (e) {
      cb(e as Error)
    }
  }
}

/**
 * Validates then extracts into `destDir` (which must be empty and private), stripping the root prefix.
 * Every write is confined to destDir and created exclusively (`wx`).
 */
export async function extractZip(file: string, destDir: string, limits: UploadLimits): Promise<ExtractResult> {
  const inspected = await inspectZip(file, limits)
  const root = path.resolve(destDir)
  const zf = await openZip(file)
  const total = { bytes: 0 }
  const files: ManifestFile[] = []
  try {
    for (const item of inspected.entries) {
      const rel = item.path.slice(inspected.rootPrefix.length)
      if (!rel || !item.path.startsWith(inspected.rootPrefix)) continue // outside the site root: ignored
      const target = path.resolve(root, ...rel.split('/'))
      if (!target.startsWith(root + path.sep)) throw reject('UNSAFE_PATH', item.rawName)
      await mkdir(path.dirname(target), { recursive: true })
      const source = await new Promise<NodeJS.ReadableStream>((resolve, rejectP) =>
        zf.openReadStream(item.entry, (err, s) => (err || !s ? rejectP(reject('CORRUPT_ARCHIVE', item.rawName)) : resolve(s))),
      )
      const guard = new GuardStream(item.path, limits, total)
      try {
        await pipeline(source, guard, createWriteStream(target, { flags: 'wx', mode: 0o644 }))
      } catch (e) {
        if (e instanceof AppError) throw e
        // yauzl size validation failures (lying headers) and stream errors end up here.
        throw reject('CORRUPT_ARCHIVE', item.rawName)
      }
      files.push({ path: rel, size: guard.bytes, sha256: guard.hash.digest('hex') })
    }
  } finally {
    zf.close()
  }
  if (!files.some((f) => f.path === 'index.html')) throw reject('MISSING_INDEX')
  return { files, totalBytes: total.bytes }
}
