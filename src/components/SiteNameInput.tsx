'use client'

type Props = {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** Called when editing finishes (Enter or leaving the field) — used to confirm renaming an existing website. */
  onCommit?: () => void
}

export function SiteNameInput({ value, onChange, disabled, onCommit }: Props) {
  return (
    <label className="field">
      Site name
      <input
        id="site-name"
        className="text-ui"
        value={value}
        maxLength={48}
        spellCheck={false}
        placeholder="e.g. sales-dashboard"
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        onBlur={() => onCommit?.()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onCommit?.()
          }
        }}
      />
    </label>
  )
}
