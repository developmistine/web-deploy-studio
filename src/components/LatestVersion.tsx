'use client'

import { useState } from 'react'
import type { WebsiteDTO } from '@/lib/types'
import { ApiError, type ApiClient } from '@/lib/api-client'
import { formatBytes } from '@/lib/format'
import { LocalTime } from '@/components/LocalTime'

const IN_PROGRESS = new Set(['DRAFT', 'UPLOADED', 'VALIDATING', 'BUILDING', 'DEPLOYING'])

/**
 * My department (USER): only the latest version — no history list, no status badges. A Preview button when the
 * version can be previewed; the specific reason when it failed. (Admins keep the full history with rollback.)
 */
export function LatestVersion({ api, website }: { api: ApiClient; website: WebsiteDTO }) {
  const d = website.latestDeployment
  const [message, setMessage] = useState('')
  const [opening, setOpening] = useState(false)
  if (!d) return null

  async function openPreview(id: string) {
    setOpening(true)
    setMessage('')
    try {
      const { preview } = await api.openPreview(id)
      if (preview.status === 'READY') window.open(preview.launchUrl, '_blank', 'noopener,noreferrer')
      else setMessage('กำลังเปิดหน้าตัวอย่างใหม่ กรุณากดอีกครั้งในอีกสักครู่')
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'เปิดหน้าตัวอย่างไม่สำเร็จ')
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="section-gap" data-testid="latest-version">
      <h3 className="section-head">เวอร์ชันล่าสุด</h3>
      <div className="records">
        <article className="record">
          <div className="record-body">
            <div className="record-title">v{d.version}</div>
            <div className="meta">
              {d.uploadedBy} · <LocalTime iso={d.createdAt} /> · {d.originalFilename}
              {d.fileCount != null ? ` · ${d.fileCount} files` : ''}
              {d.sizeBytes != null ? ` · ${formatBytes(d.sizeBytes)}` : ''}
            </div>
            {d.status === 'FAILED' && d.errorMessage ? (
              <p className="message" role="alert">
                ไม่ผ่าน: {d.errorMessage}
              </p>
            ) : null}
            {IN_PROGRESS.has(d.status) ? <p className="meta">กำลังดำเนินการ…</p> : null}
          </div>
          {d.status === 'PREVIEW_READY' ? (
            <div className="record-actions">
              <button type="button" className="sketch mini" disabled={opening} onClick={() => void openPreview(d.id)}>
                Preview
              </button>
            </div>
          ) : null}
        </article>
      </div>
      {message ? (
        <p className="message" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  )
}
