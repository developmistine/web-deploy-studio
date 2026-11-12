'use client'

/* eslint-disable @next/next/no-img-element -- small static brand assets with explicit intrinsic size */
import { ThemeToggle } from '@/components/ThemeToggle'
import { UserControls } from '@/components/UserControls'
import { useAdminNav } from '@/components/AdminShell'
import { MenuIcon } from '@/components/ui/icons'

/**
 * Dual branding: Deploy Studio product logo (left) and the corporate BW logo (centre), theme toggle (right).
 * A 3-column grid keeps the centre logo from ever overlapping the side content; both logos keep their intrinsic
 * aspect ratio (w-auto + object-contain) with explicit max sizes per breakpoint and stay visible on mobile.
 * For administrators below 900px the navigation-drawer button sits in the header (no fixed overlay).
 * `showProduct={false}` is used where the product logo is already shown (sign-in card) to avoid duplication.
 */
export function BrandHeader({ showProduct = true, user }: { showProduct?: boolean; user?: { label: string; csrfToken: string } }) {
  const nav = useAdminNav()
  return (
    <header className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-4 min-h-14 mb-4 md:mb-6" data-testid="brand-header">
      <div className="flex items-center gap-2 min-w-0">
        {nav ? <NavButton open={nav.open} expanded={nav.expanded} register={nav.registerOpener} /> : null}
        {showProduct ? (
          <img
            src="/brand/deploy-studio.png"
            alt="Deploy Studio"
            width={900}
            height={337}
            className="block w-auto h-9 max-w-[38vw] sm:h-12 lg:h-16 2xl:h-[76px] sm:max-w-[240px] object-contain object-left shrink"
          />
        ) : null}
      </div>
      <img
        src="/brand/bw-logo-pink.svg"
        alt="BW"
        width={404}
        height={200}
        className="block w-auto h-8 max-w-[22vw] sm:h-11 lg:h-14 2xl:h-16 sm:max-w-[150px] object-contain justify-self-center"
      />
      <div className="justify-self-end min-w-0">{user ? <UserControls csrfToken={user.csrfToken} label={user.label} /> : <ThemeToggle />}</div>
    </header>
  )
}

/** Menu button for the admin drawer (< 900px). Registers its element so focus returns to it on Escape. */
function NavButton({ open, expanded, register }: { open: () => void; expanded: boolean; register: (el: HTMLButtonElement | null) => void }) {
  return (
    <button ref={register} type="button" className="ds-nav-toggle" aria-label="เปิดเมนู" aria-expanded={expanded} aria-controls="admin-sidebar" onClick={open}>
      <MenuIcon />
    </button>
  )
}
