# API

Versioned Route Handlers under `/api/v1` (Next.js App Router). **There are no `DELETE` endpoints** (enforced by
`tests/unit/boundaries.test.ts`).

## Conventions

- **Auth:** server session cookie (see [authentication.md](authentication.md)). Missing/invalid → `401 UNAUTHENTICATED`.
  A session in stage `PASSWORD_CHANGE` reaches only `GET /api/v1/me`, change-password and logout; everything else →
  `403 PASSWORD_CHANGE_REQUIRED`. An account that is not `ACTIVE` loses its sessions on the next request.
- **CSRF:** every non-GET request needs `x-csrf-token: <session token>` and `Origin: <APP_URL origin>` → else `403 CSRF_FAILED`.
  Unauthenticated POSTs (login, forgot-password, reset-password) need `Origin: <APP_URL origin>`.
- **Host:** must equal the `APP_URL` host (or `APP_ALLOWED_HOSTS`) → else `421 HOST_NOT_ALLOWED`.
- **Errors:** `{ "error": { "code", "message", "details"? } }` — messages are from a fixed safe catalogue.
- **Authorization:** other departments' resources → `404 NOT_FOUND` (concealed). See [authorization.md](authorization.md).
- **Headers:** `cache-control: no-store`, `cross-origin-resource-policy: same-origin`, `x-request-id`; no CORS headers.

## Endpoints

| Method & path | Body / query | Success | Notes |
|---|---|---|---|
| `GET /api/v1/me` | — | `200 { user{displayName,email,role,department}, csrfToken, stage }` | `stage`: `FULL` \| `PASSWORD_CHANGE`; also reachable in `PASSWORD_CHANGE` stage |
| `GET /api/v1/departments` | — | `200 { departments[] }` | USER: own department only |
| `GET /api/v1/websites` | `?department=<label>` (ADMIN filter) | `200 { websites[] }` | USER: own department only |
| `POST /api/v1/websites` | `{ siteName, department? }` (strict) | `201 { website }` | Creates the department's single website. `409 WEBSITE_EXISTS {details.websiteId}`; `403 DEPARTMENT_MISMATCH` / `NO_DEPARTMENT`; `400 INVALID_DEPARTMENT` / `HOSTNAME_TOO_LONG`; ADMIN must pass `department` |
| `GET /api/v1/websites/:id` | — | `200 { website }` | |
| `PATCH /api/v1/websites/:id` | `{ siteName }` (strict; trimmed + lower-cased like creation) | `200 { website }` | Rename → new hostname immediately; the old address stops resolving (worker re-points the live route within seconds). Department members + ADMIN (cross-department needs `REAUTH_REQUIRED` re-auth). `404` other department, `400` invalid name, `409 PROMOTION_IN_PROGRESS`, `409 HOSTNAME_TAKEN`, `400 HOSTNAME_TOO_LONG`, `423 WEBSITE_SUSPENDED`, rate limit 20/h per user. Audited `WEBSITE_RENAMED {from,to,fromHostname,toHostname}` |
| `GET /api/v1/websites/:id/deployments` | — | `200 { deployments[] }` (newest first, ≤50) | |
| `POST /api/v1/websites/:id/deployments` | `multipart/form-data`, field `files`: one `.zip` or many static files; header `Idempotency-Key` (optional, 8–128 `[A-Za-z0-9_-]`); `Content-Length` required | `202 { deployment }` | Rate limit `RATE_LIMIT_UPLOADS_PER_HOUR` per user. `411`, `413`, `415`, `422 UPLOAD_REJECTED {details.reason, path?}`, `423 WEBSITE_SUSPENDED`, `422 IDEMPOTENCY_MISMATCH` |
| `GET /api/v1/deployments/:id` | — | `200 { deployment }` | Poll for status |
| `GET /api/v1/deployments/:id/logs` | — | `200 { logs[] }` | User-safe messages only |
| `POST /api/v1/deployments/:id/preview` | `{}` | `200 { preview: {status:"READY", launchUrl, expiresAt} \| {status:"RESTARTING"} }` | `launchUrl` is a 2-min handshake on the preview origin; records preview viewed. `409 INVALID_STATE` |
| `POST /api/v1/deployments/:id/promote` | `{}` | `202 { deployment }` | Requires `PREVIEW_READY`, preview opened, artifacts present. `409 PREVIEW_REQUIRED` / `INVALID_STATE` / `PROMOTION_IN_PROGRESS`; ADMIN on another department without a recent password check → `401 REAUTH_REQUIRED` (confirm via `POST /api/v1/auth/reauth`, then retry); idempotent by state; rate limit `RATE_LIMIT_PROMOTIONS_PER_HOUR` |
| `POST /api/v1/websites/:id/rollback` | `{ targetDeploymentId? }` | `202 { deployment }` (the target) | `409 NO_ROLLBACK_TARGET` / `PROMOTION_IN_PROGRESS`; `401 REAUTH_REQUIRED` as above; shares the promotion rate limit |
| `GET /api/v1/audit-logs` | `?websiteId=&department=&limit=1..200` | `200 { auditLogs[] }` | USER: own department only |

DTOs (`src/lib/types.ts`) never include storage keys, image ids or internal error details. `errorCode` on a
deployment is mapped to a safe `errorMessage`.

## Authentication endpoints

Local email + password ([authentication.md](authentication.md)). Passwords travel only in JSON bodies (never in URLs);
responses never contain hashes. Rate limits: failures per IP (`RATE_LIMIT_LOGINS_PER_10MIN`) and per account
(`RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT` / 15 min) → `429 RATE_LIMITED`, even for a correct password while locked.

| Method & path | Body | Success | Errors / notes |
|---|---|---|---|
| `POST /api/v1/auth/login` | `{ email, password }` | `200 { csrfToken, stage }` + session cookie | `401 INVALID_CREDENTIALS` for every failure (unknown, wrong password, invited, disabled, removed — identical timing); Origin required; `stage = PASSWORD_CHANGE` when a password change is required |
| `POST /api/v1/auth/logout` | — | `200 { redirectTo: "/login" }`, cookie cleared | CSRF-protected; allowed in both stages |
| `POST /api/v1/auth/change-password` | `{ currentPassword, newPassword }` | `200 { csrfToken }` + new cookie | `400 WRONG_PASSWORD`, `422 PASSWORD_POLICY {details.problems, minLength}`, `422 PASSWORD_REUSED`; revokes every session of the user and issues a fresh one; allowed in both stages |
| `POST /api/v1/auth/reauth` | `{ password }` | `200 { ok: true }` | `400 WRONG_PASSWORD` (throttled like a login); refreshes `sessions.authenticated_at` for sensitive actions |
| `POST /api/v1/auth/forgot-password` | `{ email }` | `202 { ok: true }` always | No email is sent; an eligible account gets "reset requested" for administrators; rate-limited per IP |
| `POST /api/v1/auth/reset-password` | `{ token, newPassword }` | `200 { ok: true }` | Completes a one-time SETUP/RESET link (the token comes from the URL fragment of `/password#token=…`). `400 INVALID_LINK`, `422 PASSWORD_POLICY` (link stays usable); revokes sessions; rate-limited per IP |

## Enrollment endpoints (ADMIN only)

Every endpoint re-checks ADMIN on the server (`FORBIDDEN` otherwise); every write needs a password confirmation within
`ADMIN_STEP_UP_MAX_AGE_MINUTES` → else `401 REAUTH_REQUIRED`. Details and rules: [enrollment.md](enrollment.md).
`user` = `{ id, displayName, email, department, role, status, passwordSet, resetRequested, lastLoginAt, createdAt }`
(never a hash). Links (`{ url, expiresAt }`) are returned exactly once.

| Method & path | Body / query | Success | Errors |
|---|---|---|---|
| `GET /api/v1/admin/users` | `?q=&department=&role=&status=&page=&pageSize=` (5–100, default 20) | `200 { users[], total, page, pageSize, departments[] }` | `REVOKED` accounts hidden unless `status=REVOKED` |
| `POST /api/v1/admin/users` | `{ displayName, email, department?, role }` (strict) | `201 { user, setupLink }` | `400 INVALID_EMAIL`, `422 EMAIL_DOMAIN_NOT_ALLOWED`, `409 EMAIL_IN_USE`, `422 DEPARTMENT_REQUIRED` (USER), `400 INVALID_DEPARTMENT` |
| `GET /api/v1/admin/users/:id` | — | `200 { user }` | `404 NOT_FOUND` |
| `PATCH /api/v1/admin/users/:id` | `{ displayName?, department? (null clears), role?, status? (ACTIVE\|DISABLED) }` | `200 { user }` | `409 SELF_CHANGE_NOT_ALLOWED`, `409 LAST_ADMIN`, `409 ACCOUNT_REVOKED`, `422 DEPARTMENT_REQUIRED`; role/department/status changes revoke the user's sessions |
| `POST /api/v1/admin/users/:id/reset-password` | — | `200 { resetLink }` | `409 SELF_CHANGE_NOT_ALLOWED`, `409 ACCOUNT_REVOKED`; ends the user's sessions |
| `POST /api/v1/admin/users/:id/revoke` | — | `200 { user }` (status `REVOKED`) | `409 SELF_CHANGE_NOT_ALLOWED`, `409 LAST_ADMIN`, `409 ACCOUNT_REVOKED`; soft revocation, history kept |

## Gateway endpoints

| Method & path | Caller | Notes |
|---|---|---|
| `GET /api/gateway/authorize?host=&r=` | Browser (management origin) | Checks session + department for the site/preview host, then `303` to `https://<host>/__ds_auth?t=…&r=…`; unauthenticated → `/login?returnTo=…`; `403`/`404`/`423` status pages |
| `GET /api/internal/gate` | Traefik `forwardAuth` only | Decision for every hosted-content request (reads `X-Forwarded-Host`, `X-Forwarded-Uri`, `Cookie`, `X-DS-Probe`). Not routed publicly (`!PathPrefix(/api/internal)` in `infra/traefik/dynamic/00-infra.yml`). Fails closed (503 on error) |
| `GET /api/health` | Orchestrator | `{ok}` only |

## Error codes

`UNAUTHENTICATED 401`, `INVALID_CREDENTIALS 401`, `PASSWORD_CHANGE_REQUIRED 403`, `REAUTH_REQUIRED 401`,
`WRONG_PASSWORD 400`, `PASSWORD_POLICY 422`, `PASSWORD_REUSED 422`, `INVALID_LINK 400`, `INVALID_EMAIL 400`,
`EMAIL_DOMAIN_NOT_ALLOWED 422`, `EMAIL_IN_USE 409`, `DEPARTMENT_REQUIRED 422`, `LAST_ADMIN 409`,
`SELF_CHANGE_NOT_ALLOWED 409`, `ACCOUNT_REVOKED 409`, `FORBIDDEN 403`, `DEPARTMENT_MISMATCH 403`, `NO_DEPARTMENT 403`,
`WEBSITE_SUSPENDED 423`, `HOST_NOT_ALLOWED 421`, `CSRF_FAILED 403`, `NOT_FOUND 404`, `VALIDATION_FAILED 400`,
`PAYLOAD_TOO_LARGE 413`, `LENGTH_REQUIRED 411`, `UNSUPPORTED_MEDIA_TYPE 415`, `UPLOAD_REJECTED 422`,
`INVALID_DEPARTMENT 400`, `HOSTNAME_TOO_LONG 400`, `WEBSITE_EXISTS 409`, `HOSTNAME_TAKEN 409`, `INVALID_STATE 409`,
`PREVIEW_REQUIRED 409`, `PROMOTION_IN_PROGRESS 409`, `NO_ROLLBACK_TARGET 409`, `IDEMPOTENCY_MISMATCH 422`,
`RATE_LIMITED 429` (with `retry-after`), `INTERNAL 500`.

Upload rejection reasons (`details.reason`): `EMPTY_UPLOAD`, `ARCHIVE_TOO_LARGE`, `TOO_MANY_FILES`,
`EXTRACTED_TOO_LARGE`, `FILE_TOO_LARGE`, `COMPRESSION_RATIO`, `UNSAFE_PATH`, `SYMLINK`, `UNSAFE_ENTRY`,
`ENCRYPTED_ENTRY`, `UNSUPPORTED_COMPRESSION`, `UNSUPPORTED_FILE_TYPE`, `CONTENT_MISMATCH`, `DUPLICATE_PATH`,
`MISSING_INDEX`, `CORRUPT_ARCHIVE`, `NESTED_ARCHIVE`, `MALWARE_DETECTED`.
