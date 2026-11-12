'use client'

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  /** Shows a spinner, sets aria-busy and blocks repeated clicks. */
  loading?: boolean
  icon?: ReactNode
  size?: 'md' | 'icon'
}

/**
 * Shared button. Primary (brand #EF348C) and secondary share height, radius and padding so paired actions
 * (ยกเลิก / บันทึก) are balanced; hierarchy comes from colour, not size.
 */
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', loading = false, icon, size = 'md', className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`ds-btn ds-btn-${variant}${size === 'icon' ? ' ds-btn-icon' : ''}${className ? ` ${className}` : ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="ds-spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  )
})
