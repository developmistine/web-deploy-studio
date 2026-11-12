import type { DeploymentStatus } from '@/lib/types'
import { STATUS_LABEL, STATUS_TONE } from '@/lib/status-labels'

type PillProps = { text: string; tone?: '' | 'ready' | 'error'; variant?: 'status' | 'pill' }

/** The prototype's `.status` / `.pill` badge. */
export function DeploymentStatusPill({ text, tone = '', variant = 'pill' }: PillProps) {
  return (
    <span className={`${variant}${tone ? ` ${tone}` : ''}`} role={variant === 'status' ? 'status' : undefined}>
      {text}
    </span>
  )
}

export function DeploymentStatus({ status }: { status: DeploymentStatus }) {
  return <DeploymentStatusPill text={STATUS_LABEL[status]} tone={STATUS_TONE[status]} />
}
