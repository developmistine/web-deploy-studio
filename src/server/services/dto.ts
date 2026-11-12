import type { Department, Deployment, DeploymentJob, Prisma, User, Website } from '@/generated/prisma/client'
import type { ContentFindingDTO, DeploymentDTO, WebsiteDTO } from '@/lib/types'
import { errorMessageFor } from '@/lib/status-labels'
import { logicalName, siteUrl } from '@/server/deployments/hostnames'

export type DeploymentRow = Deployment & { uploadedBy: Pick<User, 'displayName'>; jobs?: DeploymentJob[] }

/** Defensive read of the worker-written JSON column: only well-formed findings, bounded strings. */
function findingsFrom(raw: Prisma.JsonValue | null): ContentFindingDTO[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 50).flatMap((f) => {
    if (!f || typeof f !== 'object' || Array.isArray(f)) return []
    const o = f as Record<string, unknown>
    if ((o.severity !== 'high' && o.severity !== 'medium') || typeof o.rule !== 'string' || typeof o.path !== 'string' || typeof o.message !== 'string') return []
    return [{ severity: o.severity, rule: o.rule.slice(0, 64), path: o.path.slice(0, 300), line: Number(o.line) || 0, message: o.message.slice(0, 300) }]
  })
}

export function toDeploymentDTO(d: DeploymentRow, activeDeploymentId: string | null): DeploymentDTO {
  const active = d.jobs?.find((j) => j.status === 'QUEUED' || j.status === 'RUNNING')
  return {
    id: d.id,
    websiteId: d.websiteId,
    version: d.version,
    status: d.status,
    isActive: d.id === activeDeploymentId,
    previewAvailable: d.status === 'PREVIEW_READY' && !!d.previewUrl && !!d.previewExpiresAt && d.previewExpiresAt.getTime() > Date.now(),
    previewViewed: !!d.previewViewedAt,
    uploadedBy: d.uploadedBy.displayName,
    originalFilename: d.originalFilename,
    fileCount: d.fileCount,
    sizeBytes: d.sourceSizeBytes,
    errorCode: d.errorCode,
    errorMessage: errorMessageFor(d.errorCode),
    contentFindings: findingsFrom(d.contentFindings),
    activeJob: active ? { type: active.jobType, status: active.status as 'QUEUED' | 'RUNNING' } : null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    deployedAt: d.deployedAt?.toISOString() ?? null,
  }
}

export type WebsiteRow = Website & {
  department: Department
  activeDeployment: DeploymentRow | null
  deployments: DeploymentRow[] // latest first, take 1
  jobs: Pick<DeploymentJob, 'status' | 'jobType'>[]
}

export function toWebsiteDTO(w: WebsiteRow): WebsiteDTO {
  const latest = w.deployments[0] ?? null
  return {
    id: w.id,
    department: { id: w.department.id, code: w.department.code, name: w.department.name },
    siteName: w.siteName,
    logicalName: logicalName(w.department.code, w.siteName),
    hostname: w.hostname,
    url: siteUrl(w.hostname),
    activeDeployment: w.activeDeployment ? toDeploymentDTO(w.activeDeployment, w.activeDeploymentId) : null,
    latestDeployment: latest ? toDeploymentDTO(latest, w.activeDeploymentId) : null,
    productionChangeInProgress: w.jobs.some((j) => j.jobType !== 'BUILD' && (j.status === 'QUEUED' || j.status === 'RUNNING')),
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  }
}

export const deploymentInclude = {
  uploadedBy: { select: { displayName: true } },
  jobs: { where: { status: { in: ['QUEUED', 'RUNNING'] } }, orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.DeploymentInclude

export const websiteInclude = {
  department: true,
  activeDeployment: { include: deploymentInclude },
  deployments: { orderBy: { version: 'desc' }, take: 1, include: deploymentInclude },
  jobs: { where: { status: { in: ['QUEUED', 'RUNNING'] } }, select: { status: true, jobType: true } },
} satisfies Prisma.WebsiteInclude
