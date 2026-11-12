import { createReadStream } from 'node:fs'
import net from 'node:net'
import type { WorkerConfig } from './config'

export type ScanResult = { clean: true } | { clean: false; signature: string }

export interface MalwareScanner {
  readonly name: string
  scanFile(file: string): Promise<ScanResult>
}

/** Explicit "no scanner" integration point. Logged on every build so the gap stays visible. */
export class NoopScanner implements MalwareScanner {
  readonly name = 'none'
  async scanFile(): Promise<ScanResult> {
    return { clean: true }
  }
}

/** ClamAV clamd INSTREAM protocol over TCP. ClamAV unpacks ZIPs itself, so the source archive is scanned once. */
export class ClamAvScanner implements MalwareScanner {
  readonly name = 'clamav'
  constructor(private readonly host: string, private readonly port: number) {}

  scanFile(file: string): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host: this.host, port: this.port })
      let reply = ''
      socket.setTimeout(120_000, () => socket.destroy(new Error('clamd timeout')))
      socket.on('error', reject)
      socket.on('data', (d) => (reply += d.toString('utf8')))
      socket.on('end', () => {
        const text = reply.replace(/\0/g, '').trim()
        if (/: OK$/.test(text)) return resolve({ clean: true })
        const m = /: (.+) FOUND$/.exec(text)
        if (m) return resolve({ clean: false, signature: m[1]! })
        reject(new Error('unexpected clamd reply'))
      })
      socket.on('connect', async () => {
        try {
          socket.write('zINSTREAM\0')
          for await (const chunk of createReadStream(file, { highWaterMark: 64 * 1024 })) {
            const buf = chunk as Buffer
            const len = Buffer.alloc(4)
            len.writeUInt32BE(buf.length)
            socket.write(len)
            socket.write(buf)
          }
          socket.end(Buffer.alloc(4)) // zero-length chunk terminates the stream
        } catch (e) {
          socket.destroy(e as Error)
        }
      })
    })
  }
}

export function createScanner(cfg: WorkerConfig): MalwareScanner {
  return cfg.MALWARE_SCAN_MODE === 'clamav' ? new ClamAvScanner(cfg.CLAMAV_HOST, cfg.CLAMAV_PORT) : new NoopScanner()
}
