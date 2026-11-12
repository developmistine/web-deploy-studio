'use client'

import { useCallback, useEffect, useState } from 'react'
import type { DeploymentDTO, DeploymentLogDTO, WebsiteDTO } from '@/lib/types'
import { ApiError, type ApiClient } from '@/lib/api-client'
import { DeploymentStatus, DeploymentStatusPill } from '@/components/DeploymentStatus'
import { LocalTime } from '@/components/LocalTime'
import { formatBytes } from '@/lib/format'

type Props = {
  api: ApiClient
  website: WebsiteDTO
  /** Called after a rollback request so the parent can refresh website state. */
  onChanged: () => void
  refreshKey?: number
}

/** Immutable revision history of a department website, with logs, preview and rollback (no delete). */
export function DeploymentHistory({ api, website, onChanged, refreshKey }: Props) {
  const [items, setItems] = useState<DeploymentDTO[] | null>(null)
  const [logs, setLogs] = useState<Record<string, DeploymentLogDTO[]>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setItems((await api.deployments(website.id)).deployments)
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Could not load history.')
    }
  }, [api, website.id])

  useEffect(() => {
    let cancelled = false
    api
      .deployments(website.id)
      .then((r) => {
        if (!cancelled) setItems(r.deployments)
      })
      .catch((e: unknown) => {
        if (!cancelled) setMessage(e instanceof ApiError ? e.message : 'Could not load history.')
      })
    return () => {
      cancelled = true
    }
  }, [api, website.id, refreshKey])

  // Keep polling while anything is in flight.
  useEffect(() => {
    const inFlight = items?.some((d) => d.activeJob || ['UPLOADED', 'VALIDATING', 'BUILDING', 'DEPLOYING'].includes(d.status))
    if (!inFlight && !website.productionChangeInProgress) return
    const t = setInterval(() => {
      void load()
      onChanged()
    }, 3000)
    return () => clearInterval(t)
  }, [items, load, onChanged, website.productionChangeInProgress])

  async function toggleLogs(id: string) {
    if (open === id) return setOpen(null)
    setOpen(id)
    try {
      const res = await api.logs(id)
      setLogs((l) => ({ ...l, [id]: res.logs }))
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Could not load logs.')
    }
  }

  async function openPreview(id: string) {
    setMessage('')
    try {
      const { preview } = await api.openPreview(id)
      if (preview.status === 'READY') window.open(preview.launchUrl, '_blank', 'noopener,noreferrer')
      else setMessage('Preview is restarting. Try again in a moment.')
      void load()
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Could not open preview.')
    }
  }

  async function rollbackTo(d: DeploymentDTO) {
    if (!window.confirm(`Roll back ${website.logicalName} to version ${d.version}? Production traffic switches after readiness checks.`)) return
    setBusy(true)
    setMessage('')
    try {
      await api.rollback(website.id, d.id)
      await load()
      onChanged()
    } catch (e) {
      setMessage(e instanceof ApiError ? e.message : 'Rollback request failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="section-gap" aria-label="Deployment history">
      <div className="deployment-header">
        <div>
          <h3 className="section-head">Version history</h3>
          <p className="subtle">ทุกเวอร์ชันถูกเก็บไว้แบบ immutable · Rollback ได้ไปยังเวอร์ชันที่เคย Live</p>
        </div>
      </div>
      <p className="message" role="alert">
        {message}
      </p>
      <div className="records">
        {items === null ? (
          <div className="empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="empty">ยังไม่มีเวอร์ชันสำหรับเว็บไซต์นี้</div>
        ) : (
          items.map((d) => {
            const canRollback = (d.status === 'LIVE' || d.status === 'ROLLED_BACK') && !d.isActive && !website.productionChangeInProgress
            return (
              <article key={d.id} className="record" data-testid="deployment-row">
                <div className="record-body">
                  <div className="record-title">
                    <span>v{d.version}</span>
                    <DeploymentStatus status={d.status} />
                    {d.isActive ? <DeploymentStatusPill text="Active" tone="" /> : null}
                    {d.activeJob ? <DeploymentStatusPill text={`${d.activeJob.type.toLowerCase()} ${d.activeJob.status.toLowerCase()}`} /> : null}
                  </div>
                  <div className="meta">
                    {d.uploadedBy} · <LocalTime iso={d.createdAt} /> · {d.originalFilename} · {d.fileCount ?? '—'} files · {formatBytes(d.sizeBytes)}
                    {d.errorMessage ? <span className="notice error"> · {d.errorMessage}</span> : null}
                  </div>
                  {open === d.id ? (
                    <div className="log-view" aria-label={`Logs for version ${d.version}`}>
                      {(logs[d.id] ?? []).map((l) => (
                        <div key={l.id} className={l.level}>
                          <LocalTime iso={l.createdAt} /> {l.message}
                        </div>
                      ))}
                      {(logs[d.id] ?? []).length === 0 ? <div>No log entries.</div> : null}
                    </div>
                  ) : null}
                </div>
                <div className="record-actions">
                  <button type="button" className="sketch mini" onClick={() => void toggleLogs(d.id)}>
                    {open === d.id ? 'Hide logs' : 'Logs'}
                  </button>
                  {d.status === 'PREVIEW_READY' ? (
                    <button type="button" className="sketch mini" onClick={() => void openPreview(d.id)}>
                      Preview
                    </button>
                  ) : null}
                  {canRollback ? (
                    <button type="button" className="sketch mini" disabled={busy} onClick={() => void rollbackTo(d)}>
                      Roll back to v{d.version}
                    </button>
                  ) : null}
                </div>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}
