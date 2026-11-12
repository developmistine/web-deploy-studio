import { getConfig } from '@/server/config'

/**
 * Hostname scheme: "<dept>-<site>.<sites base host>", e.g. dtd-sales-dashboard.sites.corp.example.
 * A single DNS label under the base keeps one wildcard certificate/DNS record sufficient.
 * The logical name shown to users stays "<dept>.<site>" as in the prototype.
 */
export function buildHostname(departmentCode: string, siteName: string, sitesBaseUrl = getConfig().SITES_BASE_URL): string {
  const base = new URL(sitesBaseUrl).hostname
  const label = `${departmentCode.toLowerCase()}-${siteName}`
  if (label.length > 63 || label.includes('--')) throw new Error('hostname label invalid')
  return `${label}.${base}`
}

export const logicalName = (departmentCode: string, siteName: string) => `${departmentCode.toLowerCase()}.${siteName}`

/** Public URL for a hostname using the scheme/port of the configured base URL. */
export function urlForHost(hostname: string, baseUrl: string): string {
  const b = new URL(baseUrl)
  return `${b.protocol}//${hostname}${b.port ? `:${b.port}` : ''}/`
}

export const siteUrl = (hostname: string) => urlForHost(hostname, getConfig().SITES_BASE_URL)

export function previewHostFor(label: string, previewBaseUrl = getConfig().PREVIEW_BASE_URL): string {
  return `${label}.${new URL(previewBaseUrl).hostname}`
}
