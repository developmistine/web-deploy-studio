import { getConfig, MB } from '@/server/config'
import { AppError } from '@/server/http/errors'

export type UploadLimits = {
  maxArchiveBytes: number
  maxFiles: number
  maxExtractedBytes: number
  maxFileBytes: number
  /** Max uncompressed/compressed ratio for entries larger than ratioThresholdBytes. */
  maxRatio: number
  ratioThresholdBytes: number
  maxPathLength: number
  maxPathDepth: number
}

export function limitsFromConfig(): UploadLimits {
  const c = getConfig()
  return limitsFromEnvNumbers({
    archiveMb: c.UPLOAD_MAX_ARCHIVE_MB,
    files: c.UPLOAD_MAX_FILES,
    extractedMb: c.UPLOAD_MAX_EXTRACTED_MB,
    fileMb: c.UPLOAD_MAX_FILE_MB,
    ratio: c.UPLOAD_MAX_RATIO,
  })
}

export function limitsFromEnvNumbers(n: { archiveMb: number; files: number; extractedMb: number; fileMb: number; ratio: number }): UploadLimits {
  return {
    maxArchiveBytes: n.archiveMb * MB,
    maxFiles: n.files,
    maxExtractedBytes: n.extractedMb * MB,
    maxFileBytes: n.fileMb * MB,
    maxRatio: n.ratio,
    ratioThresholdBytes: 1 * MB,
    maxPathLength: 240,
    maxPathDepth: 12,
  }
}

export type RejectReason =
  | 'EMPTY_UPLOAD'
  | 'ARCHIVE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'EXTRACTED_TOO_LARGE'
  | 'FILE_TOO_LARGE'
  | 'COMPRESSION_RATIO'
  | 'UNSAFE_PATH'
  | 'SYMLINK'
  | 'UNSAFE_ENTRY'
  | 'ENCRYPTED_ENTRY'
  | 'UNSUPPORTED_COMPRESSION'
  | 'UNSUPPORTED_FILE_TYPE'
  | 'CONTENT_MISMATCH'
  | 'DUPLICATE_PATH'
  | 'MISSING_INDEX'
  | 'CORRUPT_ARCHIVE'
  | 'NESTED_ARCHIVE'
  | 'MALWARE_DETECTED'

const REASON_MESSAGES: Record<RejectReason, string> = {
  EMPTY_UPLOAD: 'No files were uploaded.',
  ARCHIVE_TOO_LARGE: 'The upload exceeds the maximum size.',
  TOO_MANY_FILES: 'The project contains too many files.',
  EXTRACTED_TOO_LARGE: 'The extracted project is too large.',
  FILE_TOO_LARGE: 'A file exceeds the per-file size limit.',
  COMPRESSION_RATIO: 'A file is compressed suspiciously well (possible ZIP bomb).',
  UNSAFE_PATH: 'A file path is not allowed (absolute, parent "..", or invalid characters).',
  SYMLINK: 'Symbolic links are not allowed.',
  UNSAFE_ENTRY: 'The archive contains an unsupported entry type.',
  ENCRYPTED_ENTRY: 'Encrypted archives are not supported.',
  UNSUPPORTED_COMPRESSION: 'The archive uses an unsupported compression method.',
  UNSUPPORTED_FILE_TYPE: 'A file type is not allowed for static websites.',
  CONTENT_MISMATCH: 'A file’s content does not match its extension.',
  DUPLICATE_PATH: 'The project contains duplicate file paths.',
  MISSING_INDEX: 'index.html was not found at the project root.',
  CORRUPT_ARCHIVE: 'The ZIP file is damaged or invalid.',
  NESTED_ARCHIVE: 'Archives inside the upload are not allowed.',
  MALWARE_DETECTED: 'The upload was flagged by the malware scanner.',
}

/** Upload rejections are safe to show: they describe the user's own files, not our infrastructure. */
export function reject(reason: RejectReason, path?: string): AppError {
  const safePath = path ? path.replace(/[\u0000-\u001f\u007f]/g, '?').slice(0, 200) : undefined
  return new AppError('UPLOAD_REJECTED', { reason, ...(safePath ? { path: safePath } : {}) }, REASON_MESSAGES[reason])
}

export function rejectReason(e: unknown): RejectReason | null {
  if (e instanceof AppError && e.code === 'UPLOAD_REJECTED') return (e.details?.reason as RejectReason) ?? null
  return null
}
