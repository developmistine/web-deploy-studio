/** Client-safe DTOs returned by /api/v1. Never contain storage keys, image ids or internal errors. */

export const DEPLOYMENT_STATUSES = [
  'DRAFT',
  'UPLOADED',
  'VALIDATING',
  'BUILDING',
  'PREVIEW_READY',
  'DEPLOYING',
  'LIVE',
  'FAILED',
  'ROLLED_BACK',
] as const
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number]
export type Role = 'ADMIN' | 'USER'

export type DepartmentDTO = { id: string; code: string; name: string }

/** Heuristic suspicious-script finding (high = blocked, medium = review before deploying). */
export type ContentFindingDTO = { severity: 'high' | 'medium'; rule: string; path: string; line: number; message: string }

export type DeploymentDTO = {
  id: string
  websiteId: string
  version: number
  status: DeploymentStatus
  isActive: boolean
  /** True when an isolated preview is currently running and can be opened. */
  previewAvailable: boolean
  previewViewed: boolean
  uploadedBy: string
  originalFilename: string
  fileCount: number | null
  sizeBytes: number | null
  errorCode: string | null
  errorMessage: string | null
  contentFindings: ContentFindingDTO[]
  activeJob: { type: 'BUILD' | 'PROMOTE' | 'ROLLBACK'; status: 'QUEUED' | 'RUNNING' } | null
  createdAt: string
  updatedAt: string
  deployedAt: string | null
}

export type WebsiteDTO = {
  id: string
  department: DepartmentDTO
  siteName: string
  /** Logical name shown in the UI, e.g. "dtd.sales-dashboard". */
  logicalName: string
  hostname: string
  url: string
  activeDeployment: DeploymentDTO | null
  latestDeployment: DeploymentDTO | null
  productionChangeInProgress: boolean
  createdAt: string
  updatedAt: string
}

export type MeDTO = {
  user: { displayName: string; email: string; role: Role; department: DepartmentDTO | null }
  csrfToken: string
  /** FULL, or PASSWORD_CHANGE when the user must set a new password before doing anything else. */
  stage?: 'FULL' | 'PASSWORD_CHANGE'
}

export type UserStatus = 'INVITED' | 'ACTIVE' | 'DISABLED' | 'REVOKED'

/** Enrollment row for administrators. Never contains password hashes or link tokens. */
export type UserAdminDTO = {
  id: string
  displayName: string
  email: string
  department: DepartmentDTO | null
  role: Role
  status: UserStatus
  passwordSet: boolean
  resetRequested: boolean
  lastLoginAt: string | null
  createdAt: string
}

export type UserListDTO = {
  users: UserAdminDTO[]
  total: number
  page: number
  pageSize: number
  departments: DepartmentDTO[]
  /** Lets the UI hide actions the server would refuse for the last active admin (the server still enforces it). */
  activeAdminCount: number
}

/** One-time password link, shown to the admin exactly once. */
export type PasswordLinkDTO = { url: string; expiresAt: string }

export type DeploymentLogDTO = { id: string; level: string; message: string; createdAt: string }

export type AuditLogDTO = {
  id: string
  action: string
  actor: string | null
  departmentCode: string | null
  websiteId: string | null
  deploymentId: string | null
  createdAt: string
}

export type ApiErrorBody = { error: { code: string; message: string; details?: Record<string, unknown> } }

export const TERMINAL_STATUSES: readonly DeploymentStatus[] = ['PREVIEW_READY', 'LIVE', 'FAILED', 'ROLLED_BACK']
