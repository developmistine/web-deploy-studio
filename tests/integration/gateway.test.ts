import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '@/server/db'
import { GET as gate } from '@/app/api/internal/gate/route'
import { GET as authorize } from '@/app/api/gateway/authorize/route'
import { clearGateCache } from '@/server/gateway/gate'
import { sha256Hex } from '@/server/crypto'
import { APP, login, makeWorker, resetDb, type Session } from '../helpers/app'
import { createSite, deployLive, openPreview, uploadAndBuild } from '../helpers/flow'

const SITE_HOST = 'dtd-sales.sites.localhost'
let dtd: Session, erp: Session, admin: Session
let w: ReturnType<typeof makeWorker>

/** What Traefik's forwardAuth sends to the gate for a browser request to `host` + `uri`. */
function gateReq(host: string, uri: string, cookie?: string, extra: Record<string, string> = {}) {
  return gate(
    new Request('http://web:3000/api/internal/gate', {
      headers: { 'x-forwarded-host': `${host}:8080`, 'x-forwarded-uri': uri, 'x-forwarded-method': 'GET', ...(cookie ? { cookie } : {}), ...extra },
    }),
  )
}

/** Browser hits the management authorize endpoint (top-level navigation carries the management cookie). */
function authorizeReq(host: string, s?: Session, r = '/') {
  return authorize(
    new Request(`${APP}/api/gateway/authorize?host=${encodeURIComponent(host)}&r=${encodeURIComponent(r)}`, {
      headers: { host: 'localhost:3000', ...(s ? { cookie: s.cookie } : {}) },
    }),
  )
}

/** Completes the SSO handshake on the site origin; returns the gateway cookie (name=value). */
async function gatewayCookie(host: string, s: Session): Promise<string> {
  const a = await authorizeReq(host, s, '/reports?x=1')
  expect(a.status).toBe(303)
  const handshake = new URL(a.headers.get('location')!)
  expect(handshake.hostname).toBe(host)
  const h = await gateReq(host, handshake.pathname + handshake.search)
  expect(h.status).toBe(302)
  expect(h.headers.get('location')).toBe(`http://${SITE_HOST}:8080/reports?x=1`)
  const setCookie = h.headers.get('set-cookie')!
  expect(setCookie).toMatch(/HttpOnly/)
  return setCookie.split(';')[0]!
}

let siteId: string
beforeEach(async () => {
  await resetDb()
  ;[dtd, erp, admin] = await Promise.all([login('dtd-user'), login('erp-user'), login('admin')])
  w = makeWorker()
  siteId = await createSite(dtd, 'sales')
  await deployLive(w.ctx, dtd, siteId)
  clearGateCache()
})

describe('private website gateway — production sites', () => {
  it('anonymous requests never get content: every asset redirects to corporate sign-in', async () => {
    for (const uri of ['/', '/index.html', '/style.css', '/img/logo.png', '/data.json', '/report.csv']) {
      const r = await gateReq(SITE_HOST, uri)
      expect(r.status, uri).toBe(302)
      expect(r.headers.get('location')).toMatch(/^http:\/\/localhost:3000\/api\/gateway\/authorize\?host=dtd-sales\.sites\.localhost/)
    }
  })

  it('authorize endpoint sends unauthenticated users to SSO login', async () => {
    const r = await authorizeReq(SITE_HOST)
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toMatch(/\/login\?returnTo=/)
  })

  it('department member gets access to all assets after the handshake', async () => {
    const cookie = await gatewayCookie(SITE_HOST, dtd)
    for (const uri of ['/', '/style.css', '/img/logo.png']) expect((await gateReq(SITE_HOST, uri, cookie)).status).toBe(200)
  })

  it('other departments are denied (no cookie is ever issued)', async () => {
    const r = await authorizeReq(SITE_HOST, erp)
    expect(r.status).toBe(403)
    expect(await getDb().auditLog.count({ where: { action: 'GATEWAY_DENIED' } })).toBe(1)
  })

  it('ADMIN can view any department website', async () => {
    const cookie = await gatewayCookie(SITE_HOST, admin)
    expect((await gateReq(SITE_HOST, '/', cookie)).status).toBe(200)
  })

  it('a gateway cookie is bound to its host (no cross-department replay)', async () => {
    await createSite(erp, 'inventory')
    const cookie = await gatewayCookie(SITE_HOST, dtd)
    const r = await gateReq('erp-inventory.sites.localhost', '/', cookie)
    expect(r.status).not.toBe(200)
  })

  it('the management session cookie is not accepted on hosted origins', async () => {
    const r = await gateReq(SITE_HOST, '/', dtd.cookie)
    expect(r.status).toBe(302)
  })

  it('revoked sessions and membership changes take effect (fail closed)', async () => {
    const cookie = await gatewayCookie(SITE_HOST, dtd)
    await getDb().session.deleteMany({ where: { id: sha256Hex(dtd.cookie.split('=')[1]!) } })
    clearGateCache()
    expect((await gateReq(SITE_HOST, '/', cookie)).status).toBe(302)

    const dtd2 = await login('dtd-user-2')
    const cookie2 = await gatewayCookie(SITE_HOST, dtd2)
    const erpDept = await getDb().department.findUniqueOrThrow({ where: { code: 'erp' } })
    await getDb().user.updateMany({ where: { id: dtd2.userId }, data: { departmentId: erpDept.id } })
    clearGateCache()
    expect((await gateReq(SITE_HOST, '/', cookie2)).status).toBe(403)
  })

  it('unknown hostnames do not expose anything', async () => {
    expect((await gateReq('nope-nothing.sites.localhost', '/')).status).toBe(404)
    expect((await gateReq('evil.example', '/')).status).toBe(404)
    expect((await authorizeReq('nope-nothing.sites.localhost', dtd)).status).toBe(404)
  })

  it('forged or expired handshake tokens are rejected', async () => {
    expect((await gateReq(SITE_HOST, '/__ds_auth?t=forged.token&r=/')).status).toBe(401)
  })

  it('a suspended website is not served even to its department', async () => {
    const cookie = await gatewayCookie(SITE_HOST, dtd)
    await getDb().website.update({ where: { id: siteId }, data: { suspendedAt: new Date() } })
    clearGateCache()
    expect((await gateReq(SITE_HOST, '/', cookie)).status).toBe(423)
  })

  it('health probe path requires the shared probe token', async () => {
    expect((await gateReq(SITE_HOST, '/__ds_health')).status).toBe(403)
    expect((await gateReq(SITE_HOST, '/__ds_health', undefined, { 'x-ds-probe': process.env.HEALTH_PROBE_TOKEN! })).status).toBe(200)
  })

  it('open-redirect attempts in the return path are neutralized', async () => {
    const a = await authorizeReq(SITE_HOST, dtd, '//evil.example/x')
    const h = await gateReq(SITE_HOST, new URL(a.headers.get('location')!).pathname + new URL(a.headers.get('location')!).search)
    expect(h.headers.get('location')).toBe(`http://${SITE_HOST}:8080/`)
  })
})

describe('private website gateway — previews', () => {
  it('preview requires the authorized launch handshake; anonymous and cross-department access fail', async () => {
    const v2 = await uploadAndBuild(w.ctx, dtd, siteId)
    const d = await getDb().deployment.findUniqueOrThrow({ where: { id: v2 } })
    const host = new URL(d.previewUrl!).hostname
    expect(host.endsWith('.preview.localhost')).toBe(true)

    expect((await gateReq(host, '/')).status).toBe(302) // anonymous
    expect((await openPreview(erp, v2)).status).toBe(404) // cross-department cannot obtain a launch URL
    expect((await authorizeReq(host, erp)).status).toBe(403) // nor via the authorize endpoint

    const launch = await openPreview(dtd, v2)
    expect(launch.status).toBe(200)
    const url = new URL(launch.json.preview.launchUrl)
    const h = await gateReq(host, url.pathname + url.search)
    expect(h.status).toBe(302)
    const cookie = h.headers.get('set-cookie')!
    expect(cookie).toMatch(/SameSite=None/)
    expect(cookie).toMatch(/Partitioned/)
    expect((await gateReq(host, '/style.css', cookie.split(';')[0]!)).status).toBe(200)
  })

  it('expired previews are not served', async () => {
    const v2 = await uploadAndBuild(w.ctx, dtd, siteId)
    const d = await getDb().deployment.update({ where: { id: v2 }, data: { previewExpiresAt: new Date(Date.now() - 1000) } })
    expect((await gateReq(new URL(d.previewUrl!).hostname, '/')).status).toBe(404)
  })
})
