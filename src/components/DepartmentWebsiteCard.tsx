import type { WebsiteDTO } from '@/lib/types'
import { DeploymentStatus, DeploymentStatusPill } from '@/components/DeploymentStatus'
import { LocalTime } from '@/components/LocalTime'

/** Current website of one department: address, active version and production status. */
/** `hideLatest`: USER My department shows the latest version separately (no status badge here). */
export function DepartmentWebsiteCard({ website, hideLatest }: { website: WebsiteDTO; hideLatest?: boolean }) {
  const active = website.activeDeployment
  const latest = website.latestDeployment
  return (
    <article className="record" data-testid="website-card">
      <div className="record-body">
        <div className="record-title">
          <span className="record-domain">{website.logicalName}</span>
          <span className="pill">{website.department.name}</span>
          {active ? <DeploymentStatusPill text="Live" tone="ready" /> : <DeploymentStatusPill text="Not live yet" />}
          {website.productionChangeInProgress ? <DeploymentStatusPill text="Production change in progress" /> : null}
        </div>
        <div className="meta">
          {active ? (
            <>
              <a className="preview-link" href={website.url} target="_blank" rel="noopener noreferrer">
                {website.hostname}
              </a>
              {` · v${active.version} · deployed `}
              <LocalTime iso={active.deployedAt} />
              {` · uploaded by ${active.uploadedBy}`}
            </>
          ) : (
            <>{website.hostname} · no version has been deployed to production yet</>
          )}
        </div>
      </div>
      {!hideLatest && latest && latest.id !== active?.id ? (
        <div className="record-actions">
          <span className="meta">Latest upload v{latest.version}</span>
          <DeploymentStatus status={latest.status} />
        </div>
      ) : null}
    </article>
  )
}
