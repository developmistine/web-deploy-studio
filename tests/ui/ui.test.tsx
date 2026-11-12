import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeToggle, THEME_KEY } from '@/components/ThemeToggle'
import { UploadDropzone } from '@/components/UploadDropzone'
import { UploadWorkspace } from '@/components/UploadWorkspace'
import { DeployStudioApp } from '@/components/DeployStudioApp'
import type { ApiClient } from '@/lib/api-client'
import type { DepartmentDTO, DeploymentDTO, MeDTO, WebsiteDTO } from '@/lib/types'

afterEach(cleanup)
beforeEach(() => {
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  document.documentElement.dataset.theme = 'light'
})

const DTD: DepartmentDTO = { id: 'd-dtd', code: 'dtd', name: 'DTD' }
const ERP: DepartmentDTO = { id: 'd-erp', code: 'erp', name: 'ERP' }

function dep(over: Partial<DeploymentDTO> = {}): DeploymentDTO {
  return {
    id: 'dep-1', websiteId: 'w-1', version: 1, status: 'UPLOADED', isActive: false, previewAvailable: false, previewViewed: false,
    uploadedBy: 'Dev', originalFilename: 'site.zip', fileCount: 3, sizeBytes: 100, errorCode: null, errorMessage: null, contentFindings: [], activeJob: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), deployedAt: null, ...over,
  }
}

function mockApi(overrides: Partial<Record<keyof ApiClient, unknown>> = {}): ApiClient {
  const api = {
    websites: vi.fn().mockResolvedValue({ websites: [] }),
    createWebsite: vi.fn().mockResolvedValue({ website: { id: 'w-1' } }),
    uploadDeployment: vi.fn().mockResolvedValue({ deployment: dep() }),
    deployment: vi.fn().mockResolvedValue({ deployment: dep({ status: 'PREVIEW_READY', previewAvailable: true }) }),
    openPreview: vi.fn().mockResolvedValue({ preview: { status: 'READY', launchUrl: 'http://abc.preview.localhost:8080/__ds_auth?t=x', expiresAt: new Date().toISOString() } }),
    promote: vi.fn().mockResolvedValue({ deployment: dep({ status: 'DEPLOYING' }) }),
    deployments: vi.fn().mockResolvedValue({ deployments: [] }),
    logs: vi.fn().mockResolvedValue({ logs: [] }),
    rollback: vi.fn(),
    logout: vi.fn(),
    departments: vi.fn(),
    ...overrides,
  }
  return api as unknown as ApiClient
}

const file = (name = 'site.zip') => new File(['PK'], name, { type: 'application/zip' })

describe('Light/Dark mode (preserved from prototype)', () => {
  it('toggles the theme and persists it in localStorage', () => {
    render(<ThemeToggle />)
    const btn = screen.getByRole('button', { name: /toggle color theme/i })
    expect(btn).toHaveTextContent('Dark')
    fireEvent.click(btn)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem(THEME_KEY)).toBe('dark')
    expect(btn).toHaveTextContent('Light')
    fireEvent.click(btn)
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('Drag & Drop', () => {
  it('accepts dropped files and highlights while dragging', () => {
    const onFiles = vi.fn()
    render(<UploadDropzone onFiles={onFiles} />)
    const zone = screen.getByTestId('dropzone')
    fireEvent.dragOver(zone, { dataTransfer: { files: [] } })
    expect(zone.className).toContain('dragover')
    fireEvent.drop(zone, { dataTransfer: { files: [file()] } })
    expect(onFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'site.zip' })])
    expect(zone.className).not.toContain('dragover')
  })

  it('Browse files opens the file picker', () => {
    render(<UploadDropzone onFiles={vi.fn()} />)
    const input = screen.getByTestId('file-input') as HTMLInputElement
    const click = vi.spyOn(input, 'click')
    fireEvent.click(screen.getByRole('button', { name: /browse files/i }))
    expect(click).toHaveBeenCalled()
  })
})

describe('Preview gates Deploy to Production', () => {
  it('shows the validated preview on the isolated origin and enables Deploy only after it is ready and loaded', async () => {
    const api = mockApi()
    render(<UploadWorkspace api={api} departments={[DTD]} websites={[]} isAdmin={false} defaultDepartment="DTD" sitesHost="sites.localhost" onWebsitesChanged={vi.fn()} pollMs={10} />)
    expect(screen.queryByRole('button', { name: /deploy to production/i })).toBeNull()
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file()] } })
    // Upload starts immediately; the dropzone is replaced by progress (no separate Preview button).
    expect(screen.queryByTestId('dropzone')).toBeNull()
    expect(screen.queryByRole('button', { name: /^preview$/i })).toBeNull()

    await waitFor(() => expect(screen.getByTitle('Website preview').getAttribute('src') ?? '').toContain('.preview.localhost'), { timeout: 3000 })
    const frame = screen.getByTitle('Website preview') as HTMLIFrameElement
    expect(frame.getAttribute('src')).not.toContain('localhost:3000') // never the management origin
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts')
    expect(frame.getAttribute('sandbox')).not.toMatch(/allow-popups|allow-top-navigation/) // popups bypass CSP (R-24)
    expect(frame.hasAttribute('srcdoc')).toBe(false)
    expect(api.createWebsite).toHaveBeenCalledWith({ department: 'DTD', siteName: 'my-dashboard' })

    const deploy = screen.getByRole('button', { name: /deploy to production/i })
    expect(deploy).toBeDisabled()
    act(() => {
      fireEvent.load(screen.getByTitle('Website preview'))
    })
    expect(screen.getByRole('button', { name: /deploy to production/i })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: /deploy to production/i }))
    await waitFor(() => expect(api.promote).toHaveBeenCalledWith('dep-1'))
  })

  it('shows a failure and never enables Deploy when validation fails', async () => {
    const api = mockApi({ deployment: vi.fn().mockResolvedValue({ deployment: dep({ status: 'FAILED', errorMessage: 'The uploaded files failed validation.' }) }) })
    render(<UploadWorkspace api={api} departments={[DTD]} websites={[]} isAdmin={false} defaultDepartment="DTD" sitesHost="sites.localhost" onWebsitesChanged={vi.fn()} pollMs={10} />)
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file()] } })
    expect(await screen.findByText('The uploaded files failed validation.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /change file/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /deploy to production/i })).toBeNull()
    expect(api.promote).not.toHaveBeenCalled()
  })

  it('replaces the dropzone with the preview and "Change file" picks new files that start a new preview', async () => {
    const api = mockApi()
    render(<UploadWorkspace api={api} departments={[DTD]} websites={[]} isAdmin={false} defaultDepartment="DTD" sitesHost="sites.localhost" onWebsitesChanged={vi.fn()} pollMs={10} />)
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file('demo-dashboard.html')] } })
    await waitFor(() => expect(screen.getByTitle('Website preview').getAttribute('src') ?? '').toContain('.preview.localhost'), { timeout: 3000 })
    expect(screen.queryByTestId('dropzone')).toBeNull()
    expect(screen.getByText(/demo-dashboard\.html/)).toBeInTheDocument()

    const picker = screen.getByTestId('change-file-input') as HTMLInputElement
    const click = vi.spyOn(picker, 'click')
    fireEvent.click(screen.getByRole('button', { name: /change file/i }))
    expect(click).toHaveBeenCalled()
    fireEvent.change(picker, { target: { files: [file('v2.zip')] } })
    await waitFor(() => expect(api.uploadDeployment).toHaveBeenCalledTimes(2))
  })

  it('an invalid site name keeps the dropzone and uploads nothing', async () => {
    const api = mockApi()
    render(<UploadWorkspace api={api} departments={[DTD]} websites={[]} isAdmin={false} defaultDepartment="DTD" sitesHost="sites.localhost" onWebsitesChanged={vi.fn()} pollMs={10} />)
    fireEvent.change(screen.getByLabelText(/site name/i), { target: { value: '-bad-' } })
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file()] } })
    expect(screen.getByTestId('dropzone')).toBeInTheDocument()
    expect(api.createWebsite).not.toHaveBeenCalled()
    expect(api.uploadDeployment).not.toHaveBeenCalled()
  })
})

const meUser: MeDTO = { user: { displayName: 'Somchai', email: 'somchai@test.example', role: 'USER', department: DTD }, csrfToken: 'c' }
const meAdmin: MeDTO = { user: { displayName: 'Admin A', email: 'admin.a@test.example', role: 'ADMIN', department: null }, csrfToken: 'c' }
const site = (d: DepartmentDTO): WebsiteDTO => ({
  id: `w-${d.code}`, department: d, siteName: 'sales', logicalName: `${d.code}.sales`, hostname: `${d.code}-sales.sites.localhost`, url: 'http://x/',
  activeDeployment: dep({ status: 'LIVE', isActive: true, version: 2 }), latestDeployment: dep({ status: 'LIVE', isActive: true, version: 2 }),
  productionChangeInProgress: false, createdAt: '', updatedAt: '',
})

describe('role-based UI (presentation only; the server enforces)', () => {
  it('ordinary users see their department, a locked department field, and no admin controls', () => {
    render(<DeployStudioApp me={meUser} departments={[DTD]} initialWebsites={[site(DTD)]} sitesHost="sites.localhost" api={mockApi()} />)
    expect(screen.getByRole('tab', { name: /update website/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /my department/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /all deployments/i })).toBeNull()
    expect(screen.getByLabelText('Department')).toBeDisabled()
    expect(screen.getByLabelText('Department')).toHaveValue('DTD')
    // The signed-in name is shown in the page header (BrandHeader/UserControls), covered in tests/ui/admin.test.tsx.
    fireEvent.click(screen.getByRole('tab', { name: /my department/i }))
    expect(screen.queryByLabelText('Department filters')).toBeNull()
    expect(screen.getByTestId('website-card')).toHaveTextContent('dtd.sales')
  })

  it('administrators see All deployments without filters; a department opens as its own page', async () => {
    render(<DeployStudioApp me={meAdmin} departments={[DTD, ERP]} initialWebsites={[site(DTD), site(ERP)]} sitesHost="sites.localhost" api={mockApi()} />)
    expect(screen.getByLabelText('Department')).toBeEnabled() // admins may target any department
    fireEvent.click(screen.getByRole('tab', { name: /all deployments/i }))
    expect(screen.queryByLabelText('Department filters')).toBeNull()
    expect(screen.getByTestId('admin-table')).toHaveTextContent('dtd.sales')
    expect(screen.getByTestId('admin-table')).toHaveTextContent('erp.sales')

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open ERP' }))
    })
    expect(window.location.search).toBe('?site=w-erp')
    expect(screen.queryByTestId('admin-table')).toBeNull() // replaces the list, not appended below it
    expect(screen.getByTestId('website-card')).toHaveTextContent('erp.sales')

    act(() => {
      fireEvent.click(screen.getByText('← All deployments'))
    })
    expect(window.location.search).toBe('')
    expect(screen.getByTestId('admin-table')).toBeInTheDocument()
  })

  it('no Delete buttons are rendered anywhere and there is no role selector', () => {
    const { container } = render(<DeployStudioApp me={meAdmin} departments={[DTD, ERP]} initialWebsites={[site(DTD), site(ERP)]} sitesHost="sites.localhost" api={mockApi()} />)
    fireEvent.click(screen.getByRole('tab', { name: /all deployments/i }))
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: /^open /i })[0]!)
    })
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    expect(container.textContent).not.toMatch(/\bDelete\b/)
    expect(container.querySelector('select')).toBeNull()
  })

  it('unassigned users cannot start an upload', () => {
    const me: MeDTO = { user: { ...meUser.user, department: null }, csrfToken: 'c' }
    render(<DeployStudioApp me={me} departments={[]} initialWebsites={[]} sitesHost="sites.localhost" api={mockApi()} />)
    expect(screen.getByText(/ยังไม่ได้รับการกำหนดฝ่าย/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /browse files/i })).toBeDisabled()
  })
})

describe('suspicious-script findings in the upload flow', () => {
  it('Deploy stays locked until warnings are acknowledged', async () => {
    const finding = { severity: 'medium' as const, rule: 'external-script', path: 'index.html', line: 3, message: 'external script' }
    const api = mockApi({ deployment: vi.fn().mockResolvedValue({ deployment: dep({ status: 'PREVIEW_READY', previewAvailable: true, contentFindings: [finding] }) }) })
    render(<UploadWorkspace api={api} departments={[DTD]} websites={[]} isAdmin={false} defaultDepartment="DTD" sitesHost="sites.localhost" onWebsitesChanged={vi.fn()} pollMs={10} />)
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file()] } })
    await waitFor(() => expect(screen.getByTestId('content-findings')).toHaveTextContent('index.html:3'), { timeout: 3000 })
    act(() => {
      fireEvent.load(screen.getByTitle('Website preview'))
    })
    expect(screen.getByRole('button', { name: /deploy to production/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: /deploy to production/i })).toBeEnabled()
  })

  it('a blocked upload lists the findings and offers Change file', async () => {
    const finding = { severity: 'high' as const, rule: 'crypto-miner', path: 'm.js', line: 1, message: 'crypto miner' }
    const api = mockApi({ deployment: vi.fn().mockResolvedValue({ deployment: dep({ status: 'FAILED', errorCode: 'SUSPICIOUS_CONTENT', errorMessage: 'blocked', contentFindings: [finding] }) }) })
    render(<UploadWorkspace api={api} departments={[DTD]} websites={[]} isAdmin={false} defaultDepartment="DTD" sitesHost="sites.localhost" onWebsitesChanged={vi.fn()} pollMs={10} />)
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file()] } })
    await waitFor(() => expect(screen.getByTestId('content-findings')).toHaveTextContent('m.js:1'), { timeout: 3000 })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByRole('button', { name: /change file/i })).toBeInTheDocument()
  })
})

describe('Light/Dark icon', () => {
  it('renders a sun and a moon; CSS shows the one matching the theme on <html>', () => {
    render(<ThemeToggle />)
    expect(screen.getByTestId('icon-sun')).toHaveClass('icon-sun')
    expect(screen.getByTestId('icon-moon')).toHaveClass('icon-moon')
  })
})

describe('rename an existing website from the Site name field', () => {
  const existing = (): WebsiteDTO => ({
    id: 'w-dtd', department: DTD, siteName: 'sales', logicalName: 'dtd.sales', hostname: 'dtd-sales.sites.localhost', url: 'http://x/',
    activeDeployment: null, latestDeployment: null, productionChangeInProgress: false, createdAt: '', updatedAt: '',
  })

  /** Drops a file and waits until Deploy is enabled (preview ready + loaded). */
  async function toPreview() {
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file()] } })
    await waitFor(() => expect(screen.getByTitle('Website preview').getAttribute('src') ?? '').toContain('.preview.localhost'), { timeout: 3000 })
    act(() => {
      fireEvent.load(screen.getByTitle('Website preview'))
    })
  }

  it('a changed name is confirmed when deploying: confirm renames and then deploys; cancel deploys nothing', async () => {
    const order: string[] = []
    const api = mockApi({
      renameWebsite: vi.fn().mockImplementation(async () => {
        order.push('rename')
        return { website: { ...existing(), siteName: 'reports', logicalName: 'dtd.reports', hostname: 'dtd-reports.sites.localhost' } }
      }),
      promote: vi.fn().mockImplementation(async () => {
        order.push('promote')
        return { deployment: dep({ status: 'DEPLOYING' }) }
      }),
    })
    render(<UploadWorkspace api={api} departments={[DTD]} websites={[existing()]} isAdmin={false} defaultDepartment="DTD" sitesHost="sites.localhost" onWebsitesChanged={vi.fn()} pollMs={10} />)
    const input = screen.getByLabelText(/site name/i)
    expect(input).toBeEnabled()
    fireEvent.change(input, { target: { value: 'reports' } })
    fireEvent.blur(input)
    expect(screen.queryByRole('dialog')).toBeNull() // nothing happens until Deploy
    expect(screen.getByText(/จะมีผลเมื่อกด Deploy/)).toBeInTheDocument()

    await toPreview()
    fireEvent.click(screen.getByRole('button', { name: /deploy to production/i }))
    let dialog = screen.getByRole('dialog', { name: 'เปลี่ยนชื่อเว็บไซต์และ Deploy?' })
    expect(dialog).toHaveTextContent('dtd.sales → dtd.reports')
    expect(dialog).toHaveTextContent('dtd-reports.sites.localhost')
    fireEvent.click(within(dialog).getByRole('button', { name: 'ยกเลิก' }))
    expect(screen.getByLabelText(/site name/i)).toHaveValue('sales')
    expect(api.renameWebsite).not.toHaveBeenCalled()
    expect(api.promote).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/site name/i), { target: { value: 'reports' } })
    fireEvent.click(screen.getByRole('button', { name: /deploy to production/i }))
    dialog = screen.getByRole('dialog', { name: 'เปลี่ยนชื่อเว็บไซต์และ Deploy?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'เปลี่ยนชื่อและ Deploy' }))
    await waitFor(() => expect(order).toEqual(['rename', 'promote']))
    expect(api.renameWebsite).toHaveBeenCalledWith('w-dtd', 'reports')
  })

  it('without a name change, Deploy goes straight through (no dialog)', async () => {
    const api = mockApi({ renameWebsite: vi.fn() })
    render(<UploadWorkspace api={api} departments={[DTD]} websites={[existing()]} isAdmin={false} defaultDepartment="DTD" sitesHost="sites.localhost" onWebsitesChanged={vi.fn()} pollMs={10} />)
    await toPreview()
    fireEvent.click(screen.getByRole('button', { name: /deploy to production/i }))
    await waitFor(() => expect(api.promote).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.renameWebsite).not.toHaveBeenCalled()
  })

  it('an invalid name shows the inline rule and opens no dialog; the same name closes nothing', () => {
    const api = mockApi({ renameWebsite: vi.fn() })
    render(<UploadWorkspace api={api} departments={[DTD]} websites={[existing()]} isAdmin={false} defaultDepartment="DTD" sitesHost="sites.localhost" onWebsitesChanged={vi.fn()} pollMs={10} />)
    const input = screen.getByLabelText(/site name/i)
    fireEvent.change(input, { target: { value: '-bad-' } })
    fireEvent.blur(input)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText(/ใช้ตัวอักษร a-z/)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: 'sales' } })
    fireEvent.blur(input)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('upload failure reasons (Thai, on the upload page)', () => {
  it('a rejected upload shows the specific reason and the file', async () => {
    const { ApiError } = await import('@/lib/api-client')
    const api = mockApi({ uploadDeployment: vi.fn().mockRejectedValue(new ApiError(422, 'UPLOAD_REJECTED', 'The uploaded files were rejected.', { reason: 'CONTENT_MISMATCH', path: 'logo.png' })) })
    render(<UploadWorkspace api={api} departments={[DTD]} websites={[]} isAdmin={false} defaultDepartment="DTD" sitesHost="sites.localhost" onWebsitesChanged={vi.fn()} pollMs={10} />)
    fireEvent.drop(screen.getByTestId('dropzone'), { dataTransfer: { files: [file()] } })
    expect(await screen.findByText('อัปโหลดไม่ผ่าน')).toBeInTheDocument()
    expect(screen.getByText('ไฟล์ไม่ผ่านการตรวจสอบ: เนื้อหาไฟล์ไม่ตรงกับนามสกุลไฟล์ (ไฟล์: logo.png)')).toBeInTheDocument()
  })

  it('a worker-side failure code is explained in Thai', async () => {
    const { failureMessageTh } = await import('@/lib/i18n/upload-th')
    expect(failureMessageTh('UPLOAD_REJECTED:MISSING_INDEX')).toMatch(/^ไฟล์ไม่ผ่านการตรวจสอบ: ไม่พบ index.html/)
    expect(failureMessageTh('SUSPICIOUS_CONTENT')).toMatch(/สคริปต์ที่น่าสงสัย/)
    expect(failureMessageTh('SOMETHING_NEW')).toMatch(/เว็บไซต์เดิมยังออนไลน์/)
  })
})

describe('My department (USER): latest version only', () => {
  it('shows the latest version with a Preview button, no history list and no status badges', async () => {
    const latest = dep({ id: 'dep-4', version: 4, status: 'PREVIEW_READY', previewAvailable: true, uploadedBy: 'tester', originalFilename: 'delivery-dashboard.html' })
    const w = { ...site(DTD), latestDeployment: latest }
    const api = mockApi({ deployments: vi.fn().mockResolvedValue({ deployments: [latest, dep({ id: 'dep-3', version: 3, status: 'LIVE', isActive: true })] }) })
    render(<DeployStudioApp me={meUser} departments={[DTD]} initialWebsites={[w]} sitesHost="sites.localhost" api={api} />)
    fireEvent.click(screen.getByRole('tab', { name: /my department/i }))
    const box = screen.getByTestId('latest-version')
    expect(box).toHaveTextContent('v4')
    expect(within(box).getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.queryByText('Version history')).toBeNull()
    expect(screen.queryByText(/Preview ready/)).toBeNull()
    expect(screen.queryByRole('button', { name: /roll back/i })).toBeNull()
    expect(api.deployments).not.toHaveBeenCalled()
  })

  it('a failed latest version shows why', () => {
    const latest = dep({ id: 'dep-5', version: 5, status: 'FAILED', errorCode: 'UPLOAD_REJECTED:MISSING_INDEX', errorMessage: 'ไฟล์ไม่ผ่านการตรวจสอบ: ไม่พบ index.html' })
    render(<DeployStudioApp me={meUser} departments={[DTD]} initialWebsites={[{ ...site(DTD), latestDeployment: latest }]} sitesHost="sites.localhost" api={mockApi()} />)
    fireEvent.click(screen.getByRole('tab', { name: /my department/i }))
    expect(within(screen.getByTestId('latest-version')).getByRole('alert')).toHaveTextContent('ไม่ผ่าน: ไฟล์ไม่ผ่านการตรวจสอบ: ไม่พบ index.html')
    expect(within(screen.getByTestId('latest-version')).queryByRole('button', { name: 'Preview' })).toBeNull()
  })
})
