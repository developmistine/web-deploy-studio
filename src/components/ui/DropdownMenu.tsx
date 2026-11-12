'use client'

import * as DM from '@radix-ui/react-dropdown-menu'
import type { ReactNode } from 'react'
import { MoreHorizontalIcon } from '@/components/ui/icons'

export type MenuAction = { key: string; label: string; icon?: ReactNode; danger?: boolean; onSelect: () => void }

/**
 * Compact three-dot row menu (Radix DropdownMenu): role="menu" semantics, arrow-key navigation, Escape/outside-click
 * close, rendered in a portal (never clipped by the table) and flipped/shifted to stay inside the viewport.
 * Callers pass only the actions the current administrator may perform; the server enforces the same rules.
 */
export function RowActionsMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  if (actions.length === 0) return null
  return (
    <DM.Root modal={false}>
      <DM.Trigger asChild>
        <button type="button" className="ds-btn ds-btn-ghost ds-btn-icon" aria-label={label}>
          <MoreHorizontalIcon />
        </button>
      </DM.Trigger>
      <DM.Portal>
        <DM.Content className="ds-popover ds-menu" align="end" sideOffset={6} collisionPadding={12}>
          {actions.map((a, i) => (
            <div key={a.key}>
              {a.danger && i > 0 ? <DM.Separator className="ds-menu-separator" /> : null}
              <DM.Item className={`ds-menu-item${a.danger ? ' danger' : ''}`} onSelect={a.onSelect}>
                {a.icon}
                <span>{a.label}</span>
              </DM.Item>
            </div>
          ))}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  )
}
