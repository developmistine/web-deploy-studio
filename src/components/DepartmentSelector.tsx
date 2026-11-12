'use client'

import type { DepartmentDTO } from '@/lib/types'

type Props = {
  departments: DepartmentDTO[]
  value: string
  onChange: (label: string) => void
  /**
   * USER accounts: prefilled from the server-resolved membership and locked.
   * The typed value is never evidence of membership — the server checks it against the session.
   */
  locked: boolean
}

/** Free-text department field (departments are dynamic). ADMIN gets suggestions of existing departments. */
export function DepartmentSelector({ departments, value, onChange, locked }: Props) {
  return (
    <label className="field">
      Department
      <input
        id="department"
        className="text-ui"
        value={value}
        maxLength={100}
        list={locked ? undefined : 'department-options'}
        spellCheck={false}
        autoComplete="off"
        placeholder="e.g. DTD"
        disabled={locked}
        onChange={(e) => onChange(e.target.value)}
      />
      {!locked ? (
        <datalist id="department-options">
          {departments.map((d) => (
            <option key={d.id} value={d.name} />
          ))}
        </datalist>
      ) : null}
    </label>
  )
}
