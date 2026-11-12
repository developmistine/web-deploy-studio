'use client'

type Props = {
  /** True only when the server reports PREVIEW_READY and the preview frame has loaded. */
  ready: boolean
  busy: boolean
  onDeploy: () => void
}

export function DeployButton({ ready, busy, onDeploy }: Props) {
  return (
    <div className="deploy-row">
      <p>Preview รันแยกจาก Production · Deploy จะสลับ traffic หลังผ่าน readiness check เท่านั้น</p>
      <button id="deploy-btn" type="button" className="primary" disabled={!ready || busy} onClick={onDeploy}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="m12 3 7 8-7 2-2 7-3-8-4-2 9-7Z" />
        </svg>
        {busy ? 'Deploying…' : 'Deploy to Production'}
      </button>
    </div>
  )
}
