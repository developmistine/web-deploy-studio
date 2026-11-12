# Audit logging and security monitoring

## Record format (`audit_logs`)
| Spec field | Column | Notes |
|---|---|---|
| eventId | `id` (BIGINT, monotonic) | |
| requestId / correlationId | `request_id` | from `X-Request-Id` (validated) or generated per request (AsyncLocalStorage, `src/server/request-context.ts`); worker jobs use `job-<jobId>`; admin CLI `admin-cli-<ts>`; echoed in `x-request-id` response header |
| actorUserId | `actor_user_id` | null for worker-only events, anonymous requests and CLI bootstrap |
| targetUserId | `target_user_id` | account affected by an enrollment/password/login event (separate from the actor; indexed with `created_at`, migration `20261111121000_audit_target_user`) |
| departmentId / websiteId / deploymentId | same | |
| action | `action` | see `AuditAction` in `src/server/audit.ts` |
| result | `result` | SUCCESS / DENIED / FAILURE (defaults per action) |
| timestamp | `created_at` | |
| source context | `source_ip_hash` (16 hex of SHA-256 of client IP), `metadata` JSON | no raw IPs, tokens or secrets |

Status: Implemented; lifecycle trail Tested (`deployment-safety.test.ts` "records an audit trail"); authentication and
enrollment events Tested (`tests/integration/auth.test.ts`, `tests/integration/enrollment.test.ts`).

## Events recorded
**Authentication:** LOGIN (`metadata.stage`), LOGIN_DENIED (`metadata.reason`: `unknown_account`, `wrong_password`,
`status_invited` / `status_disabled` / `status_revoked`, `rate_limited`; `target_user_id` when the account exists),
LOGOUT, SESSION_REVOKED, REAUTH_REQUIRED (re-authentication demanded for an enrollment write or cross-department
release), REAUTH_FAILED (wrong password on re-auth or change-password), PASSWORD_CHANGED, PASSWORD_SET (one-time link
completed, `metadata.purpose` SETUP/RESET), PASSWORD_RESET_REQUESTED (forgot-password; `DENIED` when no eligible
account), PASSWORD_RESET_ISSUED.
**Enrollment (actor + target user):** USER_CREATED (`metadata.role`), USER_UPDATED (which fields changed),
ROLE_CHANGED (from/to), MEMBERSHIP_CHANGED (department from/to), USER_DISABLED, USER_ENABLED, USER_REVOKED,
DEPARTMENT_CREATED.
**Authorization and deployments:** AUTHZ_DENIED, WEBSITE_CREATED, WEBSITE_RENAMED, WEBSITE_SUSPENDED/UNSUSPENDED,
DEPLOYMENT_QUARANTINED, DEPLOYMENT_UPLOADED, UPLOAD_REJECTED, PREVIEW_OPENED, DEPLOYMENT_PREVIEW_READY,
PROMOTION_REQUESTED, DEPLOYMENT_LIVE, DEPLOYMENT_FAILED, ARTIFACT_INTEGRITY_FAILED (action reserved; integrity
failures currently surface as SECURITY_ALERT + DEPLOYMENT_FAILED), ROLLBACK_REQUESTED/COMPLETED/FAILED,
GATEWAY_SESSION_ISSUED, GATEWAY_DENIED, SECURITY_ALERT.
Admin cross-department operations are identifiable by actor role vs. target department (Implemented).

## Integrity
- Append-only: `BEFORE UPDATE` / `BEFORE DELETE` triggers raise errors for **every** account
  (migration `20261111040000_audit_append_only`; verified manually that UPDATE/DELETE fail even for root).
- Runtime DB account has no DDL (cannot TRUNCATE/DROP) — `infra/mysql/grants.sh`.
- Residual: an account with DDL (migration/DBA) can still truncate — ship logs off-host (Planned/Blocked).

## Alerts (Implemented)
Emitted as structured log lines `{"msg":"security.alert","kind":...}` plus a `SECURITY_ALERT` audit row
(`src/server/security-alerts.ts`):
| Kind | Trigger |
|---|---|
| REPEATED_AUTHZ_DENIALS | 5th authorization/gateway denial of one user within 10 min |
| RATE_LIMIT_EXCEEDED | first request over any rate limit in its window |
| ARTIFACT_INTEGRITY | build artifact hash mismatch at release |
| REPEATED_LOGIN_FAILURES | an account reaches `RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT` failed sign-ins within 15 min (account then locked for the window) |
| PRIVILEGE_CHANGE | an ADMIN account is enrolled (`admin_enrolled`) or a user is promoted to ADMIN (`promoted_to_admin`) |

Planned (need SIEM): other suspicious admin operations, abnormal deployment frequency (`ABNORMAL_DEPLOY_FREQUENCY` kind
reserved), worker resource exhaustion, unexpected infrastructure access. Shipping logs to a SIEM and alert
routing — **Blocked by external infrastructure**.

## Not logged
Passwords, password hashes, one-time link tokens, session tokens, cookies, raw IPs (`src/server/log.ts` redacts keys matching
token/secret/password/cookie/authorization/nonce/session). Traefik access logs drop all headers.
Note: handshake tokens travel in the URL query of `/__ds_auth`; ensure edge/WAF logs redact query strings (R-07).
