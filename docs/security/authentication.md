# Authentication (security view)

Model: **local accounts** — corporate email (allowlisted domains) + a Deploy Studio password, accounts created only by
administrators ([ADR 0002](../adr/0002-local-accounts.md)). Operational description: [authentication.md](../authentication.md)
and [enrollment.md](../enrollment.md). Control detail: [password-security.md](password-security.md) and
[session-security.md](session-security.md) — not repeated here. This file summarises controls and status.

| Control | Implementation | Status |
|---|---|---|
| Email + password sign-in (`POST /api/v1/auth/login`), login CSRF (Origin = `APP_URL`) | `src/server/services/auth.ts` | Implemented, Tested (`tests/integration/auth.test.ts`) |
| Argon2id hashing, parameter upgrade on login, production refuses sub-OWASP cost | `src/server/auth/password.ts` | Implemented, Tested (`tests/unit/password.test.ts`) |
| Password policy: min length 15, max 128, blocklist, sequences, personal info; no composition rules | `password.ts`, `common-passwords.ts` | Implemented, Tested |
| Enumeration resistance: identical `401 INVALID_CREDENTIALS` and Argon2 work for unknown / wrong / invited / disabled / removed; forgot-password always `202` | `auth.ts` | Implemented, Tested |
| Brute force / credential stuffing: per-account (8 / 15 min) and per-IP (30 / 10 min) failure limits, correct password refused while locked, `REPEATED_LOGIN_FAILURES` alert | `auth.ts`, `rate-limit.ts` | Implemented, Tested; no edge/WAF limits (R-14, R-15) |
| Email domain allowlist (`ALLOWED_EMAIL_DOMAINS`, required in production) | `src/server/auth/email.ts`, `config.ts` | Implemented, Tested |
| One-time setup/reset links: 256-bit token in the URL fragment, SHA-256 stored, single use, `PASSWORD_LINK_TTL_HOURS`, superseded by newer links | `src/server/auth/password-links.ts` | Implemented, Tested; hand-over channel is outside the system (R-27) |
| Change password (current password required) and link completion revoke all sessions | `auth.ts`, `session.ts` | Implemented, Tested |
| Forced password change stage (`PASSWORD_CHANGE` sessions limited to me / change-password / logout; refused by the gateway) | `src/server/http/handler.ts`, `session.ts` | Implemented, Tested |
| Account status checked on every request (only `ACTIVE`; otherwise sessions deleted) | `session.ts` | Implemented, Tested (`tests/integration/session-security.test.ts`) |
| Server-managed opaque sessions, cookie flags, idle + absolute expiry, rotation, CSRF | `session.ts` — see [session-security.md](session-security.md) | Implemented, Tested |
| Re-authentication (password) for enrollment writes and ADMIN cross-department promote/rollback (`sessions.authenticated_at`, `ADMIN_STEP_UP_MAX_AGE_MINUTES`) → `401 REAUTH_REQUIRED` | `authz/policy.ts`, `services/users.ts`, `services/deployments.ts`, `POST /api/v1/auth/reauth` | Implemented, Tested (`enrollment.test.ts`, `deployment-safety.test.ts`, `policy.test.ts`) |
| Secrets hygiene: no passwords/hashes/tokens in URLs, logs, audit metadata or responses (except the one-time link shown to the admin) | `src/server/log.ts`, DTOs | Implemented, Tested (`tests/unit/boundaries.test.ts`) |
| No development backdoors (no test identities, shared passwords or test login route) | removed with ADR 0002; e2e checks `/api/test-auth/login` is 404 | Implemented |
| Revocation / deprovisioning: Enroll IDs disable / remove / reset; CLI `disable-user`, `revoke-sessions` by `--email` | `services/users.ts`, `scripts/admin.ts` | Implemented, Tested (UI/API); CLI not covered by automated tests |
| Passwords only over HTTPS | production `APP_URL` must be https (`__Host-` cookie) | Implemented in config; real TLS **Blocked by external infrastructure** |
| **MFA** | — | **Not implemented** — owner deferred (2026-11-11); release gate G2; risk R-25 |
| Breached-password corpus check | — | **Planned** (R-26) |
| Email delivery / ownership verification | — | **Planned** (links are handed over by an admin) |
| Corporate OIDC SSO | removed (no IdP configured); could create the same session later | **Planned** (ADR 0002) |

Not yet verifiable: production TLS, load behaviour of Argon2 under attack, and a security review of the local-account
model — release gates G1, G2 and G19 ([release-gates.md](release-gates.md)).
