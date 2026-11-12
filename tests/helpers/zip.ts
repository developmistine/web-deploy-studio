import { crc32, deflateRawSync } from 'node:zlib'

/**
 * Minimal raw ZIP writer for tests. Unlike real zip tools it lets us craft malicious archives:
 * traversal names, symlink entries, lying size headers, encrypted flags, huge compression ratios.
 */
export type RawEntry = {
  name: string
  data?: Buffer | string
  /** Unix mode stored in external attributes (e.g. 0o120777 for symlink). */
  mode?: number
  deflate?: boolean
  /** Override header sizes (to simulate lying headers). */
  fakeUncompressedSize?: number
  encrypted?: boolean
}

export function buildZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '', 'utf8')
    const plain = e.deflate ? deflateRawSync(raw) : raw
    // Traditional ZIP encryption prefixes 12 header bytes to the (stored) data — mimic a real encrypted entry.
    const body = e.encrypted ? Buffer.concat([Buffer.alloc(12, 7), plain]) : plain
    const method = e.deflate ? 8 : 0
    const crc = crc32(raw) >>> 0
    const usize = e.fakeUncompressedSize ?? raw.length
    const flags = 0x0800 | (e.encrypted ? 0x1 : 0)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(usize, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4) // made by: unix
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(usize, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

export const PNG_1PX = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
)

export function siteZip(extra: RawEntry[] = []): Buffer {
  return buildZip([
    { name: 'index.html', data: '<!doctype html><title>t</title><link rel="stylesheet" href="style.css"><h1>Hello</h1>' },
    { name: 'style.css', data: 'h1{color:#e73596}' },
    { name: 'img/logo.png', data: PNG_1PX },
    ...extra,
  ])
}
