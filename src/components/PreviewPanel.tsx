'use client'

import type { ReactNode } from 'react'

type Props = {
  visible: boolean
  /** Short-lived launch URL on the isolated preview origin (never the Deploy Studio origin). */
  src: string | null
  displayUrl: string
  heading: string
  onLoaded: () => void
  onRefresh: () => void
  /** Opens the file picker; choosing files starts a new upload + preview. */
  onChangeFile: () => void
  /** Rendered in place of the dropzone (no separator above). */
  inline?: boolean
  busy?: boolean
  children?: ReactNode
}

/**
 * Large preview window (75vh, min 650px — prototype CSS). The iframe points at a separate preview
 * origin served by an isolated container behind the proxy's forward-auth gate. Because that origin is
 * different from Deploy Studio's, `allow-same-origin` only grants the site its OWN origin (so sites
 * using storage/cookies behave like production) and cannot reach Deploy Studio's cookies or DOM.
 */
export function PreviewPanel({ visible, src, displayUrl, heading, onLoaded, onRefresh, onChangeFile, inline, busy, children }: Props) {
  return (
    <section id="preview-pane" className={`preview-pane${visible ? ' visible' : ''}${inline ? ' inline' : ''}`} aria-label="Website preview" hidden={!visible}>
      <div className="preview-head">
        <h2>{heading}</h2>
        <div className="preview-actions">
          <button type="button" className="sketch mini" onClick={onChangeFile} disabled={busy}>
            Change file
          </button>
          <button type="button" className="sketch mini" onClick={onRefresh} disabled={busy || !src}>
            Refresh preview
          </button>
        </div>
      </div>
      <div className="browser">
        <div className="browser-bar">
          <i className="dot" />
          <i className="dot" />
          <i className="dot" />
          <span className="browser-url">{displayUrl}</span>
        </div>
        {src ? (
          <iframe
            key={src}
            id="preview-frame"
            title="Website preview"
            src={src}
            // No allow-popups: window.open / target=_blank from unreviewed code would bypass the site CSP and send
            // data to any destination (verified 2026-11-11, R-24). Links still open normally after deployment.
            sandbox="allow-scripts allow-same-origin allow-forms"
            referrerPolicy="no-referrer"
            onLoad={onLoaded}
          />
        ) : (
          <iframe id="preview-frame" title="Website preview" sandbox="" />
        )}
      </div>
      {children}
    </section>
  )
}
