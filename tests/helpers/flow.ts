import { expect } from 'vitest'
import { getDb } from '@/server/db'
import * as websites from '@/app/api/v1/websites/route'
import * as deployments from '@/app/api/v1/websites/[id]/deployments/route'
import * as preview from '@/app/api/v1/deployments/[id]/preview/route'
import * as promote from '@/app/api/v1/deployments/[id]/promote/route'
import * as rollback from '@/app/api/v1/websites/[id]/rollback/route'
import type { WorkerContext } from '../../worker/src/context'
import { call, drain, zipForm, type Session } from './app'
import { siteZip } from './zip'

export async function createSite(s: Session, siteName: string, department?: string): Promise<string> {
  const r = await call(websites.POST, { path: '/api/v1/websites', session: s, body: { siteName, ...(department ? { department } : {}) } })
  expect(r.status, JSON.stringify(r.json)).toBe(201)
  return r.json.website.id
}

export async function upload(s: Session, websiteId: string, opts: { zip?: Buffer; key?: string } = {}) {
  return call(deployments.POST, {
    path: `/api/v1/websites/${websiteId}/deployments`,
    session: s,
    form: zipForm(opts.zip ?? siteZip()),
    params: { id: websiteId },
    headers: opts.key ? { 'idempotency-key': opts.key } : {},
  })
}

export async function uploadAndBuild(ctx: WorkerContext, s: Session, websiteId: string): Promise<string> {
  const r = await upload(s, websiteId)
  expect(r.status, JSON.stringify(r.json)).toBe(202)
  await drain(ctx)
  return r.json.deployment.id
}

export const openPreview = (s: Session, id: string) => call(preview.POST, { path: `/api/v1/deployments/${id}/preview`, session: s, body: {}, params: { id } })
export const requestPromote = (s: Session, id: string) => call(promote.POST, { path: `/api/v1/deployments/${id}/promote`, session: s, body: {}, params: { id } })
export const requestRollback = (s: Session, websiteId: string, targetDeploymentId?: string) =>
  call(rollback.POST, { path: `/api/v1/websites/${websiteId}/rollback`, session: s, body: targetDeploymentId ? { targetDeploymentId } : {}, params: { id: websiteId } })

/** Full happy path: upload → build → preview opened → promote → worker release. Returns deployment id. */
export async function deployLive(ctx: WorkerContext, s: Session, websiteId: string): Promise<string> {
  const id = await uploadAndBuild(ctx, s, websiteId)
  expect((await openPreview(s, id)).status).toBe(200)
  const p = await requestPromote(s, id)
  expect(p.status, JSON.stringify(p.json)).toBe(202)
  await drain(ctx)
  return id
}

export async function activeOf(websiteId: string): Promise<string | null> {
  return (await getDb().website.findUniqueOrThrow({ where: { id: websiteId } })).activeDeploymentId
}

export async function statusOf(deploymentId: string) {
  return (await getDb().deployment.findUniqueOrThrow({ where: { id: deploymentId } })).status
}
