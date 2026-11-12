'use client'

type Props = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Accessible name, e.g. "สถานะบัญชี Somchai". */
  label: string
  disabled?: boolean
  /** Reason shown as a tooltip when disabled. */
  disabledReason?: string
  busy?: boolean
  /** Visible text next to the switch (e.g. ใช้งาน / ปิดใช้งาน). */
  stateText?: string
}

/** On/off switch (button role="switch", aria-checked) — keyboard: Space/Enter. */
export function Switch({ checked, onCheckedChange, label, disabled, disabledReason, busy, stateText }: Props) {
  return (
    <span className="ds-switch-wrap" title={disabled ? disabledReason : undefined}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-busy={busy || undefined}
        disabled={disabled || busy}
        className={`ds-switch${checked ? ' on' : ''}`}
        onClick={() => onCheckedChange(!checked)}
      >
        <span className="ds-switch-thumb" aria-hidden="true" />
      </button>
      {stateText ? (
        <span className="ds-switch-text" aria-hidden="true">
          {stateText}
        </span>
      ) : null}
    </span>
  )
}
