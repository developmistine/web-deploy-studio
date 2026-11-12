import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yazl from 'yazl'
import { getConfig } from '@/server/config'
import { AppError } from '@/server/http/errors'
import { reject, type UploadLimits } from '@/server/uploads/limits'
import { inspectZip } from '@/server/uploads/archive'
import { assertUniquePaths, determineRootPrefix, homePageCandidate, isIgnoredEntry, normalizeEntryPath } from '@/server/uploads/paths'
import { validateBuffer } from '@/server/uploads/file-types'
import { sha256File } from '@/server/storage'

export type ReceivedUpload = {
  zipPath: string
  sha256: string
  size: number
  fileCount: number
  originalFilename: string
  cleanup: () => Promise<void>
}

const MULTIPART_OVERHEAD = 1024 * 1024

/**
 * Receives a multipart upload (field "files": one .zip, or many static files) and produces a
 * validated ZIP in a private temp dir. Performs structural validation only (no extraction);
 * the worker re-validates while extracting.
 */
export async function receiveUpload(req: Request, limits: UploadLimits): Promise<ReceivedUpload> {
  const ct = req.headers.get('content-type') ?? ''
  if (!ct.toLowerCase().startsWith('multipart/form-data')) throw new AppError('UNSUPPORTED_MEDIA_TYPE')
  const lenHeader = req.headers.get('content-length')
  if (!lenHeader) throw new AppError('LENGTH_REQUIRED')
  const len = Number(lenHeader)
  if (!Number.isFinite(len) || len < 0) throw new AppError('VALIDATION_FAILED')
  if (len > limits.maxArchiveBytes + MULTIPART_OVERHEAD) throw new AppError('PAYLOAD_TOO_LARGE', { reason: 'ARCHIVE_TOO_LARGE' })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    throw new AppError('VALIDATION_FAILED')
  }
  const files = form.getAll('files').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f)
  if (files.length === 0) throw reject('EMPTY_UPLOAD')

  const dir = await mkdtemp(path.join(getConfig().UPLOAD_TMP_DIR ?? tmpdir(), 'ds-upload-'))
  const cleanup = () => rm(dir, { recursive: true, force: true })
  try {
    const zipPath = path.join(dir, 'source.zip')
    const isSingleZip = files.length === 1 && /\.zip$/i.test(files[0]!.name)
    let fileCount: number
    let originalFilename: string

    if (isSingleZip) {
      const f = files[0]!
      if (f.size > limits.maxArchiveBytes) throw reject('ARCHIVE_TOO_LARGE')
      await pipeline(Readable.fromWeb(f.stream() as import('node:stream/web').ReadableStream), createWriteStream(zipPath, { flags: 'wx', mode: 0o600 }))
      const inspected = await inspectZip(zipPath, limits)
      fileCount = inspected.entries.length
      originalFilename = f.name
    } else {
      fileCount = await zipLooseFiles(files, zipPath, limits)
      originalFilename = files.length === 1 ? files[0]!.name : `${files.length} files`
    }

    const sha256 = await sha256File(zipPath)
    const { size } = await stat(zipPath)
    return { zipPath, sha256, size, fileCount, originalFilename: sanitizeFilename(originalFilename), cleanup }
  } catch (e) {
    await cleanup()
    throw e
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\u0000-\u001f\u007f\\/]/g, '_').slice(0, 200) || 'upload'
}

/** Validates loose files (HTML/CSS/JS/assets) and packs them into a canonical ZIP. */
async function zipLooseFiles(files: File[], zipPath: string, limits: UploadLimits): Promise<number> {
  if (files.length > limits.maxFiles) throw reject('TOO_MANY_FILES')
  let total = 0
  const accepted: { path: string; data: Buffer }[] = []
  for (const f of files) {
    if (isIgnoredEntry(f.name)) continue
    const p = normalizeEntryPath(f.name, limits)
    if (f.size > limits.maxFileBytes) throw reject('FILE_TOO_LARGE', p)
    total += f.size
    if (total > limits.maxExtractedBytes || total > limits.maxArchiveBytes) throw reject('EXTRACTED_TOO_LARGE')
    const data = Buffer.from(await f.arrayBuffer())
    validateBuffer(p, data)
    accepted.push({ path: p, data })
  }
  if (accepted.length === 0) throw reject('EMPTY_UPLOAD')
  const home = homePageCandidate(accepted.map((a) => a.path))
  if (home) accepted.find((a) => a.path === home)!.path = 'index.html'
  const paths = accepted.map((a) => a.path)
  assertUniquePaths(paths)
  determineRootPrefix(paths)

  const zip = new yazl.ZipFile()
  for (const a of accepted) zip.addBuffer(a.data, a.path, { mode: 0o100644, mtime: new Date(0) })
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(zipPath, { flags: 'wx', mode: 0o600 }))
  return accepted.length
}

/** Hash helper for idempotency request fingerprints. */
export function fingerprint(parts: (string | number)[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex')
}
