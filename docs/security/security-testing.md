# Security testing map (spec §20)

Commands: `npm test` (unit + ui), `npm run test:integration` (MySQL; DB name must end in `_test`).
Results/evidence: `docs/verification.md` (only runs recorded there count as verified). The compose e2e
(`scripts/e2e-compose.sh`) enrolls accounts with real Argon2id hashes and signs in through the real
`POST /api/v1/auth/login`; it also checks that no development login route exists.

| Spec test | Automated test | Status |
|---|---|---|
| **Authentication** | | |
| Anonymous users cannot access management APIs | `tests/integration/authorization.test.ts` › rejects unauthenticated API calls | Automated |
| Anonymous users cannot access private websites | `tests/integration/gateway.test.ts` › anonymous requests never get content | Automated |
| Expired sessions rejected | `session-security.test.ts` › expired / idle sessions | Automated |
| Revoked sessions rejected | `session-security.test.ts` › revoked, deprovisioned; `gateway.test.ts` › revoked sessions | Automated |
| Valid sign-in creates a session; hash never returned; email case-insensitive | `tests/integration/auth.test.ts` › valid credentials…, email is case/whitespace-insensitive | Automated |
| Account enumeration resistance (wrong / unknown / disabled / revoked / invited → same answer) | `auth.test.ts` › … all get the same generic answer; forgot-password › always answers the same | Automated |
| Brute force: account lock even for the right password + alert | `auth.test.ts` › locks an account after repeated failures | Automated |
| Credential stuffing: one client, many accounts | `auth.test.ts` › throttles one client trying many accounts | Automated |
| Login CSRF / unknown fields / oversized passwords | `auth.test.ts` › requires our Origin; rejects unknown fields and oversized passwords | Automated |
| Forced password change stage limited | `auth.test.ts` › a session that must change its password can only reach me / change-password / logout | Automated |
| Password change rotates sessions; old password stops working; policy server-side | `auth.test.ts` › rotates sessions… | Automated |
| Re-authentication window | `auth.test.ts` › a correct password refreshes the window…; `policy.test.ts` › re-authentication window; `enrollment.test.ts` › a stale password check blocks writes | Automated |
| One-time links: single use, hash-only storage, expiry/forgery, supersession, session revocation, policy rollback | `auth.test.ts` › SETUP link…, rejected password keeps the link usable…, issuing a new link invalidates… | Automated |
| Argon2id hashing, NFKC, rehash, password policy, email normalisation and domain allowlist | `tests/unit/password.test.ts` | Automated |
| Config guards (domain allowlist required, Argon2 minimum, min length ≥ 8, no dev-login switch) | `tests/unit/config-and-state.test.ts` › configuration guards | Automated |
| No development login backdoors; hashes never in DTOs/client code | `tests/unit/boundaries.test.ts` | Automated (static) |
| MFA requirement enforced | — | N/A — MFA not implemented (release gate G2, R-25) |
| CSRF attacks fail | `session-security.test.ts` › CSRF block | Automated |
| **Authorization** | | |
| DTD user can access DTD | `authorization.test.ts` › USER from DTD can access DTD | Automated |
| DTD user cannot access ERP | `authorization.test.ts` › cannot read / upload / promote ERP | Automated |
| Admin can access all | `authorization.test.ts` › ADMIN; `gateway.test.ts` › ADMIN can view any | Automated |
| User cannot self-assign ADMIN | `authorization.test.ts` › role escalation; `policy.test.ts` strict schema; `enrollment.test.ts` › USER can neither read nor change enrollments | Automated |
| Enrollment: ADMIN-only, validation (domain, duplicates, department), admin-typed department is trusted membership | `enrollment.test.ts` | Automated |
| Role/department/status change ends sessions; disable blocks sign-in | `enrollment.test.ts` › role and department changes end the user's sessions…; disabling blocks sign-in… | Automated |
| No self role/status change; last active admin cannot be demoted/disabled/removed (also under races) | `enrollment.test.ts` › admins cannot change their own role or status; the last active administrator… | Automated |
| Reset link and soft removal | `enrollment.test.ts` › reset issues a one-time link…; remove is a soft revocation… | Automated |
| Admin UI: sidebar (icon rail, mobile drawer), Enroll IDs flows, re-auth prompt; USER has no admin controls | `tests/ui/admin.test.tsx` | Automated (jsdom) |
| Client-modified department does not grant access | `authorization.test.ts` › tampering, brand-new department; `policy.test.ts` | Automated |
| Unassigned membership grants nothing | `authorization.test.ts` › unassigned users; `ui.test.tsx` › unassigned | Automated |
| Every static asset requires authorization | `gateway.test.ts` › every asset redirects | Automated (gate); proxy wiring pending |
| **Upload** | | |
| ZIP traversal, symlinks, bombs, oversized, file count, types, missing entry point | `tests/unit/archive.test.ts`, `tests/integration/upload-api.test.ts` | Automated |
| Storage-path escape prevented | `upload-api.test.ts` › storage keys cannot escape | Automated |
| **Preview** | | |
| Anonymous preview requests fail | `gateway.test.ts` › previews | Automated |
| Cross-department preview fails | `gateway.test.ts` › previews; `authorization.test.ts` preview 404 | Automated |
| Management cookies inaccessible to uploaded content | `gateway.test.ts` › management cookie not accepted; host-only cookie design | Partially automated (browser test Planned) |
| Management APIs not usable with preview privileges | `session-security.test.ts` › cross-origin rejected / no CORS | Automated |
| Preview origin isolation verified | `config-and-state.test.ts`, `ui.test.tsx` (iframe src on preview origin) | Automated (config/UI); browser test Planned |
| Artifact changes invalidate readiness | `deployment-safety.test.ts` › tampered build artifact refused | Automated |
| **Deployment** | | |
| Failed build / health check preserve production | `deployment-safety.test.ts` | Automated (fake runtime) |
| Concurrent promotions serialized | `deployment-safety.test.ts` | Automated |
| Duplicate requests idempotent | `deployment-safety.test.ts` | Automated |
| Stale workers cannot promote | `deployment-safety.test.ts` › stale worker | Automated |
| Unauthorized promotion fails | `deployment-safety.test.ts`, `authorization.test.ts` | Automated |
| Rollback restores approved artifact | `deployment-safety.test.ts` › rollback (+ rebuild) | Automated |
| **Infrastructure** | | |
| MySQL has no public endpoint | `tests/unit/boundaries.test.ts` (compose) | Config-asserted only |
| Docker socket unavailable to Next.js | `boundaries.test.ts` (compose + source scan) | Config/static only |
| Worker cannot access prohibited internal services | compose `internal` networks | Not yet automated (needs network test) |
| Storage origin bypass fails | design (volume never routed) | Not yet automated |
| Unknown hostnames do not expose artifacts | `gateway.test.ts` › unknown hostnames | Automated (gate) |
| Shared caching cannot leak | `routing.test.ts` (`private, no-store`) | Config-asserted |
| No unauthenticated fallback route | `routing.test.ts` (gateway on all routes) | Automated (route renderer) |

Destructive or network tests must run only in isolated environments with approval — never against production.
