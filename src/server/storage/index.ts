import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { chmod, copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { getConfig } from '@/server/config'

/**
 * Private artifact storage (filesystem volume, not web-served). Write-once semantics:
 * an existing key can never be overwritten, which keeps revisions immutable.
 * Replace with an object-store implementation (S3/MinIO with object lock) by keeping this interface.
 */
export interface ArtifactStorage {
  putFile(key: string, sourcePath: string): Promise<{ sha256: string; size: number }>
  localPath(key: string): string
  exists(key: string): Promise<boolean>
}

const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,400}$/

export function assertValidKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) throw new Error('invalid storage key')
}

export const storageKeys = {
  source: (websiteId: string, deploymentId: string) => `sources/${websiteId}/${deploymentId}.zip`,
  build: (websiteId: string, deploymentId: string) => `builds/${websiteId}/${deploymentId}.zip`,
}

export async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer)
  return h.digest('hex')
}

export class FsArtifactStorage implements ArtifactStorage {
  private readonly root: string
  constructor(root: string) {
    this.root = path.resolve(root)
  }

  localPath(key: string): string {
    assertValidKey(key)
    const p = path.resolve(this.root, ...key.split('/'))
    if (!p.startsWith(this.root + path.sep)) throw new Error('invalid storage key')
    return p
  }

  async putFile(key: string, sourcePath: string) {
    const dest = this.localPath(key)
    await mkdir(path.dirname(dest), { recursive: true, mode: 0o750 })
    // COPYFILE_EXCL: never overwrite an existing artifact.
    await copyFile(sourcePath, dest, constants.COPYFILE_EXCL)
    await chmod(dest, 0o440)
    const [sha256, s] = await Promise.all([sha256File(dest), stat(dest)])
    return { sha256, size: s.size }
  }

  async exists(key: string) {
    try {
      await stat(this.localPath(key))
      return true
    } catch {
      return false
    }
  }
}

let instance: ArtifactStorage | null = null
export function getStorage(): ArtifactStorage {
  instance ??= new FsArtifactStorage(getConfig().STORAGE_ROOT)
  return instance
}
export function resetStorageForTests(): void {
  instance = null
}
