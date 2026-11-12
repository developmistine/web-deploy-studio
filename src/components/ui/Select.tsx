'use client'

import * as RS from '@radix-ui/react-select'
import { CheckIcon, ChevronDownIcon } from '@/components/ui/icons'

export type SelectOption = { value: string; label: string }

type Props = {
  value: string
  onValueChange: (value: string) => void
  options: SelectOption[]
  id?: string
  /** Required when there is no visible <label htmlFor>. */
  'aria-label'?: string
  disabled?: boolean
  placeholder?: string
}

/**
 * Accessible select (Radix): keyboard + typeahead, rounded trigger with chevron, brand focus ring, selected-item
 * check, popper positioning that flips and stays inside the viewport. Values are the backend identifiers
 * (e.g. ADMIN / USER); only the labels are translated.
 */
export function Select({ value, onValueChange, options, id, disabled, placeholder, ...aria }: Props) {
  return (
    <RS.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RS.Trigger id={id} className="ds-select-trigger" aria-label={aria['aria-label']}>
        <span className="ds-select-value">
          <RS.Value placeholder={placeholder} />
        </span>
        <RS.Icon className="ds-select-chevron">
          <ChevronDownIcon />
        </RS.Icon>
      </RS.Trigger>
      <RS.Portal>
        <RS.Content className="ds-popover ds-select-content" position="popper" sideOffset={6} collisionPadding={12}>
          <RS.Viewport className="ds-select-viewport">
            {options.map((o) => (
              <RS.Item key={o.value} value={o.value} className="ds-menu-item ds-select-item">
                <RS.ItemText>{o.label}</RS.ItemText>
                <RS.ItemIndicator className="ds-select-check">
                  <CheckIcon />
                </RS.ItemIndicator>
              </RS.Item>
            ))}
          </RS.Viewport>
        </RS.Content>
      </RS.Portal>
    </RS.Root>
  )
}
