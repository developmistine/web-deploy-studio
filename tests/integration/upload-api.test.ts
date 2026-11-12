import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/server/db'
import * as deployments from '@/app/api/v1/websites/[id]/deployments/route'
import * as deploymentById from '@/app/api/v1/deployments/[id]/route'
import { getStorage } from '@/server/storage'
import { call, drain, login, makeWorker, resetDb, zipForm, type Session } from '../helpers/app'
import { createSite, upload } from '../helpers/flow'
import { buildZip, PNG_1PX } from '../helpers/zip'

let dtd: Session
let site: string
beforeEach(async () => {
  await resetDb()
  dtd = await login('dtd-user')
  site = await createSite(dtd, 'sales')
})

const post = (form: FormData, headers: Record<string, string> = {}) =>
  call(deployments.POST, { path: `/api/v1/websites/${site}/deployments`, session: dtd, form, params: { id: site }, headers })

describe('upload API security', () => {
  it.each([
    ['path traversal', [{ name: 'index.html', data: 'x' }, { name: '../../etc/x.html', data: 'x' }], 'UNSAFE_PATH'],
    ['symlink', [{ name: 'index.html', data: 'x' }, { name: 'l.html', data: '/etc/passwd', mode: 0o120777 }], 'SYMLINK'],
    ['zip bomb', [{ name: 'index.html', data: 'x' }, { name: 'b.txt', data: Buffer.alloc(3 * 1024 * 1024), deflate: true }], 'COMPRESSION_RATIO'],
    ['unsupported type', [{ name: 'index.html', data: 'x' }, { name: 'shell.php', data: '<?php' }], 'UNSUPPORTED_FILE_TYPE'],
    ['missing index', [{ name: 'main.html', data: 'x' }], 'MISSING_INDEX'],
  ])('rejects %s before anything is stored, and audits it', async (_label, entries, reason) => {
    const r = await post(zipForm(buildZip(entries as Parameters<typeof buildZip>[0])))
    expect(r.status).toBe(422)
    expect(r.json.error.details.reason).toBe(reason)
    expect(await getDb().deployment.count()).toBe(0)
    expect(await getDb().auditLog.count({ where: { action: 'UPLOAD_REJECTED' } })).toBe(1)
  })

  it('enforces the upload size limit before parsing the body', async () => {
    const big = Buffer.from(Array.from({ length: 6 * 1024 * 1024 }, () => Math.floor(Math.random() * 256)))
    const r = await post(zipForm(buildZip([{ name: 'index.html', data: 'x' }, { name: 'big.txt', data: big }])))
    expect(r.status).toBe(413)
    expect(await getDb().deployment.count()).toBe(0)
  })

  it('enforces the file count limit for loose files', async () => {
    const fd = new FormData()
    fd.append('files', new File(['<h1>x</h1>'], 'index.html'))
    for (let i = 0; i < 60; i++) fd.append('files', new File(['a{}'], `f${i}.css`))
    const r = await post(fd)
    expect(r.json.error.details.reason).toBe('TOO_MANY_FILES')
  })

  it('accepts loose HTML/CSS/JS/asset files, packs them and stores a private, write-once artifact', async () => {
    const fd = new FormData()
    fd.append('files', new File(['<h1>x</h1>'], 'index.html'))
    fd.append('files', new File(['a{}'], 'style.css'))
    fd.append('files', new File(['console.log(1)'], 'app.js'))
    fd.append('files', new File([new Uint8Array(PNG_1PX)], 'logo.png'))
    const r = await post(fd)
    expect(r.status).toBe(202)
    const d = await getDb().deployment.findUniqueOrThrow({ where: { id: r.json.deployment.id } })
    expect(d.fileCount).toBe(4)
    expect(d.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(d.sourceArtifactKey).toBe(`sources/${site}/${d.id}.zip`)
    // Write-once: an artifact can never be overwritten.
    await expect(getStorage().putFile(d.sourceArtifactKey!, getStorage().localPath(d.sourceArtifactKey!))).rejects.toThrow()
    // The DTO never leaks storage keys or image ids.
    expect(JSON.stringify(r.json)).not.toMatch(/sources\/|sha256:/)
  })

  it('a single loose HTML file (any name) becomes the home page and builds to a preview', async () => {
    const fd = new FormData()
    fd.append('files', new File(['<h1>demo</h1>'], 'demo-dashboard.html'))
    fd.append('files', new File(['a{}'], 'style.css'))
    const r = await post(fd)
    expect(r.status).toBe(202)
    const { ctx } = makeWorker()
    await drain(ctx)
    const d = await getDb().deployment.findUniqueOrThrow({ where: { id: r.json.deployment.id } })
    expect(d.status).toBe('PREVIEW_READY')
    expect(d.originalFilename).toBe('2 files')
  })

  it('several loose HTML files without index.html are still refused (no guessing the home page)', async () => {
    const fd = new FormData()
    fd.append('files', new File(['<h1>a</h1>'], 'a.html'))
    fd.append('files', new File(['<h1>b</h1>'], 'b.html'))
    const r = await post(fd)
    expect(r.status).toBe(422)
    expect(r.json.error.details.reason).toBe('MISSING_INDEX')
  })

  it('rejects disguised executables among loose files', async () => {
    const fd = new FormData()
    fd.append('files', new File(['<h1>x</h1>'], 'index.html'))
    fd.append('files', new File([new Uint8Array([0x4d, 0x5a, 0x90, 0x00])], 'logo.png'))
    expect((await post(fd)).json.error.details.reason).toBe('CONTENT_MISMATCH')
  })

  it('storage keys cannot escape the storage root', () => {
    expect(() => getStorage().localPath('../../etc/passwd')).toThrow()
    expect(() => getStorage().localPath('/abs/path')).toThrow()
  })

  it('worker re-validates during extraction and records validation failures', async () => {
    const r = await upload(dtd, site)
    expect(r.status).toBe(202)
    const { ctx } = makeWorker()
    await drain(ctx)
    const logs = await getDb().deploymentLog.findMany({ where: { deploymentId: r.json.deployment.id } })
    expect(logs.some((l) => /Validated 3 files/.test(l.message))).toBe(true)
    expect(logs.some((l) => /Malware scanning is not configured/.test(l.message))).toBe(true)
  })
})

describe('suspicious-script check (worker)', () => {
  const build = async (entries: { name: string; data: string }[]) => {
    const r = await post(zipForm(buildZip(entries)))
    expect(r.status).toBe(202)
    const { ctx } = makeWorker()
    await drain(ctx)
    const id = r.json.deployment.id as string
    return (await call(deploymentById.GET, { path: `/api/v1/deployments/${id}`, session: dtd, params: { id } })).json.deployment
  }

  it('blocks an upload with a crypto miner, shows the finding and raises a security alert', async () => {
    const d = await build([
      { name: 'index.html', data: '<script src="m.js"></script>' },
      { name: 'm.js', data: 'var m = new CoinHive.Anonymous("k"); m.start()' },
    ])
    expect(d.status).toBe('FAILED')
    expect(d.errorCode).toBe('SUSPICIOUS_CONTENT')
    expect(d.contentFindings).toEqual([expect.objectContaining({ severity: 'high', rule: 'crypto-miner', path: 'm.js', line: 1 })])
    expect(await getDb().auditLog.count({ where: { action: 'SECURITY_ALERT' } })).toBe(1)
    expect(await getDb().deploymentLog.count({ where: { deploymentId: d.id, level: 'error' } })).toBeGreaterThan(0)
  })

  it('lets a warning-only upload reach the preview, with the findings for review', async () => {
    const d = await build([{ name: 'index.html', data: '<script src="https://cdn.example.com/lib.js"></script><h1>x</h1>' }])
    expect(d.status).toBe('PREVIEW_READY')
    expect(d.contentFindings.map((f: { rule: string }) => f.rule)).toEqual(['external-script'])
  })

  it('a clean upload has no findings', async () => {
    const d = await build([{ name: 'index.html', data: '<h1>hello</h1><script>console.log(1)</script>' }])
    expect(d.status).toBe('PREVIEW_READY')
    expect(d.contentFindings).toEqual([])
  })
})
