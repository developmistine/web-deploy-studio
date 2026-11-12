'use client'

import * as RD from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { CloseIcon } from '@/components/ui/icons'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  children?: ReactNode
  /** Footer actions (right-aligned, separated from the form). */
  footer?: ReactNode
  /** Prevent closing while a request is in flight. */
  busy?: boolean
}

/** Modal dialog (Radix): focus trap, Escape / outside click to close, labelled by its title, scrollable body. */
export function Dialog({ open, onOpenChange, title, description, children, footer, busy }: Props) {
  return (
    <RD.Root open={open} onOpenChange={(o) => (!busy || o ? onOpenChange(o) : undefined)}>
      <RD.Portal>
        <RD.Overlay className="ds-dialog-overlay" />
        <RD.Content className="ds-dialog">
          <div className="ds-dialog-head">
            <RD.Title className="ds-dialog-title">{title}</RD.Title>
            <RD.Close asChild>
              <button type="button" className="ds-dialog-close" aria-label="ปิด" disabled={busy}>
                <CloseIcon />
              </button>
            </RD.Close>
          </div>
          {description ? <RD.Description className="ds-dialog-desc">{description}</RD.Description> : <RD.Description className="sr-only">{title}</RD.Description>}
          <div className="ds-dialog-body">{children}</div>
          {footer ? <div className="ds-dialog-footer">{footer}</div> : null}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}
