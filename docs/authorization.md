# Authorization

Decisions use **only** the server-resolved `role` and `departmentId` of the session's user
(`src/server/authz/policy.ts`). Never the uploader, never request bodies, query strings or headers. UI visibility is
not a security boundary.

## Policy

| Operation | ADMIN | USER | USER without department |
|---|---|---|---|
| List / read websites, deployments, logs, history | all departments (filter `?department=`) | own department | nothing (empty lists, 404) |
| Audit log view (`/api/v1/audit-logs`) | all departments | own department | nothing |
| Create the department website | any department label (new departments are created) | own department only | `403 NO_DEPARTMENT` |
| Upload / preview / promote / rollback | any department (cross-department promote/rollback needs a recent password re-authentication) | own department | denied |
| View hosted site / preview through the gateway | all departments | own department | denied |
| Enroll IDs: create / edit / reset password / remove accounts (`/admin/users`, `/api/v1/admin/users*`) | yes (recent password re-authentication; never own role/status) | **no** (page 404, API `403 FORBIDDEN`) | no |
| Delete websites or deployments | **never** (no endpoint exists) | never | never |

All members of a department share its single website regardless of who uploaded which revision.

## Rules

- **Concealment:** a resource of another department returns `404 NOT_FOUND` (reads and writes), so ids cannot be probed.
- **Typed department is not identity:** `POST /api/v1/websites` accepts a free-text `department`. For a USER it is only
  compared (after normalization) with their membership; a mismatch is `403 DEPARTMENT_MISMATCH` and audited. Typing a
  new department name never creates it for a USER.
- **Strict bodies:** Zod schemas are `.strict()`; unknown fields such as `role`, `departmentId` or `userId` → `400`.
- **Membership source:** admin enrollment only — Enroll IDs (`src/server/services/users.ts`, ADMIN + recent
  password re-authentication) or the infra-only CLI for bootstrap/incident response. Users cannot register or change
  their own role, department or status; a role/department/status change revokes the user's sessions; the last active
  ADMIN cannot be demoted, disabled or removed (`LAST_ADMIN`). See [enrollment.md](enrollment.md).
- **Account state:** only `ACTIVE` accounts with a `FULL`-stage session are authorized; a session that must change its
  password gets `403 PASSWORD_CHANGE_REQUIRED` everywhere except `/api/v1/me`, change-password and logout.
- **Order of checks:** load resource → `authorizeDepartment()` (`src/server/services/guard.ts`) → state checks.
  Upload authorization happens **before** the request body is read.
- **Gateway:** `/api/gateway/authorize` and `/api/internal/gate` apply the same `canAccessDepartment` rule to the
  department owning the requested hostname, on every request (decisions cached ≤10 s).

## Auditing and alerts

Denials write `AUTHZ_DENIED` / `GATEWAY_DENIED` (`result = DENIED`). Five denials by the same user within 10 minutes
raise a `security.alert` log line (`REPEATED_AUTHZ_DENIALS`) and a `SECURITY_ALERT` audit row
(`src/server/security-alerts.ts`); exceeding a rate limit raises `RATE_LIMIT_EXCEEDED`. Enrolling or promoting an
ADMIN raises `PRIVILEGE_CHANGE`; enrollment changes are audited with the target user (`ROLE_CHANGED`,
`MEMBERSHIP_CHANGED`, `USER_DISABLED`, …).

## Tests

`tests/unit/policy.test.ts`, `tests/integration/authorization.test.ts`, `tests/integration/gateway.test.ts`,
`tests/integration/session-security.test.ts`, `tests/integration/enrollment.test.ts`, `tests/ui/admin.test.tsx`.
