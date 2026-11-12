'use client'

import type { ApiErrorBody, DepartmentDTO, DeploymentDTO, DeploymentLogDTO, PasswordLinkDTO, UserAdminDTO, UserListDTO, WebsiteDTO } from '@/lib/types'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

/** Browser API client. Sends the session-bound CSRF token on every mutating request. */
export class ApiClient {
  constructor(private readonly csrfToken: string) {}

  private async request<T>(method: string, path: string, body?: BodyInit | object, headers: Record<string, string> = {}): Promise<T> {
    const init: RequestInit = { method, credentials: 'same-origin', headers: { ...headers }, cache: 'no-store' }
    if (method !== 'GET') (init.headers as Record<string, string>)['x-csrf-token'] = this.csrfToken
    if (body instanceof FormData) init.body = body
    else if (body !== undefined) {
      ;(init.headers as Record<string, string>)['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    const res = await fetch(path, init)
    const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null
    if (!res.ok) {
      const err = data?.error
      throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? 'Something went wrong. Please try again later.', err?.details)
    }
    return data as T
  }

  departments = () => this.request<{ departments: DepartmentDTO[] }>('GET', '/api/v1/departments')
  websites = (department?: string) =>
    this.request<{ websites: WebsiteDTO[] }>('GET', `/api/v1/websites${department ? `?department=${encodeURIComponent(department)}` : ''}`)
  createWebsite = (input: { department?: string; siteName: string }) => this.request<{ website: WebsiteDTO }>('POST', '/api/v1/websites', input)
  renameWebsite = (id: string, siteName: string) => this.request<{ website: WebsiteDTO }>('PATCH', `/api/v1/websites/${id}`, { siteName })
  uploadDeployment = (websiteId: string, form: FormData, idempotencyKey: string) =>
    this.request<{ deployment: DeploymentDTO }>('POST', `/api/v1/websites/${websiteId}/deployments`, form, { 'idempotency-key': idempotencyKey })
  deployments = (websiteId: string) => this.request<{ deployments: DeploymentDTO[] }>('GET', `/api/v1/websites/${websiteId}/deployments`)
  deployment = (id: string) => this.request<{ deployment: DeploymentDTO }>('GET', `/api/v1/deployments/${id}`)
  openPreview = (id: string) =>
    this.request<{ preview: { status: 'READY'; launchUrl: string; expiresAt: string } | { status: 'RESTARTING' } }>('POST', `/api/v1/deployments/${id}/preview`, {})
  promote = (id: string) => this.request<{ deployment: DeploymentDTO }>('POST', `/api/v1/deployments/${id}/promote`, {})
  logs = (id: string) => this.request<{ logs: DeploymentLogDTO[] }>('GET', `/api/v1/deployments/${id}/logs`)
  rollback = (websiteId: string, targetDeploymentId?: string) =>
    this.request<{ deployment: DeploymentDTO }>('POST', `/api/v1/websites/${websiteId}/rollback`, targetDeploymentId ? { targetDeploymentId } : {})
  logout = () => this.request<{ redirectTo: string }>('POST', '/api/v1/auth/logout', {})
  reauth = (password: string) => this.request<{ ok: true }>('POST', '/api/v1/auth/reauth', { password })
  changePassword = (currentPassword: string, newPassword: string) =>
    this.request<{ csrfToken: string }>('POST', '/api/v1/auth/change-password', { currentPassword, newPassword })

  // ---- admin enrollment (server enforces ADMIN + recent re-authentication)
  listUsers = (query: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)]))
    return this.request<UserListDTO>('GET', `/api/v1/admin/users${qs.size ? `?${qs}` : ''}`)
  }
  createUser = (input: { displayName: string; email: string; department?: string; role: 'ADMIN' | 'USER' }) =>
    this.request<{ user: UserAdminDTO; setupLink: PasswordLinkDTO }>('POST', '/api/v1/admin/users', input)
  updateUser = (id: string, input: { displayName?: string; department?: string | null; role?: 'ADMIN' | 'USER'; status?: 'ACTIVE' | 'DISABLED' }) =>
    this.request<{ user: UserAdminDTO }>('PATCH', `/api/v1/admin/users/${id}`, input)
  resetUserPassword = (id: string) => this.request<{ resetLink: PasswordLinkDTO }>('POST', `/api/v1/admin/users/${id}/reset-password`, {})
  revokeUser = (id: string) => this.request<{ user: UserAdminDTO }>('POST', `/api/v1/admin/users/${id}/revoke`, {})
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

/** For the pages used before sign-in (login, password link, forgot password): JSON POST without a session. */
export async function postPublic<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiErrorBody>) | null
  if (!res.ok) {
    const err = data?.error
    throw new ApiError(res.status, err?.code ?? 'INTERNAL', err?.message ?? 'Something went wrong. Please try again later.', err?.details)
  }
  return data as T
}

/** Thai explanations for server password-policy problems (the server decides; this is only wording). */
export function passwordProblemText(problems: unknown, minLength: unknown): string {
  const list = Array.isArray(problems) ? problems : []
  const text: Record<string, string> = {
    TOO_SHORT: `ต้องยาวอย่างน้อย ${typeof minLength === 'number' ? minLength : 8} ตัวอักษร`,
    NEEDS_LETTER: 'ต้องมีตัวอักษรอย่างน้อย 1 ตัว',
    NEEDS_DIGIT: 'ต้องมีตัวเลขอย่างน้อย 1 ตัว',
    TOO_LONG: 'ยาวเกิน 128 ตัวอักษร',
    COMMON: 'เป็นรหัสผ่านหรือคำที่ใช้กันบ่อย เดาง่าย',
    REPETITIVE: 'มีตัวอักษรซ้ำหรือเรียงกันเกินไป',
    PERSONAL_INFO: 'มีชื่อหรืออีเมลของคุณอยู่ในรหัสผ่าน',
  }
  return list.map((p) => text[String(p)] ?? String(p)).join(' · ')
}
