'use client'

import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react'

export const ACCEPT = '.zip,.html,.htm,.css,.js,.mjs,.json,.png,.jpg,.jpeg,.gif,.svg,.webp,.avif,.ico,.woff,.woff2,.ttf,.otf,.txt,.xml,.webmanifest,.map'

type Props = {
  onFiles: (files: File[]) => void
  disabled?: boolean
}

/** Prototype dropzone: click / Enter / Space / drag & drop, plus "Browse files". */
export function UploadDropzone({ onFiles, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [dragover, setDragover] = useState(false)

  const open = () => {
    if (!disabled) input.current?.click()
  }
  const onDrag = (e: DragEvent<HTMLDivElement>, over: boolean) => {
    e.preventDefault()
    if (!disabled) setDragover(over)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragover(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length) onFiles(files)
  }

  return (
    <div
      id="dropzone"
      className={`dropzone${dragover ? ' dragover' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Upload website files"
      aria-disabled={disabled || undefined}
      data-testid="dropzone"
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        if ((e.target as HTMLElement).closest('button')) return
        open()
      }}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          open()
        }
      }}
      onDragEnter={(e) => onDrag(e, true)}
      onDragOver={(e) => onDrag(e, true)}
      onDragLeave={(e) => onDrag(e, false)}
      onDrop={onDrop}
    >
      <div>
        <svg className="upload-icon" viewBox="0 0 24 24" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 17a5 5 0 0 1-1-9.7A7 7 0 0 1 18.4 9 4 4 0 0 1 19 17" />
          <path d="m8 15 4-4 4 4M12 11v10" />
        </svg>
        <h1>Drop your project here</h1>
        <p className="hint">Upload .zip, .html, .css, .js หรือ assets</p>
        <button
          type="button"
          className="sketch browse"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
        >
          Browse files
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length) onFiles(files)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
