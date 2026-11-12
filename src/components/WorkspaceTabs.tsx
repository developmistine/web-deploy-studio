'use client'

export type TabId = 'upload' | 'list'

type Props = {
  active: TabId
  onChange: (tab: TabId) => void
  uploadLabel: string
  listLabel: string
  listCount?: number
}

export function WorkspaceTabs({ active, onChange, uploadLabel, listLabel, listCount }: Props) {
  return (
    <div className="tabs" role="tablist">
      <button
        type="button"
        className={`tab${active === 'upload' ? ' active' : ''}`}
        id="tab-upload"
        role="tab"
        aria-selected={active === 'upload'}
        aria-controls="upload-workspace"
        onClick={() => onChange('upload')}
      >
        {uploadLabel}
      </button>
      <button
        type="button"
        className={`tab${active === 'list' ? ' active' : ''}`}
        id="tab-list"
        role="tab"
        aria-selected={active === 'list'}
        aria-controls="list-workspace"
        onClick={() => onChange('list')}
      >
        {listLabel}
        {listCount !== undefined ? <span> ({listCount})</span> : null}
      </button>
    </div>
  )
}
