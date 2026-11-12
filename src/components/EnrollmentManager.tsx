'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { PasswordLinkDTO, UserAdminDTO, UserListDTO, UserStatus } from '@/lib/types'
import { ApiClient, ApiError } from '@/lib/api-client'
import { ERROR_TH, ROLE_LABEL, T } from '@/lib/i18n/enrollment-th'
import { LocalTime } from '@/components/LocalTime'
import { ReauthDialog } from '@/components/ReauthDialog'
import { Switch } from '@/components/ui/Switch'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { FormField } from '@/components/ui/FormField'
import { RowActionsMenu, type MenuAction } from '@/components/ui/DropdownMenu'
import { Select, type SelectOption } from '@/components/ui/Select'
import { RoleBadge, StatusBadge } from '@/components/ui/Badge'
import { KeyIcon, PencilIcon, PlusIcon, SearchIcon, UserXIcon } from '@/components/ui/icons'

type Role = 'ADMIN' | 'USER'
type CreateInput = { displayName: string; email: string; department?: string; role: Role }
type PatchInput = { displayName?: string; department?: string; role?: Role; status?: 'ACTIVE' | 'DISABLED' }
type Filters = { q: string; department: string; role: '' | Role; status: '' | UserStatus; page: number }
type Dialogs =
  | { kind: 'create' }
  | { kind: 'edit'; user: UserAdminDTO }
  | { kind: 'reset'; user: UserAdminDTO }
  | { kind: 'revoke'; user: UserAdminDTO }
  | { kind: 'link'; title: string; email: string; link: PasswordLinkDTO; self?: boolean }
  | null

// Radix Select items cannot use an empty value: "all" sentinels map back to "no filter".
const ALL = '__all__'
const ROLE_OPTIONS: SelectOption[] = [
  { value: 'USER', label: ROLE_LABEL.USER },
  { value: 'ADMIN', label: ROLE_LABEL.ADMIN },
]

type Props = {
  csrfToken: string
  me: { id: string; displayName: string }
  initial: UserListDTO
  /** Test seam. */
  api?: ApiClient
  searchDelayMs?: number
}

function messageOf(e: unknown): string {
  if (e instanceof ApiError) return ERROR_TH[e.code] ?? e.message
  return T.actionFailed
}

/** จัดการบัญชีผู้ใช้งาน (ADMIN). Presentation only — every rule is enforced again by /api/v1/admin/users. */
export function EnrollmentManager({ csrfToken, me, initial, api: injected, searchDelayMs = 300 }: Props) {
  const api = useMemo(() => injected ?? new ApiClient(csrfToken), [injected, csrfToken])
  const [data, setData] = useState(initial)
  const [filters, setFilters] = useState<Filters>({ q: '', department: '', role: '', status: '', page: 1 })
  const [dialog, setDialog] = useState<Dialogs>(null)
  const [error, setError] = useState('')
  const [pendingReauth, setPendingReauth] = useState<null | (() => Promise<void>)>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const first = useRef(true)

  const load = useCallback(
    async (f: Filters) => {
      try {
        setData(await api.listUsers({ q: f.q, department: f.department, role: f.role, status: f.status, page: f.page }))
        setError('')
      } catch (e) {
        setError(e instanceof ApiError ? messageOf(e) : T.loadFailed)
      }
    },
    [api],
  )

  // Reload on filter changes (search is debounced). The first render uses the server-provided list.
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => void load(filters), searchDelayMs)
    return () => clearTimeout(t)
  }, [filters, load, searchDelayMs])

  const setFilter = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }))
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize))
  const isLastActiveAdmin = (u: UserAdminDTO) => u.role === 'ADMIN' && u.status === 'ACTIVE' && data.activeAdminCount <= 1

  /** Runs an admin write; on REAUTH_REQUIRED asks for the password and retries once confirmed. */
  async function run(action: () => Promise<void>) {
    try {
      await action()
      setError('')
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REAUTH_REQUIRED') {
        setPendingReauth(() => action)
        return
      }
      throw e
    }
  }

  /** Only actions this administrator may perform on this row (the server enforces the same rules). */
  function actionsFor(u: UserAdminDTO): MenuAction[] {
    if (u.status === 'REVOKED') return []
    const self = u.id === me.id
    const list: MenuAction[] = [{ key: 'edit', label: T.edit, icon: <PencilIcon />, onSelect: () => setDialog({ kind: 'edit', user: u }) }]
    list.push({ key: 'reset', label: T.resetPassword, icon: <KeyIcon />, onSelect: () => setDialog({ kind: 'reset', user: u }) })
    if (!self && !isLastActiveAdmin(u)) list.push({ key: 'revoke', label: T.revoke, icon: <UserXIcon />, danger: true, onSelect: () => setDialog({ kind: 'revoke', user: u }) })
    return list
  }

  const departmentOptions: SelectOption[] = [{ value: ALL, label: T.allDepartments }, ...data.departments.map((d) => ({ value: d.code, label: d.name }))]
  const roleFilterOptions: SelectOption[] = [{ value: ALL, label: T.allRoles }, ...ROLE_OPTIONS]
  // Online = enabled (ACTIVE), Offline = disabled (DISABLED) — the same on/off as the status switch.
  const statusFilterOptions: SelectOption[] = [
    { value: ALL, label: T.allStatuses },
    { value: 'ACTIVE', label: T.online },
    { value: 'DISABLED', label: T.offline },
  ]

  /** Status switch: ACTIVE ↔ DISABLED through the existing update API (server re-checks everything). */
  async function toggleStatus(u: UserAdminDTO, enable: boolean) {
    setTogglingId(u.id)
    try {
      await run(async () => {
        await api.updateUser(u.id, { status: enable ? 'ACTIVE' : 'DISABLED' })
        await load(filters)
      })
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setTogglingId(null)
    }
  }
  const statusLock = (u: UserAdminDTO): string | null => (u.id === me.id ? T.selfLocked : isLastActiveAdmin(u) ? T.lastAdminLocked : null)

  return (
    <>
      <section className="panel workspace active ds-enroll" aria-labelledby="enroll-title">
        <div className="ds-section-head">
          <div>
            <h2 id="enroll-title">{T.pageTitle}</h2>
            <p className="subtle">{T.pageSubtitle}</p>
          </div>
          <Button variant="primary" icon={<PlusIcon />} onClick={() => setDialog({ kind: 'create' })}>
            {T.enrollUser}
          </Button>
        </div>

        <div className="ds-filters" role="search">
          <div className="ds-search">
            <SearchIcon className="ds-search-icon" />
            <input
              className="ds-input"
              type="search"
              placeholder={T.search}
              aria-label={T.search}
              value={filters.q}
              onChange={(e) => setFilter({ q: e.target.value })}
            />
          </div>
          <Select aria-label={T.department} value={filters.department || ALL} onValueChange={(v) => setFilter({ department: v === ALL ? '' : v })} options={departmentOptions} />
          <Select aria-label={T.role} value={filters.role || ALL} onValueChange={(v) => setFilter({ role: v === ALL ? '' : (v as Role) })} options={roleFilterOptions} />
          <Select aria-label={T.status} value={filters.status || ALL} onValueChange={(v) => setFilter({ status: v === ALL ? '' : (v as UserStatus) })} options={statusFilterOptions} />
        </div>

        {error ? (
          <p className="message" role="alert">
            {error}
          </p>
        ) : null}

        <div className="ds-table-wrap">
          <table className="ds-table" data-testid="enroll-table">
            <thead>
              <tr>
                <th scope="col">{T.userName}</th>
                <th scope="col">{T.email}</th>
                <th scope="col">{T.department}</th>
                <th scope="col">{T.role}</th>
                <th scope="col">{T.status}</th>
                <th scope="col">{T.lastLogin}</th>
                <th scope="col" className="ds-col-actions">
                  <span className="sr-only">{T.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="ds-empty">
                    {T.noResults}
                  </td>
                </tr>
              ) : (
                data.users.map((u) => (
                  <tr key={u.id}>
                    <td data-label={T.userName} className="ds-cell-name">
                      <span className="ds-name">{u.displayName}</span>
                      {u.id === me.id ? <span className="ds-tag">{T.you}</span> : null}
                      {u.resetRequested ? <span className="ds-tag ds-tag-warn">{T.resetRequested}</span> : null}
                    </td>
                    <td data-label={T.email} className="ds-cell-email">
                      {u.email}
                    </td>
                    <td data-label={T.department}>{u.department?.name ?? '—'}</td>
                    <td data-label={T.role}>
                      <RoleBadge role={u.role} />
                    </td>
                    <td data-label={T.status}>
                      {u.status === 'ACTIVE' || u.status === 'DISABLED' ? (
                        <Switch
                          checked={u.status === 'ACTIVE'}
                          onCheckedChange={(on) => void toggleStatus(u, on)}
                          label={T.statusSwitch(u.displayName)}
                          disabled={!!statusLock(u)}
                          disabledReason={statusLock(u) ?? undefined}
                          busy={togglingId === u.id}
                        />
                      ) : (
                        <StatusBadge status={u.status} />
                      )}
                    </td>
                    <td data-label={T.lastLogin} className="ds-cell-muted">
                      {u.lastLoginAt ? <LocalTime iso={u.lastLoginAt} /> : '—'}
                    </td>
                    <td className="ds-col-actions">
                      <RowActionsMenu label={T.rowActions(u.displayName)} actions={actionsFor(u)} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="ds-pager" aria-label="Pagination">
          <span className="ds-pager-info" aria-live="polite">
            {T.accountsCount(data.total)} · {T.pageOf(data.page, pages)}
          </span>
          <Button disabled={data.page <= 1} onClick={() => setFilter({ page: data.page - 1 })}>
            {T.previous}
          </Button>
          <Button disabled={data.page >= pages} onClick={() => setFilter({ page: data.page + 1 })}>
            {T.next}
          </Button>
        </div>
      </section>

      {dialog?.kind === 'create' || dialog?.kind === 'edit' ? (
        <UserFormDialog
          departments={data.departments.map((d) => d.name)}
          user={dialog.kind === 'edit' ? dialog.user : null}
          lockRoleStatus={dialog.kind === 'edit' ? (dialog.user.id === me.id ? T.selfLocked : isLastActiveAdmin(dialog.user) ? T.lastAdminLocked : null) : null}
          onClose={() => setDialog(null)}
          onSubmit={(create, patch) =>
            run(async () => {
              if (dialog.kind === 'create' && create) {
                const r = await api.createUser(create)
                setDialog({ kind: 'link', title: T.accountCreated, email: r.user.email, link: r.setupLink })
              } else if (dialog.kind === 'edit' && patch) {
                await api.updateUser(dialog.user.id, patch)
                setDialog(null)
              }
              await load(filters)
            })
          }
        />
      ) : null}

      {dialog?.kind === 'reset' || dialog?.kind === 'revoke' ? (
        <ConfirmDialog
          title={dialog.kind === 'reset' ? T.resetPassword : T.confirmRevokeTitle}
          body={dialog.kind === 'reset' ? (dialog.user.id === me.id ? T.confirmResetSelf : T.confirmReset(dialog.user.displayName)) : T.confirmRevoke(dialog.user.displayName)}
          confirmLabel={dialog.kind === 'reset' ? T.confirmResetAction : T.revoke}
          danger={dialog.kind === 'revoke'}
          onClose={() => setDialog(null)}
          onConfirm={() =>
            run(async () => {
              if (dialog.kind === 'reset') {
                const r = await api.resetUserPassword(dialog.user.id)
                setDialog({ kind: 'link', title: T.resetLinkTitle, email: dialog.user.email, link: r.resetLink, self: dialog.user.id === me.id })
                if (dialog.user.id === me.id) return // own session has ended: no reload; the dialog shows the link to open
              } else {
                await api.revokeUser(dialog.user.id)
                setDialog(null)
              }
              await load(filters)
            })
          }
        />
      ) : null}

      {dialog?.kind === 'link' ? (
        <LinkDialog
          title={dialog.title}
          email={dialog.email}
          link={dialog.link}
          self={dialog.self}
          onClose={() => (dialog.self ? window.location.assign(new URL('/login', window.location.origin).toString()) : setDialog(null))}
        />
      ) : null}

      {pendingReauth ? (
        <ReauthDialog
          api={api}
          onCancel={() => setPendingReauth(null)}
          onDone={() => {
            const retry = pendingReauth
            setPendingReauth(null)
            void retry().catch((e: unknown) => setError(messageOf(e)))
          }}
        />
      ) : null}
    </>
  )
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function UserFormDialog({
  user,
  lockRoleStatus,
  departments,
  onSubmit,
  onClose,
}: {
  user: UserAdminDTO | null
  /** Reason the role/status fields are locked (own account / last active admin), or null. */
  lockRoleStatus: string | null
  departments: string[]
  onSubmit: (create: CreateInput | null, patch?: PatchInput) => Promise<void>
  onClose: () => void
}) {
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [department, setDepartment] = useState(user?.department?.name ?? '')
  const [role, setRole] = useState<Role>(user?.role ?? 'USER')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  function validate(): Record<string, string> {
    const e: Record<string, string> = {}
    if (!displayName.trim()) e.displayName = T.required(T.displayName)
    if (!user) {
      if (!email.trim()) e.email = T.required(T.email)
      else if (!EMAIL_SHAPE.test(email.trim())) e.email = T.invalidEmail
    }
    if (role === 'USER' && !department.trim()) e.department = ERROR_TH.DEPARTMENT_REQUIRED!
    return e
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault()
    if (saving) return // no duplicate submissions
    const v = validate()
    setErrors(v)
    if (Object.keys(v).length) return
    setSaving(true)
    setFormError('')
    try {
      if (!user) await onSubmit({ displayName: displayName.trim(), email: email.trim(), department: department.trim() || undefined, role })
      else {
        // Email is fixed after enrollment; locked role/status are never sent (the server enforces both too).
        const patch: PatchInput = { displayName: displayName.trim(), department: department.trim() || undefined }
        if (!lockRoleStatus) patch.role = role // status is changed with the switch in the table
        await onSubmit(null, patch)
      }
    } catch (err) {
      setFormError(messageOf(err))
    } finally {
      setSaving(false)
    }
  }

  const formId = 'user-form'
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      busy={saving}
      title={user ? T.editAccount : T.enrollUser}
      description={user ? undefined : T.setupLinkNote}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            {T.cancel}
          </Button>
          <Button variant="primary" type="submit" form={formId} loading={saving}>
            {saving ? T.saving : user ? T.save : T.enrollUser}
          </Button>
        </>
      }
    >
      <form id={formId} className="ds-form" onSubmit={(e) => void submit(e)} noValidate>
        {formError ? (
          <p className="ds-form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <FormField id="u-name" label={T.displayName} error={errors.displayName}>
          <input id="u-name" className="ds-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={200} aria-invalid={!!errors.displayName} autoFocus />
        </FormField>
        <FormField id="u-email" label={T.email} error={errors.email} hint={user ? T.emailLocked : undefined}>
          <input id="u-email" className="ds-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} readOnly={!!user} aria-readonly={!!user} aria-invalid={!!errors.email} />
        </FormField>
        <FormField id="u-dept" label={T.department} error={errors.department} hint={T.departmentHint}>
          <input id="u-dept" className="ds-input" list="u-dept-options" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="เช่น DTD" maxLength={100} aria-invalid={!!errors.department} />
          <datalist id="u-dept-options">
            {departments.map((d) => (
              <option key={d} value={d} />
            ))}
          </datalist>
        </FormField>
        <FormField id="u-role" label={T.role} hint={lockRoleStatus ?? undefined}>
          <Select id="u-role" value={role} onValueChange={(v) => setRole(v as Role)} options={ROLE_OPTIONS} disabled={!!lockRoleStatus} />
        </FormField>
      </form>
    </Dialog>
  )
}

function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onClose }: { title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      busy={busy}
      title={title}
      description={body}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {T.cancel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={() => {
              setBusy(true)
              setError('')
              onConfirm()
                .catch((e: unknown) => setError(messageOf(e)))
                .finally(() => setBusy(false))
            }}
          >
            {confirmLabel}
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

/** Shows a one-time link exactly once. It is never stored in the page after the dialog closes. */
function LinkDialog({ title, email, link, self, onClose }: { title: string; email: string; link: PasswordLinkDTO; self?: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <Dialog
      open
      onOpenChange={(o) => (!o ? onClose() : undefined)}
      title={title}
      description={
        self ? (
          <>
            {T.selfResetDone} · {T.linkExpires} <LocalTime iso={link.expiresAt} />
          </>
        ) : (
          <>
            {T.linkInstructions(email)} · {T.linkExpires} <LocalTime iso={link.expiresAt} />
          </>
        )
      }
      footer={
        self ? (
          <a className="ds-btn ds-btn-primary" href={link.url}>
            {T.openSetPassword}
          </a>
        ) : (
          <Button variant="primary" onClick={onClose}>
            {T.done}
          </Button>
        )
      }
    >
      <div className="ds-link-box">
        <input className="ds-input mono" readOnly value={link.url} aria-label={T.linkLabel} onFocus={(e) => e.currentTarget.select()} />
        <Button onClick={() => void navigator.clipboard?.writeText(link.url).then(() => setCopied(true))}>{copied ? T.copied : T.copy}</Button>
      </div>
    </Dialog>
  )
}
