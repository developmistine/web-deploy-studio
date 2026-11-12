import 'dotenv/config'
import { createPrismaClient } from '../src/server/db'
import { normalizeDepartmentCode } from '../src/lib/validation'

/**
 * Idempotent seed. Departments are dynamic: nothing is hard-coded. Optionally pre-create departments from
 * SEED_DEPARTMENTS (comma-separated labels, e.g. "DTD,ERP,KA"). No users and no memberships are created —
 * users come from SSO; membership comes from verified claims or the admin CLI.
 */
async function main() {
  const db = createPrismaClient()
  const labels = (process.env.SEED_DEPARTMENTS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  for (const label of labels) {
    const code = normalizeDepartmentCode(label)
    if (!code) throw new Error(`Invalid department label in SEED_DEPARTMENTS: ${label}`)
    await db.department.upsert({ where: { code }, create: { code, name: label }, update: {} })
  }
  console.log(labels.length ? `Seeded departments: ${labels.join(', ')}` : 'No SEED_DEPARTMENTS configured; nothing to seed.')
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
