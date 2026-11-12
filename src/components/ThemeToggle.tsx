'use client'

import { useState } from 'react'

export const THEME_KEY = 'deploy-studio-theme'
type Theme = 'light' | 'dark'

/** Same behaviour as the prototype: theme in localStorage (the only thing localStorage is used for). */
export function ThemeToggle() {
  // The inline init script already applied the saved theme to <html> before hydration; read it once.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  )

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // storage unavailable (private mode) — theme still applies for this page view
    }
    setTheme(next)
  }

  return (
    <div className="theme-switch">
      {/* Icon follows the theme on <html> via CSS (sun = light, moon = dark): correct before hydration too. */}
      <svg className="icon-sun" data-testid="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
      </svg>
      <svg className="icon-moon" data-testid="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a6.6 6.6 0 0 0 10.7 10.7Z" />
      </svg>
      <button type="button" className="sketch theme-button" onClick={toggle} aria-label="Toggle color theme" suppressHydrationWarning>
        {theme === 'dark' ? 'Light' : 'Dark'}
      </button>
    </div>
  )
}

/** Inline, nonce'd script that applies the saved theme before first paint (no flash). */
export const themeInitScript = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');document.documentElement.dataset.theme=t==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})()`
