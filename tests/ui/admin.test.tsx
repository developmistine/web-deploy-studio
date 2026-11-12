import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminShell, SIDEBAR_KEY } from '@/components/AdminShell'
import { BrandHeader } from '@/components/BrandHeader'
import { EnrollmentManager } from '@/components/EnrollmentManager'
import { LoginForm } from '@/components/AuthForms'
import { DeployStudioApp } from '@/components/DeployStudioApp'
import { ApiError, type ApiClient } from '@/lib/api-client'
import type { DepartmentDTO, MeDTO, UserAdminDTO, UserListDTO } from '@/lib/types'

afterEach(cleanup)
beforeEach(() => {
  localStorage.clear()
  window.history.replaceState(null, '', '/')
})

const DTD: DepartmentDTO = { id: 'd-dtd', code: 'dtd', name: 'DTD' }
const ERP: DepartmentDTO = { id: 'd-erp', code: 'erp', name: 'ERP' }
const user = (over: Partial<UserAdminDTO> = {}): UserAdminDTO => ({
  id: 'u-1', displayName: 'Somchai K', email: 'somchai@test.example', department: DTD, role: 'USER', status: 'ACTIVE',
  passwordSet: true, resetRequested: false, lastLoginAt: null, createdAt: new Date().toISOString(), ...over,
})
const list = (users: UserAdminDTO[], over: Partial<UserListDTO> = {}): UserListDTO => ({ users, total: users.length, page: 1, pageSize: 20, departments: [DTD, ERP], activeAdminCount: 2, ...over })
const ME = { id: 'admin-1', displayName: 'Admin A' }
const meRow = user({ id: ME.id, displayName: 'Admin A', email: 'admin@test.example', role: 'ADMIN', department: null })
const LINK = { url: 'http://localhost:3000/password#token=abc', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }

function mockApi(overrides: Partial<Record<keyof ApiClient, unknown>> = {}): ApiClient {
  return {
    listUsers: vi.fn().mockResolvedValue(list([user()])),
    createUser: vi.fn().mockResolvedValue({ user: user({ id: 'u-new', status: 'INVITED' }), setupLink: LINK }),
    updateUser: vi.fn().mockResolvedValue({ user: user() }),
    resetUserPassword: vi.fn().mockResolvedValue({ resetLink: LINK }),
    revokeUser: vi.fn().mockResolvedValue({ user: user({ status: 'REVOKED' }) }),
    reauth: vi.fn().mockResolvedValue({ ok: true }),
    logout: vi.fn().mockResolvedValue({ redirectTo: '/login' }),
    ...overrides,
  } as unknown as ApiClient
}

const renderManager = (users: UserAdminDTO[], api = mockApi(), over: Partial<UserListDTO> = {}) => {
  render(<EnrollmentManager csrfToken="c" me={ME} initial={list(users, over)} api={api} searchDelayMs={0} />)
  return api
}

/** Opens a row's three-dot menu with the keyboard (Radix opens on Enter) and returns its menu items. */
function openRowMenu(name: string) {
  const trigger = screen.getByRole('button', { name: `การจัดการบัญชี ${name}` })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter' })
  const menu = screen.getByRole('menu')
  return { trigger, menu, items: within(menu).getAllByRole('menuitem') }
}

/** Opens a Radix Select by its accessible name and picks an option label. */
function choose(selectName: RegExp | string, optionLabel: string) {
  const trigger = screen.getByRole('combobox', { name: selectName })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter' })
  fireEvent.click(screen.getByRole('option', { name: optionLabel }))
}

describe('Admin sidebar & brand header', () => {
  it('shows the two admin pages (Thai), highlights the active one and collapses to an icon rail (remembered)', () => {
    render(
      <AdminShell active="enroll">
        <p>content</p>
      </AdminShell>,
    )
    const nav = screen.getByRole('navigation')
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['Deploy เว็บไซต์', 'จัดการบัญชีผู้ใช้งาน'])
    expect(within(nav).getByRole('link', { name: 'จัดการบัญชีผู้ใช้งาน' })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: 'ย่อแถบเมนู' }))
    expect(screen.getByTestId('admin-layout').className).toContain('collapsed')
    expect(localStorage.getItem(SIDEBAR_KEY)).toBe('collapsed')
    expect(within(nav).getByRole('link', { name: 'จัดการบัญชีผู้ใช้งาน' })).toHaveAttribute('title', 'จัดการบัญชีผู้ใช้งาน')
    fireEvent.click(screen.getByRole('button', { name: 'ขยายแถบเมนู' }))
    expect(screen.getByTestId('admin-layout').className).not.toContain('collapsed')
  })

  it('header shows both logos with alt text and opens the navigation drawer (Escape closes, focus returns)', () => {
    render(
      <AdminShell active="deploy">
        <BrandHeader />
      </AdminShell>,
    )
    const header = screen.getByTestId('brand-header')
    expect(within(header).getByAltText('Deploy Studio')).toHaveAttribute('src', '/brand/deploy-studio.png')
    expect(within(header).getByAltText('BW')).toHaveAttribute('src', '/brand/bw-logo-pink.svg')
    const opener = screen.getByRole('button', { name: 'เปิดเมนู' })
    fireEvent.click(opener)
    expect(screen.getByTestId('admin-layout').className).toContain('drawer-open')
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Deploy เว็บไซต์' }))
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(screen.getByTestId('admin-layout').className).not.toContain('drawer-open')
    expect(document.activeElement).toBe(opener)
  })

  it('outside the admin layout (USER, sign-in) the header has no menu button but keeps both identities', () => {
    render(<BrandHeader />)
    expect(screen.queryByRole('button', { name: 'เปิดเมนู' })).toBeNull()
    expect(screen.getByAltText('BW')).toBeInTheDocument()
    expect(screen.getByAltText('Deploy Studio')).toBeInTheDocument()
  })
})

describe('จัดการบัญชีผู้ใช้งาน — table, labels and filters', () => {
  it('shows Thai headings, badges and labels while keeping enum values', () => {
    renderManager([user(), user({ id: 'u-2', displayName: 'Napa E', email: 'napa@test.example', department: ERP, role: 'ADMIN', status: 'INVITED' })])
    expect(screen.getByRole('heading', { name: 'จัดการบัญชีผู้ใช้งาน', level: 2 })).toBeInTheDocument()
    const table = screen.getByTestId('enroll-table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['ชื่อผู้ใช้', 'อีเมลบริษัท', 'ฝ่าย / แผนก', 'สิทธิ์', 'สถานะ', 'เข้าสู่ระบบล่าสุด', 'การจัดการ'])
    expect(within(table).getByText('Admin')).toHaveAttribute('data-role', 'ADMIN') // role labels in English
    expect(within(table).getByText('User')).toHaveAttribute('data-role', 'USER')
    expect(within(table).getByText('รอเปิดใช้งาน')).toHaveAttribute('data-status', 'INVITED') // not toggleable yet
    expect(within(table).getByRole('switch', { name: /Somchai K/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: /ลงทะเบียนผู้ใช้/ })).toHaveClass('ds-btn-primary')
    expect(screen.getByPlaceholderText('ค้นหาชื่อหรืออีเมล')).toBeInTheDocument()
  })

  it('filters map Thai labels back to backend values (department code, ADMIN/USER, status enum)', async () => {
    const api = renderManager([user()])
    fireEvent.change(screen.getByRole('searchbox', { name: 'ค้นหาชื่อหรืออีเมล' }), { target: { value: 'napa' } })
    await waitFor(() => expect(api.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'napa', page: 1 })))
    choose('ฝ่าย / แผนก', 'ERP')
    await waitFor(() => expect(api.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ department: 'erp' })))
    const statusTrigger = screen.getByRole('combobox', { name: 'สถานะ' })
    statusTrigger.focus()
    fireEvent.keyDown(statusTrigger, { key: 'Enter' })
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['ทุกสถานะ', 'Online', 'Offline'])
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    choose('สิทธิ์', 'Admin')
    choose('สถานะ', 'Offline')
    await waitFor(() => expect(api.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ department: 'erp', role: 'ADMIN', status: 'DISABLED' })))
    choose('ฝ่าย / แผนก', 'ทุกฝ่าย')
    await waitFor(() => expect(api.listUsers).toHaveBeenLastCalledWith(expect.objectContaining({ department: '' })))
  })
})

describe('row actions (three-dot menu)', () => {
  it('opens with the keyboard, lists Edit / Reset / Revoke with the destructive item last, and closes on Escape', () => {
    renderManager([user()])
    const { trigger, items } = openRowMenu('Somchai K')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(items.map((i) => i.textContent)).toEqual(['แก้ไขข้อมูล', 'รีเซ็ตรหัสผ่าน', 'ยกเลิกการใช้งาน'])
    expect(items[2]).toHaveClass('danger')
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('shows only permitted actions: own account → Edit + Reset (no revoke); last active admin → no revoke; removed → no menu', () => {
    renderManager([meRow, user({ id: 'admin-2', displayName: 'Other Admin', role: 'ADMIN' }), user({ id: 'gone', displayName: 'Gone User', status: 'REVOKED' })], mockApi(), { activeAdminCount: 1 })
    expect(openRowMenu('Admin A').items.map((i) => i.textContent)).toEqual(['แก้ไขข้อมูล', 'รีเซ็ตรหัสผ่าน'])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(openRowMenu('Other Admin').items.map((i) => i.textContent)).toEqual(['แก้ไขข้อมูล', 'รีเซ็ตรหัสผ่าน'])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'การจัดการบัญชี Gone User' })).toBeNull()
  })

  it('Edit opens the selected account; email is read-only; role Select maps to ADMIN; Save is single-submit with a loading state', async () => {
    let resolve: () => void = () => {}
    const api = mockApi({ updateUser: vi.fn().mockImplementation(() => new Promise<void>((r) => (resolve = r)).then(() => ({ user: user() }))) })
    renderManager([user(), user({ id: 'u-2', displayName: 'Napa E', email: 'napa@test.example' })], api)
    const { items } = openRowMenu('Napa E')
    fireEvent.click(items[0]!)
    const dialog = screen.getByRole('dialog', { name: 'แก้ไขข้อมูลบัญชี' })
    expect(within(dialog).getByLabelText('ชื่อที่แสดง')).toHaveValue('Napa E')
    expect(within(dialog).getByLabelText('อีเมลบริษัท')).toHaveAttribute('readonly')
    expect(dialog).toHaveTextContent('ต้องผ่านขั้นตอนยืนยันตัวตนแยกต่างหาก')
    expect(within(dialog).queryByRole('combobox', { name: 'สถานะบัญชี' })).toBeNull() // status lives in the table switch
    choose('สิทธิ์', 'Admin')
    const save = within(dialog).getByRole('button', { name: 'บันทึก' })
    const cancel = within(dialog).getByRole('button', { name: 'ยกเลิก' })
    expect(save.className).toContain('ds-btn') // same component/size as Cancel; hierarchy via variant
    expect(cancel.className).toContain('ds-btn')
    expect(save).toHaveClass('ds-btn-primary')
    fireEvent.click(save)
    fireEvent.click(save)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /กำลังบันทึก/ })).toBeDisabled())
    expect(api.updateUser).toHaveBeenCalledTimes(1)
    expect(api.updateUser).toHaveBeenCalledWith('u-2', { displayName: 'Napa E', department: 'DTD', role: 'ADMIN' })
    await act(async () => resolve())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'แก้ไขข้อมูลบัญชี' })).toBeNull())
  })

  it('own account: role and status are locked and never sent', async () => {
    const api = renderManager([meRow])
    fireEvent.click(openRowMenu('Admin A').items[0]!)
    const dialog = screen.getByRole('dialog', { name: 'แก้ไขข้อมูลบัญชี' })
    expect(within(dialog).getByRole('combobox', { name: 'สิทธิ์' })).toBeDisabled()
    expect(dialog).toHaveTextContent('คุณเปลี่ยนสิทธิ์หรือสถานะของบัญชีตัวเองไม่ได้')
    fireEvent.click(within(dialog).getByRole('button', { name: 'บันทึก' }))
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith(ME.id, { displayName: 'Admin A', department: undefined }))
  })

  it('Reset password confirms, then shows the one-time link from the existing secure workflow', async () => {
    const api = renderManager([user()])
    fireEvent.click(openRowMenu('Somchai K').items[1]!)
    const dialog = screen.getByRole('dialog', { name: 'รีเซ็ตรหัสผ่าน' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'สร้างลิงก์รีเซ็ต' }))
    await waitFor(() => expect(api.resetUserPassword).toHaveBeenCalledWith('u-1'))
    expect(await screen.findByLabelText('ลิงก์ใช้ครั้งเดียว')).toHaveValue(LINK.url)
  })

  it('an admin can reset their own password: warned about sign-out, then gets a button to open the link', async () => {
    const api = renderManager([meRow])
    fireEvent.click(openRowMenu('Admin A').items[1]!)
    const dialog = screen.getByRole('dialog', { name: 'รีเซ็ตรหัสผ่าน' })
    expect(dialog).toHaveTextContent('ระบบจะออกจากระบบทุกอุปกรณ์ของคุณทันที')
    fireEvent.click(within(dialog).getByRole('button', { name: 'สร้างลิงก์รีเซ็ต' }))
    await waitFor(() => expect(api.resetUserPassword).toHaveBeenCalledWith(ME.id))
    expect(await screen.findByRole('link', { name: 'ตั้งรหัสผ่านใหม่' })).toHaveAttribute('href', LINK.url)
    expect(api.listUsers).not.toHaveBeenCalled() // own session ended: no reload attempt
  })

  it('Revoke asks for confirmation (history kept); REAUTH_REQUIRED asks for the password and retries', async () => {
    let first = true
    const api = mockApi({
      revokeUser: vi.fn().mockImplementation(() => {
        if (first) {
          first = false
          return Promise.reject(new ApiError(401, 'REAUTH_REQUIRED', 'Please confirm your password to continue.'))
        }
        return Promise.resolve({ user: user({ status: 'REVOKED' }) })
      }),
    })
    renderManager([user()], api)
    fireEvent.click(openRowMenu('Somchai K').items[2]!)
    const confirm = screen.getByRole('dialog', { name: 'ยืนยันการยกเลิกการใช้งาน' })
    expect(confirm).toHaveTextContent('ประวัติการ deploy และ audit ยังเก็บไว้ครบ')
    expect(api.revokeUser).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByRole('button', { name: 'ยกเลิกการใช้งาน' }))
    const reauth = await screen.findByRole('dialog', { name: 'ยืนยันรหัสผ่าน' })
    fireEvent.change(within(reauth).getByLabelText('รหัสผ่าน'), { target: { value: 'my admin passphrase' } })
    fireEvent.click(within(reauth).getByRole('button', { name: 'ยืนยัน' }))
    await waitFor(() => expect(api.reauth).toHaveBeenCalledWith('my admin passphrase'))
    await waitFor(() => expect(api.revokeUser).toHaveBeenCalledTimes(2))
  })
})

describe('ลงทะเบียนผู้ใช้ (create)', () => {
  it('validates in Thai without calling the API, then creates and shows the one-time link', async () => {
    const api = renderManager([])
    fireEvent.click(screen.getByRole('button', { name: /ลงทะเบียนผู้ใช้/ }))
    const dialog = screen.getByRole('dialog', { name: 'ลงทะเบียนผู้ใช้' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'ลงทะเบียนผู้ใช้' }))
    expect(await within(dialog).findByText('กรุณากรอกชื่อที่แสดง')).toBeInTheDocument()
    expect(within(dialog).getByText('กรุณากรอกอีเมลบริษัท')).toBeInTheDocument()
    expect(within(dialog).getByText('ผู้ใช้ทั่วไปต้องระบุฝ่าย / แผนก')).toBeInTheDocument()
    expect(api.createUser).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText('ชื่อที่แสดง'), { target: { value: 'New Person' } })
    fireEvent.change(within(dialog).getByLabelText('อีเมลบริษัท'), { target: { value: 'not-an-email' } })
    fireEvent.change(within(dialog).getByLabelText('ฝ่าย / แผนก'), { target: { value: 'DTD' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'ลงทะเบียนผู้ใช้' }))
    expect(await within(dialog).findByText('รูปแบบอีเมลไม่ถูกต้อง')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('อีเมลบริษัท'), { target: { value: 'new@test.example' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'ลงทะเบียนผู้ใช้' }))
    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith({ displayName: 'New Person', email: 'new@test.example', department: 'DTD', role: 'USER' }))
    expect(await screen.findByLabelText('ลิงก์ใช้ครั้งเดียว')).toHaveValue(LINK.url)
  })

  it('server errors are shown in Thai inside the form', async () => {
    const api = mockApi({ createUser: vi.fn().mockRejectedValue(new ApiError(409, 'EMAIL_IN_USE', 'An active account already uses this email address.')) })
    renderManager([], api)
    fireEvent.click(screen.getByRole('button', { name: /ลงทะเบียนผู้ใช้/ }))
    const dialog = screen.getByRole('dialog', { name: 'ลงทะเบียนผู้ใช้' })
    fireEvent.change(within(dialog).getByLabelText('ชื่อที่แสดง'), { target: { value: 'Dup' } })
    fireEvent.change(within(dialog).getByLabelText('อีเมลบริษัท'), { target: { value: 'dup@test.example' } })
    fireEvent.change(within(dialog).getByLabelText('ฝ่าย / แผนก'), { target: { value: 'DTD' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'ลงทะเบียนผู้ใช้' }))
    expect(await within(dialog).findByText('อีเมลนี้มีบัญชีที่ใช้งานอยู่แล้ว')).toBeInTheDocument()
  })
})

describe('role-aware layout', () => {
  it('ordinary users have no enrollment controls or admin navigation', () => {
    const meUser: MeDTO = { user: { displayName: 'Somchai', email: 'somchai@test.example', role: 'USER', department: DTD }, csrfToken: 'c' }
    render(<DeployStudioApp me={meUser} departments={[DTD]} initialWebsites={[]} sitesHost="sites.localhost" api={mockApi()} />)
    expect(screen.queryByRole('link', { name: 'จัดการบัญชีผู้ใช้งาน' })).toBeNull()
    expect(screen.queryByRole('button', { name: /ลงทะเบียนผู้ใช้/ })).toBeNull()
    expect(screen.queryByRole('link', { name: 'เปลี่ยนรหัสผ่าน' })).toBeNull() // passwords are reset by an admin
  })
})

describe('status switch', () => {
  it('toggles ACTIVE ↔ DISABLED through the existing update API; own account and last admin are locked', async () => {
    const rows = [user(), user({ id: 'u-off', displayName: 'Off User', status: 'DISABLED' }), meRow]
    const api = renderManager(rows, mockApi({ listUsers: vi.fn().mockResolvedValue(list(rows, { activeAdminCount: 1 })) }), { activeAdminCount: 1 })
    const on = screen.getByRole('switch', { name: /Somchai K/ })
    expect(on).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(on)
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith('u-1', { status: 'DISABLED' }))
    const off = screen.getByRole('switch', { name: /Off User/ })
    expect(off).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(off)
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith('u-off', { status: 'ACTIVE' }))
    expect(screen.getByRole('switch', { name: /Admin A/ })).toBeDisabled() // self + last active admin
    expect(within(screen.getByTestId('enroll-table')).queryByText(/Online|Offline/)).toBeNull() // switch only, no text
  })

  it('asks for the password when the server requires re-authentication, then retries', async () => {
    let first = true
    const api = mockApi({
      updateUser: vi.fn().mockImplementation(() => {
        if (first) {
          first = false
          return Promise.reject(new ApiError(401, 'REAUTH_REQUIRED', 'Please confirm your password to continue.'))
        }
        return Promise.resolve({ user: user({ status: 'DISABLED' }) })
      }),
    })
    renderManager([user()], api)
    fireEvent.click(screen.getByRole('switch', { name: /Somchai K/ }))
    const reauth = await screen.findByRole('dialog', { name: 'ยืนยันรหัสผ่าน' })
    fireEvent.change(within(reauth).getByLabelText('รหัสผ่าน'), { target: { value: 'my admin passphrase' } })
    fireEvent.click(within(reauth).getByRole('button', { name: 'ยืนยัน' }))
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledTimes(2))
  })
})

describe('header account controls', () => {
  it('one row: name, Light/Dark, sign out — no change-password button', async () => {
    const { UserControls } = await import('@/components/UserControls')
    render(<UserControls csrfToken="c" label="Local Admin · Admin" />)
    const row = screen.getByTestId('user-controls')
    const order = [...row.children].map((el) => (el.textContent ?? '').trim())
    expect(order[0]).toBe('Local Admin · Admin')
    expect(row.querySelector('.theme-switch')).toBe(row.children[1])
    expect(within(row).getByRole('button', { name: 'ออกจากระบบ' })).toBe(row.children[2])
    expect(within(row).queryByText('เปลี่ยนรหัสผ่าน')).toBeNull()
  })
})

describe('Sign-in form', () => {
  it('posts email + password and shows the generic error on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<LoginForm />)
    fireEvent.change(screen.getByLabelText(/corporate email/i), { target: { value: 'a@test.example' } })
    fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'wrong but long enough' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'a@test.example', password: 'wrong but long enough' }) }))
    expect(screen.getByLabelText(/^password$/i)).toHaveValue('')
    vi.unstubAllGlobals()
  })
})
