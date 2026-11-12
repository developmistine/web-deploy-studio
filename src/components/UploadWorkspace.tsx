'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DepartmentDTO, DeploymentDTO, WebsiteDTO } from '@/lib/types'
import { ApiError, newIdempotencyKey, type ApiClient } from '@/lib/api-client'
import { isValidSiteName, normalizeDepartmentCode } from '@/lib/validation'
import { STATUS_LABEL } from '@/lib/status-labels'
import { DepartmentSelector } from '@/components/DepartmentSelector'
import { SiteNameInput } from '@/components/SiteNameInput'
import { ACCEPT, UploadDropzone } from '@/components/UploadDropzone'
import { PreviewPanel } from '@/components/PreviewPanel'
import { DeployButton } from '@/components/DeployButton'
import { ContentFindings } from '@/components/ContentFindings'
import { ReauthDialog } from '@/components/ReauthDialog'
import { uploadApiErrorTh } from '@/lib/i18n/upload-th'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'

type Phase = 'idle' | 'uploading' | 'processing' | 'preview' | 'deploying' | 'live' | 'error'

type Props = {
  api: ApiClient
  departments: DepartmentDTO[]
  websites: WebsiteDTO[]
  isAdmin: boolean
  /** USER: their department label (locked). ADMIN: initial suggestion. Empty when unassigned. */
  defaultDepartment: string
  sitesHost: string
  onWebsitesChanged: () => Promise<void> | void
  pollMs?: number
}

const IN_PROGRESS = new Set(['DRAFT', 'UPLOADED', 'VALIDATING', 'BUILDING'])

/**
 * "New deploy / Update website" workspace. Dropping files starts the upload immediately; the dropzone is
 * replaced by progress and then by the preview (built server-side, served from an isolated origin), with a
 * "Change file" button to pick other files. Deploy only enables once that preview is ready and loaded.
 */
export function UploadWorkspace({ api, departments, websites, isAdmin, defaultDepartment, sitesHost, onWebsitesChanged, pollMs = 2000 }: Props) {
  const [departmentLabel, setDepartmentLabel] = useState(defaultDepartment)
  const deptCode = normalizeDepartmentCode(departmentLabel)
  const website = websites.find((w) => w.department.code === deptCode) ?? null
  const department = deptCode ? { code: deptCode, name: departments.find((d) => d.code === deptCode)?.name ?? departmentLabel.trim() } : null
  const unassigned = !isAdmin && !defaultDepartment
  const [siteNameDraft, setSiteNameDraft] = useState('my-dashboard')
  // Existing website: the field can be edited; leaving it with a new name asks to rename the website right away.
  const [renameDraft, setRenameDraft] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const siteName = website ? (renameDraft ?? website.siteName) : siteNameDraft
  const nameValid = website ? renameDraft === null || isValidSiteName(renameDraft) : isValidSiteName(siteNameDraft)
  const deptValid = !!deptCode

  const [files, setFiles] = useState<File[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [deployment, setDeployment] = useState<DeploymentDTO | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [previewLoaded, setPreviewLoaded] = useState(false)
  const [message, setMessage] = useState('')
  const [success, setSuccess] = useState('')
  /** Action to retry after the password is confirmed, or null. */
  const [reauthRetry, setReauthRetry] = useState<null | 'deploy' | 'rename'>(null)
  const [findingsAck, setFindingsAck] = useState(false)
  const idemKey = useRef<string>(newIdempotencyKey())
  const picker = useRef<HTMLInputElement>(null)

  const logical = website ? website.logicalName : `${(department?.code ?? 'dept')}.${siteName || 'site-name'}`
  const realHost = website ? website.hostname : `${(department?.code ?? 'dept')}-${siteName || 'site-name'}.${sitesHost}`

  const reset = useCallback(() => {
    setFiles([])
    setReauthRetry(null)
    setFindingsAck(false)
    setPhase('idle')
    setDeployment(null)
    setPreviewSrc(null)
    setPreviewLoaded(false)
    setMessage('')
    idemKey.current = newIdempotencyKey()
  }, [])

  function choose(selected: File[]) {
    reset()
    setSuccess('')
    if (!selected.length) return
    setFiles(selected)
    void startPreview(selected)
  }

  const fail = (e: unknown, fallback: string) => {
    if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') {
      // Cross-department production change by an admin: confirm the password, then retry Deploy.
      setPhase('preview')
      setReauthRetry('deploy')
      return
    }
    setPhase('error')
    if (e instanceof ApiError) {
      // Specific Thai reason for rejected files (with the offending file) and other upload errors.
      const path = typeof e.details?.path === 'string' ? ` (${e.details.path})` : ''
      setMessage(uploadApiErrorTh(e.code, e.details) ?? `${e.message}${path}`)
    } else setMessage(fallback)
  }

  const launchPreview = useCallback(
    async (id: string) => {
      const { preview } = await api.openPreview(id)
      if (preview.status === 'READY') {
        setPreviewLoaded(false)
        setPreviewSrc(preview.launchUrl)
        setPhase('preview')
      } else {
        setPhase('processing') // expired preview is being restarted; polling continues
      }
    },
    [api],
  )

  async function startPreview(selected: File[]) {
    if (!department) {
      setFiles([])
      return setMessage(unassigned ? 'Your account has no department yet.' : 'Enter a valid department.')
    }
    if (!nameValid) {
      setFiles([])
      return setMessage('ใช้ตัวอักษร a-z, ตัวเลข 0-9 และขีดกลาง (-) เท่านั้น ห้ามขึ้นต้นหรือลงท้ายด้วย -')
    }
    setMessage('')
    setSuccess('')
    setPhase('uploading')
    try {
      let target = website
      if (!target) {
        try {
          target = (await api.createWebsite({ department: departmentLabel.trim(), siteName: siteNameDraft })).website
        } catch (e) {
          // Another employee of the department created it first: continue with an upload to that website.
          if (e instanceof ApiError && e.code === 'WEBSITE_EXISTS' && typeof e.details?.websiteId === 'string') {
            await onWebsitesChanged()
            target = { id: e.details.websiteId } as WebsiteDTO
          } else throw e
        }
        await onWebsitesChanged()
      }
      const form = new FormData()
      for (const f of selected) form.append('files', f, f.webkitRelativePath || f.name)
      const { deployment: created } = await api.uploadDeployment(target.id, form, idemKey.current)
      setDeployment(created)
      setPhase('processing')
    } catch (e) {
      fail(e, 'Upload failed. Please try again.')
    }
  }

  // Poll the deployment while the server validates/builds or deploys it.
  useEffect(() => {
    if (!deployment) return
    const watching = phase === 'processing' || phase === 'deploying'
    if (!watching) return
    const t = setInterval(async () => {
      try {
        const { deployment: d } = await api.deployment(deployment.id)
        setDeployment(d)
        if (phase === 'processing') {
          if (d.status === 'PREVIEW_READY' && d.previewAvailable) {
            clearInterval(t)
            await launchPreview(d.id)
          } else if (d.status === 'FAILED') {
            clearInterval(t)
            setPhase('error')
            setMessage(d.errorMessage ?? 'Validation or build failed.')
          }
        } else if (phase === 'deploying') {
          if (d.status === 'LIVE' && d.isActive) {
            clearInterval(t)
            setPhase('live')
            setSuccess(`Deployed v${d.version} to production.`)
            await onWebsitesChanged()
          } else if (d.status === 'FAILED') {
            clearInterval(t)
            setPhase('error')
            setMessage(d.errorMessage ?? 'Deployment failed. The previous production version is still live.')
            await onWebsitesChanged()
          }
        }
      } catch (e) {
        clearInterval(t)
        fail(e, 'Lost connection while checking status.')
      }
    }, pollMs)
    return () => clearInterval(t)
  }, [api, deployment, launchPreview, onWebsitesChanged, phase, pollMs])

  async function refreshPreview() {
    if (!deployment) return
    try {
      await launchPreview(deployment.id)
    } catch (e) {
      fail(e, 'Could not refresh preview.')
    }
  }

  /** Pending site-name change for an existing website (valid and different), or null. */
  const pendingRename = website && renameDraft !== null && renameDraft !== website.siteName && isValidSiteName(renameDraft) ? renameDraft : null

  async function deploy() {
    if (!deployment) return
    if (pendingRename) {
      setRenameOpen(true) // confirm the new address; confirming renames and then deploys
      return
    }
    await promoteNow()
  }

  async function promoteNow() {
    if (!deployment) return
    setMessage('')
    setPhase('deploying')
    try {
      const { deployment: d } = await api.promote(deployment.id)
      setDeployment(d)
      await onWebsitesChanged()
    } catch (e) {
      fail(e, 'Deploy request failed.')
    }
  }

  const statusText = useMemo(() => {
    switch (phase) {
      case 'idle':
        return 'Waiting'
      case 'uploading':
        return 'Uploading'
      case 'processing':
        return deployment ? STATUS_LABEL[deployment.status] : 'Processing'
      case 'preview':
        return 'Preview ready'
      case 'deploying':
        return 'Deploying'
      case 'live':
        return 'Live'
      case 'error':
        return 'Error'
    }
  }, [phase, deployment])
  const busy = phase === 'uploading' || phase === 'processing' || phase === 'deploying'
  const showPreview = (phase === 'preview' || phase === 'deploying' || phase === 'live' || (phase === 'error' && !!previewSrc)) && !!previewSrc
  const fileLabel = files.length === 1 ? files[0]!.name : `${files.length} files`
  const changeFile = () => picker.current?.click()
  const findings = deployment?.contentFindings ?? []
  const needsAck = findings.length > 0
  const deployReady = phase === 'preview' && previewLoaded && deployment?.status === 'PREVIEW_READY' && (!needsAck || findingsAck)

  return (
    <main className="panel workspace active" id="upload-workspace" role="tabpanel" aria-labelledby="tab-upload">
      <section className="domain-settings" aria-label="Deployment destination">
        <div className="domain-grid">
          <DepartmentSelector
            departments={departments}
            value={departmentLabel}
            locked={!isAdmin}
            onChange={(label) => {
              setDepartmentLabel(label)
              setRenameDraft(null)
              reset()
            }}
          />
          <SiteNameInput
            value={siteName}
            disabled={busy || unassigned}
            onChange={(v) => (website ? setRenameDraft(v) : setSiteNameDraft(v))}
            onCommit={() => {
              if (website && renameDraft === website.siteName) setRenameDraft(null)
            }}
          />
        </div>
        <div className="domain-address">
          <span>
            {website ? 'Website address' : 'Requested hostname'} <span className="switch-label">({website ? 'update existing website' : 'new website'})</span>
          </span>
          <code id="hostname">{logical}</code>
        </div>
        <p className={`notice${nameValid && deptValid && !unassigned ? '' : ' error'}`} id="domain-notice">
          {unassigned
            ? 'บัญชีของคุณยังไม่ได้รับการกำหนดฝ่าย (department) กรุณาติดต่อผู้ดูแล Deploy Studio'
            : !deptValid
            ? 'Department: ใช้ตัวอักษร ตัวเลข ช่องว่าง หรือ "-" (2–32 ตัวอักษร)'
            : nameValid
            ? website && pendingRename
              ? `ชื่อใหม่ ${website.department.code}.${pendingRename} (${website.department.code}-${pendingRename}.${sitesHost}) จะมีผลเมื่อกด Deploy · ลิงก์เดิมจะใช้ไม่ได้`
              : website
              ? `อัปโหลดเวอร์ชันใหม่ให้เว็บไซต์ของ ${department?.code} · ${realHost} · เวอร์ชันเดิมยังออนไลน์จนกว่า Deploy ใหม่จะพร้อม`
              : `เว็บไซต์ใหม่ของ ${department?.code ?? ''} จะใช้ชื่อ ${realHost} · ต้องมี DNS/TLS ของบริษัทรองรับ`
            : 'ใช้ตัวอักษร a-z, ตัวเลข 0-9 และขีดกลาง (-) เท่านั้น ห้ามขึ้นต้นหรือลงท้ายด้วย -'}
        </p>
      </section>

      {/* Hidden picker behind every "Change file" button. */}
      <input
        ref={picker}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        data-testid="change-file-input"
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? [])
          e.target.value = ''
          if (selected.length) choose(selected)
        }}
      />

      {phase === 'idle' ? (
        <UploadDropzone onFiles={choose} disabled={unassigned} />
      ) : showPreview ? (
        <PreviewPanel
          visible
          inline
          src={previewSrc}
          displayUrl={deployment ? `Isolated preview · v${deployment.version} · ${logical}` : 'Isolated preview'}
          heading={phase === 'live' ? `Deployed · ${fileLabel}` : `Preview · ${fileLabel}`}
          onLoaded={() => setPreviewLoaded(true)}
          onRefresh={() => void refreshPreview()}
          onChangeFile={changeFile}
          busy={phase === 'deploying'}
        >
          {phase !== 'live' ? <ContentFindings findings={findings} acknowledged={findingsAck} onAcknowledge={setFindingsAck} /> : null}
          {phase !== 'live' ? <DeployButton ready={deployReady} busy={phase === 'deploying'} onDeploy={() => void deploy()} /> : null}
        </PreviewPanel>
      ) : (
        <section className={`upload-stage${phase === 'error' ? ' error' : ''}`} aria-live="polite" data-testid="upload-stage">
          {phase === 'error' ? null : <div className="spinner" aria-hidden="true" />}
          <p className="stage-title">{phase === 'error' ? 'อัปโหลดไม่ผ่าน' : `${statusText}…`}</p>
          {phase === 'error' && message ? (
            <p className="stage-reason" role="alert">
              {message}
            </p>
          ) : null}
          <p className="stage-file">{fileLabel}</p>
          {phase === 'error' ? <ContentFindings findings={findings} /> : null}
          <button type="button" className="sketch browse" onClick={changeFile} disabled={busy && phase !== 'processing'}>
            Change file
          </button>
        </section>
      )}

      <p id="message" className="message" role="alert">
        {phase === 'error' && !showPreview ? null : message /* shown inside the failure card instead */}
      </p>
      {reauthRetry ? (
        <ReauthDialog
          api={api}
          onCancel={() => setReauthRetry(null)}
          onDone={() => {
            const retry = reauthRetry
            setReauthRetry(null)
            if (retry === 'deploy') void deploy()
            else setRenameOpen(true)
          }}
        />
      ) : null}
      {renameOpen && website && renameDraft ? (
        <RenameDialog
          from={website.logicalName}
          to={`${website.department.code}.${renameDraft}`}
          newHost={`${website.department.code}-${renameDraft}.${sitesHost}`}
          onCancel={() => {
            setRenameOpen(false)
            setRenameDraft(null)
          }}
          onConfirm={async () => {
            try {
              await api.renameWebsite(website.id, renameDraft)
              setRenameOpen(false)
              setRenameDraft(null)
              await onWebsitesChanged()
              await promoteNow()
            } catch (e) {
              if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') {
                setReauthRetry('rename')
                setRenameOpen(false)
                return
              }
              throw e
            }
          }}
        />
      ) : null}
      {success ? (
        <p className="success-note" role="status">
          {success}{' '}
          {website ? (
            <a className="preview-link" href={website.url} target="_blank" rel="noopener noreferrer">
              Open {website.hostname}
            </a>
          ) : null}
        </p>
      ) : null}
    </main>
  )
}

export { IN_PROGRESS }

const RENAME_ERRORS: Record<string, string> = {
  HOSTNAME_TAKEN: 'ชื่อนี้ถูกใช้แล้ว กรุณาเลือกชื่ออื่น',
  HOSTNAME_TOO_LONG: 'ชื่อฝ่ายรวมกับชื่อเว็บไซต์ยาวเกินไป (สูงสุด 63 ตัวอักษร)',
  PROMOTION_IN_PROGRESS: 'เว็บไซต์กำลัง Deploy หรือ Rollback อยู่ กรุณาลองใหม่เมื่อเสร็จ',
  WEBSITE_SUSPENDED: 'เว็บไซต์นี้ถูกระงับโดยผู้ดูแลระบบ',
  RATE_LIMITED: 'เปลี่ยนชื่อบ่อยเกินไป กรุณารอสักครู่',
}

/** Confirms renaming a live website: the address changes immediately and the old one stops working. */
function RenameDialog({ from, to, newHost, onConfirm, onCancel }: { from: string; to: string; newHost: string; onConfirm: () => Promise<void>; onCancel: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onCancel() : undefined)}
      busy={busy}
      title="เปลี่ยนชื่อเว็บไซต์และ Deploy?"
      description={`${from} → ${to} · ที่อยู่ใหม่ ${newHost} · ลิงก์เดิมจะใช้ไม่ได้ทันที (ผู้ใช้ต้องใช้ที่อยู่ใหม่)`}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => {
              setBusy(true)
              setError('')
              onConfirm()
                .catch((e: unknown) => setError(e instanceof ApiError ? (RENAME_ERRORS[e.code] ?? e.message) : 'เปลี่ยนชื่อไม่สำเร็จ'))
                .finally(() => setBusy(false))
            }}
          >
            เปลี่ยนชื่อและ Deploy
          </Button>
        </>
      }
    >
      {error ? (
        <p className="ds-form-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  )
}
