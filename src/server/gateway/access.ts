import type { Db } from '@/server/db'
import type { Actor } from '@/server/auth/session'
import { getConfig } from '@/server/config'
import { canAccessDepartment } from '@/server/authz/policy'
import { urlForHost } from '@/server/deployments/hostnames'
import { HANDSHAKE_PATH, HANDSHAKE_SECONDS, signGatewayToken } from '@/server/gateway/tokens'

export type HostTarget =
  | { kind: 'site'; host: string; departmentId: string; websiteId: string; deploymentId: string | null; suspended: boolean; live: boolean }
  | { kind: 'preview'; host: string; departmentId: string; websiteId: string; deploymentId: string; suspended: boolean; live: boolean }

const HOST_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/

export function normalizeHost(raw: string | null | undefined): string | null {
  const h = (raw ?? '').split(':')[0]!.trim().toLowerCase()
  return HOST_RE.test(h) && h.length <= 253 ? h : null
}

/**
 * Maps an approved hostname to the department resource it serves. Unknown hosts → null (deny).
 * Hostnames come only from DB records created through Deploy Studio — never from the request.
 */
export async function resolveHostTarget(db: Db, host: string): Promise<HostTarget | null> {
  const cfg = getConfig()
  const sitesBase = new URL(cfg.SITES_BASE_URL).hostname
  const previewBase = new URL(cfg.PREVIEW_BASE_URL).hostname

  if (host.endsWith(`.${previewBase}`)) {
    const d = await db.deployment.findFirst({
      where: { previewUrl: urlForHost(host, cfg.PREVIEW_BASE_URL) },
      include: { website: true },
    })
    if (!d) return null
    const live = !d.quarantinedAt && !!d.previewExpiresAt && d.previewExpiresAt.getTime() > Date.now() && d.status !== 'FAILED'
    return { kind: 'preview', host, departmentId: d.website.departmentId, websiteId: d.websiteId, deploymentId: d.id, suspended: !!d.website.suspendedAt, live }
  }
  if (host.endsWith(`.${sitesBase}`)) {
    const w = await db.website.findUnique({ where: { hostname: host }, include: { activeDeployment: { select: { quarantinedAt: true } } } })
    if (!w) return null
    const live = !!w.activeDeploymentId && !w.activeDeployment?.quarantinedAt
    return { kind: 'site', host, departmentId: w.departmentId, websiteId: w.id, deploymentId: w.activeDeploymentId, suspended: !!w.suspendedAt, live }
  }
  return null
}

export function canViewHost(actor: Actor, target: HostTarget): boolean {
  return canAccessDepartment(actor, target.departmentId)
}

export function originFor(target: HostTarget): string {
  const cfg = getConfig()
  return urlForHost(target.host, target.kind === 'site' ? cfg.SITES_BASE_URL : cfg.PREVIEW_BASE_URL)
}

/** Builds the handshake URL on the hosted-content origin for an already-authorized session. */
export function handshakeUrl(target: HostTarget, sessionId: string, userId: string, returnPath = '/'): string {
  const cfg = getConfig()
  const token = signGatewayToken(cfg.GATEWAY_SIGNING_SECRET, {
    t: 'h',
    h: target.host,
    sid: sessionId,
    u: userId,
    exp: Math.floor(Date.now() / 1000) + HANDSHAKE_SECONDS,
  })
  const url = new URL(HANDSHAKE_PATH, originFor(target))
  url.searchParams.set('t', token)
  url.searchParams.set('r', returnPath)
  return url.toString()
}
