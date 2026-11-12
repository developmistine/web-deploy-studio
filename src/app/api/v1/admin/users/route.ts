import { json, readJson, route } from '@/server/http/handler'
import { createUser, listUsers } from '@/server/services/users'

export const dynamic = 'force-dynamic'

/** ADMIN only (enforced in the service). Search, filters and pagination via query string. */
export const GET = route({}, async ({ req, db, actor }) => {
  const query = Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>
  return json(await listUsers(db, actor, query))
})

/** Enroll a user. Returns the one-time setup link exactly once. */
export const POST = route({}, async ({ req, db, actor }) => json(await createUser(db, actor, await readJson(req)), 201))
