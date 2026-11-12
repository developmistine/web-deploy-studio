# Authorization (security view)

Rule: **decision = server-side role + trusted department membership + target resource department + operation.**
Uploader identity is never used. Deny by default. Operational description: [authorization.md](../authorization.md).

## Department identity and membership (spec §6)
- Departments are dynamic DB rows: free-text label → `normalizeDepartmentCode()` (NFKC, lowercase, `[a-z0-9-]`,
  2–32 chars, no `--`) → unique `code`; `name` keeps the label. — Tested (`tests/unit/policy.test.ts`).
- **Membership source: admin enrollment only** — Enroll IDs (`/admin/users`, `src/server/services/users.ts`) or the
  infra-only CLI (`scripts/admin.ts`) for bootstrap/incidents. No self-registration, no IdP claims. A USER must have a
  department (`DEPARTMENT_REQUIRED`); a new label typed by the
  ADMIN during enrollment creates the department. See [enrollment.md](../enrollment.md). — Implemented, Tested
  (`tests/integration/enrollment.test.ts`).
- **A typed department never grants membership:** USER input is compared with `actor.departmentCode`; mismatch →
  403 `DEPARTMENT_MISMATCH` + audit; USER cannot create departments; USER without a department → `NO_DEPARTMENT`.
  — Tested (`tests/integration/authorization.test.ts`).
- ADMIN may create a department by label while creating its website (audited `DEPARTMENT_CREATED`). — Tested.
- UI: department is free text; locked and prefilled for USER. — Tested (`tests/ui/ui.test.tsx`).

## Enrollment safeguards (privilege management)
| Control | Status |
|---|---|
| Enroll IDs page and `/api/v1/admin/users*` are ADMIN-only on the server (USER: page 404, API `403 FORBIDDEN`) | Implemented, Tested (`enrollment.test.ts`, `admin.test.tsx`) |
| Every enrollment write needs a recent password re-authentication (`401 REAUTH_REQUIRED`) | Implemented, Tested |
| No self-escalation: admins cannot change their own role or status, or remove themselves (self password reset is allowed: link + all own sessions end) (`SELF_CHANGE_NOT_ALLOWED`); USERs have no enrollment access; strict bodies reject `role`/`departmentId` elsewhere | Implemented, Tested |
| Last-admin lock-out prevented: demote/disable/remove of the last ACTIVE ADMIN → `LAST_ADMIN`, rows locked (`SELECT … FOR UPDATE`) against concurrent changes | Implemented, Tested |
| Role, department or status change revokes all sessions of the user (no stale authorization) | Implemented, Tested |
| Removal is soft (`REVOKED`, email released, history kept); removed accounts cannot be edited back | Implemented, Tested |
| Enrolling/promoting an ADMIN raises `PRIVILEGE_CHANGE`; every change audited with `target_user_id` | Implemented, Tested |
| Dual control / four-eyes for admin enrollment or the CLI | **Planned** (R-20) |

## Enforcement points
| Operation | Enforcement | Status |
|---|---|---|
| List websites / departments / audit | `websiteScope`, `departmentScope`, audit filter | Tested |
| Read website / deployment / logs / history | load → `authorizeDepartment` (404 conceal, audit, alert) | Tested |
| Create website | `resolveTargetDepartment` | Tested |
| Upload | authorize before reading the body; suspension check | Tested |
| Preview launch | authorize; handshake bound to the caller's session | Tested |
| Promote / rollback | authorize; suspension/quarantine checks; ADMIN re-authentication for other departments | Tested |
| Hosted site / preview content | gateway `canViewHost` per request; requires `FULL` session and `ACTIVE` account | Tested (`gateway.test.ts`) |
| Artifacts | never exposed via API (no storage keys / image ids in DTOs) | Tested (`upload-api.test.ts`) |
| Membership / role / status changes | Enroll IDs (ADMIN + re-auth) or infra-only CLI | Tested (`enrollment.test.ts`) |
| Delete | no endpoint exists | Tested (`boundaries.test.ts`) |

## Admin operations
All audited; cross-department production changes and enrollment writes need password re-authentication
(`ADMIN_STEP_UP_MAX_AGE_MINUTES`, default 15). Admin uploads/previews for other departments do **not** require
re-authentication (only release does) — Requires security review (R-21). Dual control for the admin CLI — Planned.
