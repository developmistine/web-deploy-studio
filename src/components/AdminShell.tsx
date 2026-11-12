'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'

export const SIDEBAR_KEY = 'deploy-studio-sidebar'
const SIDEBAR_EVENT = 'deploy-studio-sidebar'

// Collapsed state is a UI preference only (localStorage, like the theme) — never used for authorization.
const subscribe = (cb: () => void) => {
  window.addEventListener(SIDEBAR_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(SIDEBAR_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}
const readCollapsed = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'collapsed'
  } catch {
    return false
  }
}
function writeCollapsed(v: boolean) {
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? 'collapsed' : 'expanded')
  } catch {
    // storage unavailable — still dispatch so this page updates
  }
  window.dispatchEvent(new Event(SIDEBAR_EVENT))
}

type Item = { id: 'deploy' | 'enroll'; href: string; label: string; icon: ReactNode }

/** Lets the page header render the mobile/tablet menu button inside its own layout (no fixed overlay). */
type AdminNav = { open: () => void; expanded: boolean; registerOpener: (el: HTMLButtonElement | null) => void }
const AdminNavContext = createContext<AdminNav | null>(null)
export const useAdminNav = () => useContext(AdminNavContext)

const ITEMS: Item[] = [
  {
    id: 'deploy',
    href: '/',
    label: 'Deploy เว็บไซต์',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 17a5 5 0 0 1-1-9.7A7 7 0 0 1 18.4 9 4 4 0 0 1 19 17" />
        <path d="m8 15 4-4 4 4M12 11v10" />
      </svg>
    ),
  },
  {
    id: 'enroll',
    href: '/admin/users',
    label: 'จัดการบัญชีผู้ใช้งาน',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />
      </svg>
    ),
  },
]

/**
 * ADMIN layout: collapsible left sidebar (icon rail when collapsed) and an overlay drawer on small screens.
 * Rendered only for administrators; the pages and APIs behind each item enforce ADMIN on the server.
 */
export function AdminShell({ active, children }: { active: Item['id']; children: ReactNode }) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const firstLink = useRef<HTMLAnchorElement>(null)
  // The header's menu button registers itself (state, not a ref, so the context carries no refs into render).
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null)
  const nav = useMemo<AdminNav>(
    () => ({
      open: () => setDrawerOpen(true),
      expanded: drawerOpen,
      registerOpener: setOpener,
    }),
    [drawerOpen],
  )

  useEffect(() => {
    if (!drawerOpen) return
    firstLink.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDrawerOpen(false)
        opener?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen, opener])

  return (
    <div className={`admin-layout${collapsed ? ' collapsed' : ''}${drawerOpen ? ' drawer-open' : ''}`} data-testid="admin-layout">
      {drawerOpen ? <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" /> : null}

      <aside id="admin-sidebar" className="sidebar" aria-label="เมนูผู้ดูแลระบบ">
        <div className="sidebar-head">
          <span className="sidebar-title">ผู้ดูแลระบบ</span>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => (drawerOpen ? setDrawerOpen(false) : writeCollapsed(!collapsed))}
            aria-label={drawerOpen ? 'ปิดเมนู' : collapsed ? 'ขยายแถบเมนู' : 'ย่อแถบเมนู'}
            aria-expanded={drawerOpen || !collapsed}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {drawerOpen ? <path d="M6 6l12 12M18 6 6 18" /> : collapsed ? <path d="m9 6 6 6-6 6" /> : <path d="m15 6-6 6 6 6" />}
            </svg>
          </button>
        </div>
        <nav>
          <ul>
            {ITEMS.map((item, i) => (
              <li key={item.id}>
                <a
                  ref={i === 0 ? firstLink : undefined}
                  href={item.href}
                  className={`sidebar-link${active === item.id ? ' active' : ''}`}
                  aria-current={active === item.id ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                >
                  {item.icon}
                  <span className="sidebar-label">{item.label}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="admin-main">
        <AdminNavContext.Provider value={nav}>{children}</AdminNavContext.Provider>
      </div>
    </div>
  )
}
