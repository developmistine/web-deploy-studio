---
name: deploy-studio-auth
description: Use when changing Deploy Studio login or logout, passwords (Argon2id, policy, change, setup/reset links), sessions, CSRF, password re-authentication, admin enrollment (create/edit/revoke users, last-admin protection), roles, department membership, gateway access decisions, or any API route's access checks. Enforces server-side, deny-by-default authorization and cross-department isolation.
---

# Deploy Studio — authentication, enrollment & authorization

## When to use
- Any change under `src/server/auth/`, `src/server/authz/`, `src/server/gateway/`, `src/server/http/handler.ts`,
  `src/server/services/auth.ts`, `src/server/services/users.ts`, `src/app/api/v1/auth/`, `src/app/api/v1/admin/`,
  `src/app/login/`, `src/app/password/`, `src/app/account/`, `src/app/admin/`, or account commands in `scripts/admin.ts`.
- Adding or changing any Route Handler (its access check), a role, a department rule, or session/cookie behaviour.
- Not for: upload validation, CSP or secrets (`deploy-studio-security`); Traefik/worker (`deploy-studio-deployment`).

## Responsibilities
Upholds AGENTS.md invariants 2–6, 8 (access decision) and 10 (cookies per origin). Owns: login, password storage and
policy, password links, sessions and stages, CSRF/Origin/Host checks, enrollment, the ADMIN/USER × department policy,
re-authentication, and the gateway's allow/deny decision.

## Workflow
1. Name the trust boundary (TB1 browser↔management, TB2 browser↔hosted origins, TB3 proxy↔gate, TB9 operator↔CLI —
   `docs/security/trust-boundaries.md`). New boundary or endpoint → also `deploy-studio-threat-model`.
2. Write the abuse case and its negative test first (enumeration, brute force, token reuse, other department,
   escalation, last admin, stale session, missing CSRF, forged gateway token).
3. Implement through the existing choke points below — never a parallel check.
4. Run the verification steps; update the docs listed there.

## Rules

### Accounts & passwords (`src/server/auth/password.ts`, `src/server/auth/email.ts`, `docs/security/password-security.md`)
- Login identifier = normalized corporate email (NFKC, trim, lower-case) from `ALLOWED_EMAIL_DOMAINS`; the domain
  alone never proves mailbox ownership — accounts exist only through enrollment.
- Argon2id via `@node-rs/argon2` with configured cost (`ARGON2_*`); verify against a dummy hash for unknown accounts
  (no timing/enumeration signal). Generic `INVALID_CREDENTIALS` for every login failure.
- Policy (owner decision 2026-11-12): `PASSWORD_MIN_LENGTH` (default 8, never lower) to 128 characters, at least one
  letter and one digit, plus local blocklist, repetition and email/name checks; no forced periodic change.
- Rate limits: per client IP and per account on failures; all failures audited (`LOGIN_DENIED`).
- Password links (`src/server/auth/password-links.ts`): SETUP/RESET, 256-bit random, SHA-256 stored, single use,
  `PASSWORD_LINK_TTL_HOURS`; issuing a reset or using a link revokes the user's sessions. No email is sent: the admin
  sees the link once and hands it over internally. "Forgot password" only records a request (generic response).

### Sessions & CSRF (`src/server/auth/session.ts`, `src/server/http/handler.ts`)
- Opaque 256-bit token in `__Host-ds_session` (HTTPS) / `ds_session` (local http): HttpOnly, SameSite=Lax,
  host-only. DB stores SHA-256. Absolute TTL + idle timeout; new token on login and password change.
- Stages: `PASSWORD_CHANGE` (must change password — only `/api/v1/me`, change-password, logout) and `FULL`.
  `route()` and the gateway accept `FULL` only unless a route opts in.
- `authenticated_at` = last password verification; `requireRecentAuth()` → 401 `REAUTH_REQUIRED` → client re-enters the
  password (`POST /api/v1/auth/reauth`).
- Mutating requests: `x-csrf-token` (constant-time) **and** `Origin === APP_URL origin`; unauthenticated
  mutating endpoints (login, reset, forgot) require our Origin (login CSRF). Strict Host validation → 421.
- Account status `ACTIVE` only; DISABLED/REVOKED/INVITED sessions are rejected and deleted.

### Enrollment (`src/server/services/users.ts`, `docs/enrollment.md`)
- ADMIN only, recent re-auth required for every write. Create (display name, email, department label, role) →
  INVITED + one-time SETUP link. Edit display name, department, role, status (ACTIVE/DISABLED). Reset password →
  RESET link. Revoke ("Remove") → REVOKED, email freed (`active_email` NULL), sessions revoked, history kept.
- Guards: never disable/demote/revoke the last active ADMIN; never change own role/status or revoke self; USER needs
  a department; email changes are not supported (create a new enrollment).

### Authorization (`src/server/authz/policy.ts`, `src/server/services/guard.ts`)
| Action | ADMIN | USER |
|---|---|---|
| list/read websites, deployments, logs, history, audit | all departments | own department only |
| create website | any department (may create a new department by label) | own department only; other value → 403 `DEPARTMENT_MISMATCH` |
| upload / preview / promote / rollback | any department; promote/rollback of another department need recent re-auth | own department only |
| view hosted site / preview (gateway) | all | own department only |
| enrollment (`/api/v1/admin/*`, `/admin/users`) | yes (recent re-auth for writes) | never (403) |
| delete websites/deployments | never | never |

- Load the resource → `authorizeDepartment()` (audits `AUTHZ_DENIED`) → concealed 404 for other departments.
- USER with no department: session allowed, every resource denied (`NO_DEPARTMENT`). Never use `uploaded_by_user_id`.

### Gateway access (`src/server/gateway/`)
- Decisions via `canViewHost()`; session stage, user status and department re-checked per request (≤ 10 s cache, R-06).
- Handshake tokens are host-bound and signed with `GATEWAY_SIGNING_SECRET`; `__Host-ds_gw` cookies are host-only.

## Verification
- [ ] New route uses `route({...})`; mutating → CSRF + Origin; body schema `.strict()`; stage opt-in is explicit.
- [ ] Negative tests in `tests/integration/auth.test.ts`, `tests/integration/enrollment.test.ts`,
      `tests/integration/authorization.test.ts`, `tests/integration/session-security.test.ts`,
      `tests/integration/gateway.test.ts`, `tests/unit/password.test.ts`, `tests/unit/policy.test.ts`.
- [ ] `npm run typecheck && npm run lint && npm test && npm run test:integration` pass.
- [ ] MFA stays **not implemented** until enrollment, verification, recovery, revocation and bypass tests exist.
- [ ] Update `docs/authentication.md`, `docs/enrollment.md`, `docs/security/password-security.md`,
      `docs/security/session-security.md`; record new risks in `docs/security/residual-risks.md`.
