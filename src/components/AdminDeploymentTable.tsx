'use client'

import type { DepartmentDTO, WebsiteDTO } from '@/lib/types'
import { DeploymentStatus, DeploymentStatusPill } from '@/components/DeploymentStatus'
import { LocalTime } from '@/components/LocalTime'

type Props = {
  departments: DepartmentDTO[]
  websites: WebsiteDTO[]
  /** Opens the department's own page (website + history). */
  onOpen: (websiteId: string) => void
}

/** ADMIN only: current website and deployment state for every department. */
export function AdminDeploymentTable({ departments, websites, onOpen }: Props) {
  return (
    <div className="records section-gap" data-testid="admin-table">
      {departments.map((dept) => {
        const w = websites.find((x) => x.department.id === dept.id)
        return (
          <article key={dept.id} className="record">
            <div className="record-body">
              <div className="record-title">
                <span className="pill">{dept.name}</span>
                {w ? <span className="record-domain">{w.logicalName}</span> : <span className="meta">No website yet</span>}
                {w?.activeDeployment ? <DeploymentStatusPill text={`Live v${w.activeDeployment.version}`} tone="ready" /> : null}
                {w?.latestDeployment && w.latestDeployment.id !== w.activeDeployment?.id ? <DeploymentStatus status={w.latestDeployment.status} /> : null}
                {w?.productionChangeInProgress ? <DeploymentStatusPill text="Production change in progress" /> : null}
              </div>
              {w ? (
                <div className="meta">
                  {w.hostname} · last deployed <LocalTime iso={w.activeDeployment?.deployedAt} />
                </div>
              ) : null}
            </div>
            {w ? (
              <div className="record-actions">
                <button type="button" className="sketch mini" onClick={() => onOpen(w.id)} aria-label={`Open ${dept.name}`}>
                  Open
                </button>
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
