'use client'

import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'
import type { DepartmentDTO, MeDTO, WebsiteDTO } from '@/lib/types'
import { ApiClient } from '@/lib/api-client'
import { WorkspaceTabs, type TabId } from '@/components/WorkspaceTabs'
import { UploadWorkspace } from '@/components/UploadWorkspace'
import { DepartmentWebsiteCard } from '@/components/DepartmentWebsiteCard'
import { DeploymentHistory } from '@/components/DeploymentHistory'
import { LatestVersion } from '@/components/LatestVersion'
import { AdminDeploymentTable } from '@/components/AdminDeploymentTable'

type Props = {
  me: MeDTO
  departments: DepartmentDTO[]
  initialWebsites: WebsiteDTO[]
  sitesHost: string
  /** Test seam; defaults to the real browser client. */
  api?: ApiClient
}

// Admin department page lives in the URL (?site=<websiteId>) so it is its own page: reload and Back work.
const subscribeLocation = (cb: () => void) => {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}
const siteFromLocation = () => new URLSearchParams(window.location.search).get('site')
function navigateSite(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('site', id)
  else url.searchParams.delete('site')
  window.history.pushState(null, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo?.({ top: 0 })
}

/**
 * Client shell. Role-based rendering here is only presentation — every API call is authorized
 * server-side from the session (role + department), never from what this component sends.
 */
export function DeployStudioApp({ me, departments, initialWebsites, sitesHost, api: injected }: Props) {
  const api = useMemo(() => injected ?? new ApiClient(me.csrfToken), [injected, me.csrfToken])
  const isAdmin = me.user.role === 'ADMIN'
  const [tab, setTab] = useState<TabId>('upload')
  const [websites, setWebsites] = useState(initialWebsites)
  const selectedId = useSyncExternalStore(subscribeLocation, siteFromLocation, () => null)
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(async () => {
    try {
      setWebsites((await api.websites()).websites)
      setRefreshKey((k) => k + 1)
    } catch {
      // keep last known state; individual actions surface their own errors
    }
  }, [api])

  const ownDept = me.user.department
  const defaultDepartment = ownDept?.name ?? (isAdmin ? departments[0]?.name ?? '' : '')
  const ownWebsite = ownDept ? websites.find((w) => w.department.id === ownDept.id) ?? null : null
  const uploadDeptWebsite = ownDept ? ownWebsite : websites.find((w) => w.department.name === defaultDepartment)
  const uploadLabel = isAdmin ? '+ New deploy / Update' : uploadDeptWebsite ? 'Update website' : '+ New deploy'
  const listLabel = isAdmin ? 'All deployments' : 'My department'
  const selected = isAdmin ? websites.find((w) => w.id === selectedId) ?? null : ownWebsite
  // An open department page is part of the list workspace; switching tabs closes it.
  const activeTab: TabId = isAdmin && selected ? 'list' : tab
  const changeTab = (t: TabId) => {
    if (selectedId) navigateSite(null)
    setTab(t)
  }

  return (
    <>
      <div className="navline" aria-label="Workspace navigation">
        <WorkspaceTabs active={activeTab} onChange={changeTab} uploadLabel={uploadLabel} listLabel={listLabel} listCount={isAdmin ? websites.length : undefined} />
      </div>

      {activeTab === 'upload' ? (
        <UploadWorkspace
          api={api}
          departments={departments}
          websites={websites}
          isAdmin={isAdmin}
          defaultDepartment={defaultDepartment}
          sitesHost={sitesHost}
          onWebsitesChanged={refresh}
        />
      ) : (
        <section className="panel workspace active" id="list-workspace" role="tabpanel" aria-labelledby="tab-list" aria-label="Deployment overview">
          {isAdmin && selected ? (
            <>
              <button type="button" className="linkish back-link" onClick={() => navigateSite(null)}>
                ← All deployments
              </button>
              <div className="deployment-header">
                <div>
                  <h2 id="list-title">{selected.department.name}</h2>
                  <p className="subtle">เว็บไซต์และประวัติ Deployment ของฝ่าย {selected.department.name}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="deployment-header">
              <div>
                <h2 id="list-title">{listLabel}</h2>
                <p className="subtle" id="list-desc">
                  {isAdmin
                    ? 'Admin เห็นเว็บไซต์และสถานะ Deployment ของทุกฝ่าย'
                    : ownDept
                      ? `เว็บไซต์ของฝ่าย ${ownDept.name} · ทุกคนในฝ่ายใช้เว็บไซต์เดียวกัน`
                      : 'บัญชีของคุณยังไม่ได้รับการกำหนดฝ่าย กรุณาติดต่อผู้ดูแล'}
                </p>
              </div>
              <span className="status" id="list-count">
                {isAdmin ? `${websites.length} sites` : ownWebsite ? '1 site' : '0 sites'}
              </span>
            </div>
          )}

          {isAdmin && !selected ? <AdminDeploymentTable departments={departments} websites={websites} onOpen={navigateSite} /> : null}

          {selected ? (
            <div className="section-gap">
              <div className="records">
                <DepartmentWebsiteCard website={selected} hideLatest={!isAdmin} />
              </div>
              {isAdmin ? (
                <DeploymentHistory key={selected.id} api={api} website={selected} onChanged={refresh} refreshKey={refreshKey} />
              ) : (
                <LatestVersion api={api} website={selected} />
              )}
            </div>
          ) : !isAdmin ? (
            <div className="empty section-gap">ยังไม่มีเว็บไซต์ของฝ่ายนี้ · เริ่มได้ที่แท็บ “+ New deploy”</div>
          ) : null}
        </section>
      )}
    </>
  )
}
