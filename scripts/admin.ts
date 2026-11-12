import 'dotenv/config'
import { parseArgs } from 'node:util'
import { createPrismaClient } from '../src/server/db'
import { normalizeDepartmentCode } from '../src/lib/validation'
import { runWithContext } from '../src/server/request-context'
import { audit } from '../src/server/audit'
import { normalizeEmail } from '../src/server/auth/email'
import { issuePasswordLink } from '../src/server/auth/password-links'
import { createEnrollment } from '../src/server/services/users'

/**
 * Deploy Studio protected administration CLI (trusted workflow — NOT exposed over HTTP).
 * Run only from the operations host / a break-glass container with DB credentials, e.g.:
 *   docker compose run --rm admin -- create-user --email admin@company.com --name "First Admin" --role ADMIN --operator alice
 *
 * Every command requires --operator (the human performing it) and writes an audit record.
 * Day-to-day account management happens in the web UI (Enroll IDs); this CLI bootstraps the first administrator and
 * covers incident response when the UI is unavailable.
 *
 * Commands:
 *   list-users
 *   create-user        --email --name --role ADMIN|USER [--department <label>]   → prints a one-time setup link
 *   reset-password     --email                       → prints a one-time reset link, revokes sessions
 *   create-department  --department <label>
 *   revoke-sessions    --email
 *   disable-user       --email                       (blocks sign-in, revokes sessions)
 *   enable-user        --email
 *   suspend-website    --department <label> --reason <text>   (emergency route disablement)
 *   unsuspend-website  --department <label>
 *   quarantine-deployment --deployment <id> --reason <text>   (never servable/promotable again)
 */

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string' },
    department: { type: 'string' },
    deployment: { type: 'string' },
    reason: { type: 'string' },
    operator: { type: 'string' },
  },
})

const db = createPrismaClient()

function need(name: keyof typeof values): string {
  const v = values[name]
  if (typeof v !== 'string' || !v.trim()) throw new Error(`--${name} is required`)
  return v.trim()
}

async function findUser() {
  const email = normalizeEmail(need('email'))
  const u = email ? await db.user.findUnique({ where: { activeEmail: email } }) : null
  if (!u) throw new Error('no enrolled (non-revoked) account with this email')
  return u
}

async function findDepartment() {
  const code = normalizeDepartmentCode(need('department'))
  if (!code) throw new Error('invalid department label')
  const d = await db.department.findUnique({ where: { code } })
  if (!d) throw new Error(`department "${code}" not found`)
  return d
}

async function main() {
  const cmd = positionals[0]
  const operator = need('operator')
  const meta = { operator, via: 'admin-cli' }

  switch (cmd) {
    case 'list-users': {
      const users = await db.user.findMany({ include: { department: true }, orderBy: { createdAt: 'asc' } })
      for (const u of users) console.log([u.email, u.displayName, u.role, u.department?.code ?? '-', u.status].join('	'))
      return
    }
    case 'create-user': {
      const role = need('role').toUpperCase()
      if (role !== 'ADMIN' && role !== 'USER') throw new Error('--role must be ADMIN or USER')
      const { user, setupLink } = await createEnrollment(db, null, {
        displayName: need('name'),
        email: need('email'),
        role,
        department: values.department?.trim() || undefined,
      }, meta)
      console.log(`enrolled ${user.email} (${role}). One-time setup link (valid until ${setupLink.expiresAt}) — hand it over internally:`)
      console.log(setupLink.url)
      return
    }
    case 'reset-password': {
      const u = await findUser()
      const link = await db.$transaction(async (tx) => {
        const l = await issuePasswordLink(tx, u.id, u.passwordHash ? 'RESET' : 'SETUP', null)
        await tx.session.deleteMany({ where: { userId: u.id } })
        await audit(tx, { action: 'PASSWORD_RESET_ISSUED', targetUserId: u.id, metadata: meta })
        return l
      })
      console.log(`sessions revoked. One-time link (valid until ${link.expiresAt.toISOString()}):`)
      console.log(link.url)
      return
    }
    case 'create-department': {
      const label = need('department')
      const code = normalizeDepartmentCode(label)
      if (!code) throw new Error('invalid department label')
      const d = await db.department.upsert({ where: { code }, create: { code, name: label }, update: {} })
      await audit(db, { action: 'DEPARTMENT_CREATED', departmentId: d.id, metadata: { ...meta, code } })
      console.log(`department ${code} ready`)
      return
    }
    case 'revoke-sessions': {
      const u = await findUser()
      const n = (await db.session.deleteMany({ where: { userId: u.id } })).count
      await audit(db, { action: 'SESSION_REVOKED', targetUserId: u.id, metadata: { ...meta, count: n } })
      console.log(`revoked ${n} session(s)`)
      return
    }
    case 'disable-user':
    case 'enable-user': {
      const u = await findUser()
      const disable = cmd === 'disable-user'
      await db.$transaction(async (tx) => {
        if (u.status === 'REVOKED') throw new Error('enrollment was removed; create a new one instead')
        if (disable && u.role === 'ADMIN' && u.status === 'ACTIVE') {
          // Same rule as Enroll IDs: never leave the system without an active administrator.
          const others = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' AND id <> ${u.id} FOR UPDATE`
          if (others.length === 0) throw new Error('refused: this is the last active administrator')
        }
        const status = disable ? 'DISABLED' : u.passwordHash ? 'ACTIVE' : 'INVITED'
        await tx.user.update({ where: { id: u.id }, data: { status, disabledAt: disable ? new Date() : null } })
        await tx.session.deleteMany({ where: { userId: u.id } })
        await audit(tx, { action: disable ? 'USER_DISABLED' : 'USER_ENABLED', targetUserId: u.id, metadata: meta })
      })
      console.log(`${u.displayName} ${disable ? 'disabled (sessions revoked)' : 'enabled'}`)
      return
    }
    case 'suspend-website':
    case 'unsuspend-website': {
      const d = await findDepartment()
      const w = await db.website.findUnique({ where: { departmentId: d.id } })
      if (!w) throw new Error('department has no website')
      const suspend = cmd === 'suspend-website'
      await db.website.update({ where: { id: w.id }, data: suspend ? { suspendedAt: new Date(), suspendedReason: need('reason').slice(0, 255) } : { suspendedAt: null, suspendedReason: null } })
      await audit(db, { action: suspend ? 'WEBSITE_SUSPENDED' : 'WEBSITE_UNSUSPENDED', departmentId: d.id, websiteId: w.id, metadata: meta })
      console.log(`${w.hostname} ${suspend ? 'suspended — gateway denies immediately; worker removes the route on next reconcile' : 'unsuspended'}`)
      return
    }
    case 'quarantine-deployment': {
      const id = need('deployment')
      const dep = await db.deployment.findUnique({ where: { id }, include: { website: true } })
      if (!dep) throw new Error('deployment not found')
      await db.deployment.update({ where: { id }, data: { quarantinedAt: new Date() } })
      await audit(db, { action: 'DEPLOYMENT_QUARANTINED', departmentId: dep.website.departmentId, websiteId: dep.websiteId, deploymentId: id, metadata: { ...meta, reason: need('reason').slice(0, 200) } })
      const active = dep.website.activeDeploymentId === id
      console.log(`deployment v${dep.version} quarantined${active ? ' — it is ACTIVE: the site is now taken offline; roll back to a known-good version' : ''}`)
      return
    }
    default:
      throw new Error(`unknown command "${cmd ?? ''}" — see header of scripts/admin.ts`)
  }
}

runWithContext({ requestId: `admin-cli-${Date.now()}` }, main)
  .catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
