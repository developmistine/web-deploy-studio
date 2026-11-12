import type { UserStatus } from '@/lib/types'
import { ROLE_LABEL, STATUS_LABEL } from '@/lib/i18n/enrollment-th'

const STATUS_TONE: Record<UserStatus, string> = { ACTIVE: 'success', INVITED: 'warning', DISABLED: 'muted', REVOKED: 'danger' }

/** Compact account-status badge (Thai label; the enum value stays in a data attribute for tests/styling). */
export function StatusBadge({ status }: { status: UserStatus }) {
  return (
    <span className={`ds-badge ds-badge-${STATUS_TONE[status]}`} data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  )
}

export function RoleBadge({ role }: { role: 'ADMIN' | 'USER' }) {
  return (
    <span className={`ds-badge ${role === 'ADMIN' ? 'ds-badge-brand' : 'ds-badge-neutral'}`} data-role={role}>
      {ROLE_LABEL[role]}
    </span>
  )
}
