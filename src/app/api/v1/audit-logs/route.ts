import { z } from 'zod'
import { json, route } from '@/server/http/handler'
import { listAuditLogs } from '@/server/services/websites'
import { uuidSchema } from '@/lib/validation'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  websiteId: uuidSchema.optional(),
  department: z.string().regex(/^[A-Za-z0-9]{2,16}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

/** ADMIN: all departments (optional filter). USER: own department only. */
export const GET = route({}, async ({ req, db, actor }) => {
  const q = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams))
  return json({ auditLogs: await listAuditLogs(db, actor, { websiteId: q.websiteId, departmentCode: q.department, limit: q.limit }) })
})
