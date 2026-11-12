'use client'

import { useSyncExternalStore } from 'react'
import { formatDate } from '@/lib/format'

const noop = () => () => {}

/**
 * Times are formatted in the browser only (the viewer's time zone). The server render and the hydration pass emit
 * nothing inside <time>, so server (UTC) and browser (local) output can never mismatch.
 */
export function LocalTime({ iso }: { iso: string | null | undefined }) {
  const inBrowser = useSyncExternalStore(noop, () => true, () => false)
  if (!iso) return <>—</>
  return <time dateTime={iso}>{inBrowser ? formatDate(iso) : ''}</time>
}
