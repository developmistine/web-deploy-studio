import { json, param, route } from '@/server/http/handler'
import { createDeployment, listDeployments } from '@/server/services/deployments'
import { authorizeDepartment } from '@/server/services/guard'
import { fingerprint, receiveUpload } from '@/server/uploads/intake'
import { limitsFromConfig, rejectReason } from '@/server/uploads/limits'
import { enforceRateLimit } from '@/server/rate-limit'
import { withIdempotency } from '@/server/idempotency'
import { getConfig } from '@/server/config'
import { audit } from '@/server/audit'
import { AppError } from '@/server/http/errors'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = route({}, async ({ db, actor, params }) => json({ deployments: await listDeployments(db, actor, param(params, 'id')) }))

/**
 * Upload a new revision (multipart field "files"). Validates structurally, stores privately,
 * enqueues the BUILD job and returns 202. Honors Idempotency-Key.
 */
export const POST = route({ mutating: true }, async ({ req, db, actor, params }) => {
  const websiteId = param(params, 'id')
  // Authorize before reading the body so other departments cannot even upload bytes.
  const website = await db.website.findUnique({ where: { id: websiteId } })
  if (!website) throw new AppError('NOT_FOUND')
  await authorizeDepartment(db, actor, website.departmentId, { action: 'deployment.create', websiteId })
  await enforceRateLimit(db, `upload:${actor.userId}`, getConfig().RATE_LIMIT_UPLOADS_PER_HOUR, 3600)

  let upload
  try {
    upload = await receiveUpload(req, limitsFromConfig())
  } catch (e) {
    const reason = rejectReason(e)
    if (reason) {
      await audit(db, { action: 'UPLOAD_REJECTED', actorUserId: actor.userId, departmentId: website.departmentId, websiteId, metadata: { reason } })
    }
    throw e
  }
  try {
    const result = await withIdempotency(
      db,
      {
        userId: actor.userId,
        scope: `upload:${websiteId}`,
        key: req.headers.get('idempotency-key'),
        requestHash: fingerprint([websiteId, upload.sha256]),
      },
      async () => ({ status: 202, body: { deployment: await createDeployment(db, actor, websiteId, upload) } }),
    )
    return json(result.body, result.status)
  } finally {
    await upload.cleanup()
  }
})
