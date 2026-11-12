# Threat model — Deploy Studio

Method: STRIDE per trust boundary, OWASP Top 10 / API Top 10 / ASVS 5.0 L2 as the control baseline.
Severity is **qualitative** (Critical / High / Medium / Low) = likelihood × impact for an Internet-facing internal
platform; no CVSS scores are claimed. No item below is a *confirmed* vulnerability unless stated.

Status labels: **Implemented** (code exists) · **Tested** (automated test named) · **Planned** · **Blocked**
(external infrastructure) · **Review** (requires security review). Infrastructure behaviour (Traefik, Docker,
networks) is see the local end-to-end evidence in `docs/verification.md` §3 (production infrastructure still unverified).

## 1. Assets
| Asset | Where | Why it matters |
|---|---|---|
| Local accounts: email, Argon2id password hashes, status, user profiles | `users`, `enrollments` | impersonation, offline guessing if hashes leak |
| One-time setup/reset links | `password_links` (SHA-256 only); the link itself while an admin hands it over | account takeover before first use (R-27) |
| Management sessions | `sessions` (SHA-256 of token), `__Host-ds_session` cookie | account takeover |
| Gateway cookies / handshake tokens | site & preview origins | private website access |
| Department membership, ADMIN privilege | `users.department_id/role/status`, set only via Enroll IDs or the admin CLI | cross-department compromise |
| MySQL database | `db` network | integrity of pointer, audit, authz |
| Source & build artifacts, images | `STORAGE_ROOT` volume, Docker image store | malicious publication, data exposure |
| Private preview URLs / private sites | preview/site origins | corporate data exposure |
| Docker infrastructure, worker credentials | worker, docker-socket-proxy | host takeover |
| Reverse proxy configuration | Traefik static config + routes volume | routing abuse, auth bypass |
| Secrets (`GATEWAY_SIGNING_SECRET`, `HEALTH_PROBE_TOKEN`, DB passwords) | env / secret store | forgery, takeover |
| Deployment metadata, audit logs | MySQL | repudiation, forensics |
| Corporate internal services | company network | pivot target |

## 2. Threat actors
A1 anonymous Internet attacker · A2 automated bots · A3 holder of a stolen management/gateway session ·
A4 malicious authenticated employee · A5 compromised department account · A6 compromised administrator ·
A7 attacker controlling uploaded HTML/JS · A8 attacker controlling a malicious ZIP · A9 dependency /
supply-chain attacker · A10 attacker with a foothold in worker or hosting infrastructure · A11 someone who
intercepts a one-time link in the internal hand-over channel.

## 3. Entry points
`/api/v1/*` (management API), `/api/v1/auth/*` (login, logout, change-password, reauth, forgot-password,
reset-password — the unauthenticated ones are Origin-checked and rate-limited), `/api/v1/admin/users*` (Enroll IDs,
ADMIN only), pages `/login`, `/password` (one-time link, token in the URL fragment), `/account/password`,
`/api/gateway/authorize` (management-origin handshake), `/api/internal/gate` (proxy forward-auth — must be
unreachable externally), site origins `*.SITES_BASE_URL`, preview origins `*.PREVIEW_BASE_URL`, Traefik edge
entrypoint, admin CLI (`scripts/admin.ts`, operators only), MySQL (internal), Docker API via socket proxy (internal).

## 4. Trust boundaries
See `trust-boundaries.md` (TB1–TB9).

## 5. Scenarios (spec §3)

| # | Scenario | Actors | STRIDE | Existing controls (status) | Missing controls | Residual | Severity (rationale) | Verification |
|---|---|---|---|---|---|---|---|---|
| T1 | Authentication bypass | A1,A2 | S,E | `route()` requires a `FULL`-stage session of an `ACTIVE` account on all `/api/v1` (except the auth endpoints); gate fails closed; no development login routes or shared passwords (Tested) | MFA (R-25) | Password is the only factor | High — Internet-facing, full impact | `authorization.test.ts` unauthenticated; `gateway.test.ts` anonymous; `boundaries.test.ts` › no development login backdoors; `config-and-state.test.ts` › no development login switch |
| T2 | Session hijacking / replay | A3 | S | HttpOnly host-only cookies, SameSite=Lax, hashed at rest, absolute+idle expiry, revocation on password/role/department/status change, disable/remove user (Tested) | Device binding, anomaly detection | Stolen cookie valid until expiry/idle | Medium — needs endpoint compromise | `session-security.test.ts`; `enrollment.test.ts` › role and department changes end the user's sessions |
| T3 | CSRF | A1,A7 | T | Session CSRF token + Origin check; SameSite=Lax (Tested) | — | Low | Low | `session-security.test.ts` |
| T4 | Cross-department authorization bypass / IDOR | A4,A5 | E,I | Load-then-authorize, concealed 404, scoped lists, gateway `canViewHost` (Tested) | — | Logic regressions | High — core invariant | `authorization.test.ts`, `gateway.test.ts` |
| T5 | Privilege escalation | A4 | E | Role and department only from admin enrollment (Enroll IDs with ADMIN-only server checks, or the infra CLI); `.strict()` bodies; USERs have no enrollment access (Tested) | Admin CLI host hardening | Compromised operator host or admin account | High | `policy.test.ts`, `authorization.test.ts`, `enrollment.test.ts` › USER can neither read nor change enrollments |
| T6 | Typed department grants access | A4 | E | Typed value compared with session membership; USER cannot create departments (Tested) | — | — | High → mitigated | `authorization.test.ts` tampering, new department |
| T7 | Malicious file upload | A4,A8 | T,E | Extension allowlist, magic bytes, UTF-8 checks, no server-side execution, controlled image (Tested) | Malware scanner off by default | Malicious *client-side* JS is still hostable | High | `archive.test.ts`, `upload-api.test.ts` |
| T8 | ZIP path traversal / symlinks | A8 | T,E | Own path normalizer, symlink/device rejection, confined `wx` writes (Tested) | — | Low | High → Low | `archive.test.ts` |
| T9 | ZIP bombs / archive resource exhaustion | A8,A2 | D | Size/count/ratio/real-byte limits, Content-Length gate, rate limit (Tested) | CPU/time cgroup limits on extraction (only compose limits) | Up to ~51 MB buffered by `formData()` per request | Medium | `archive.test.ts`, `upload-api.test.ts` |
| T10 | Stored XSS in management app | A7 | T,I | React escaping, nonce CSP, uploaded content never on management origin (boundary Tested) | CSP reporting | Low | Medium | `boundaries.test.ts` |
| T11 | Malicious preview / hosted content against users | A7 | I,S | Separate origins, host-only gateway cookies, SITE_CSP `connect-src 'self'`, Permissions-Policy, SW blocked, COOP/CORP (Implemented) | Inline scripts allowed; same-department users exposed | Phishing / UI deception by department content | Medium — needs malicious department member | template asserted in `routing.test.ts`; browser test **Planned** |
| T12 | Cross-origin attacks on management API | A7 | I,T | No CORS headers, CORP same-origin, Origin + CSRF, SameSite=Lax (Tested) | — | Low | Medium | `session-security.test.ts` |
| T13 | SSRF | A4,A8 | I | No user-supplied URLs fetched; route upstreams regex-restricted (Tested); the web app makes no outbound calls (no IdP, no email) | — | Low | Low | `routing.test.ts` |
| T14 | Docker daemon compromise via worker | A10,A8 | E | Socket only in socket-proxy (ro mount), filtered API, no RUN in template, `--network=none` builds (config-Tested) | Proxy still allows container create (root-equivalent) | **High residual (R-01)** | Critical if worker compromised | `boundaries.test.ts`; locally runtime-verified — but a privileged container was creatable via the proxy (R-01) |
| T15 | Container escape from site container | A7,A10 | E | nginx-unprivileged, user 101, read-only rootfs, cap-drop ALL, no-new-privileges, pid/mem/cpu limits (Implemented) | gVisor/Kata/rootless daemon | Kernel 0-days | Medium — static nginx only | locally runtime-verified (`docs/verification.md` §3) |
| T16 | Database compromise | A10 | I,T | Internal network, DML-only runtime account, separate migrate account, append-only audit triggers (Implemented; triggers verified manually) | DB TLS in production, tested backups | — | High | `boundaries.test.ts` (no public port) |
| T17 | Secret leakage | A9,A10 | I | Env/secret store, redacting logger, no secrets in DTOs/client (Implemented) | CI secret scanning (Planned) | — | High | `upload-api.test.ts` DTO check |
| T18 | DNS / hostname routing abuse | A4 | S,T | Hostnames only from DB, unique; unknown host 404; Host rule regex-validated (Tested) | DNS/TLS ownership controls (**Blocked**) | Dangling DNS records | Medium | `gateway.test.ts`, `routing.test.ts` |
| T19 | CDN / storage-origin bypass | A1 | I | Storage is a private volume, never routed; containers on internal network only (Implemented) | Network test of direct container access | Infra misconfiguration | High | config-asserted only |
| T20 | Resource exhaustion (API, previews) | A2,A4 | D | Rate limits, preview TTL, container limits, upload limits (Implemented) | WAF/DDoS (**Blocked**) | Many previews within rate limit | Medium | partial |
| T21 | Supply-chain compromise | A9 | T,E | Pinned npm versions, lockfile, `npm audit --omit=dev` = 0 findings (Implemented) | Image digests, SBOM, signatures (Planned) | Base images not digest-pinned (R-10) | High | manual `npm audit` |
| T22 | Concurrent deployment races | A4 | T | Unique lock key, row locks, idempotency, fencing (Tested) | — | Low | High → Low | `deployment-safety.test.ts` |
| T23 | Rollback failures | A4,A10 | D | Targets only LIVE/ROLLED_BACK non-quarantined revisions with build hash; rebuild from artifact; route restore (Tested) | — | Low | Medium | `deployment-safety.test.ts` |
| T24 | Unauthorized publication of private files | A4 | I | Gateway on all routes, `private, no-store`, GET/HEAD only (Tested) | DLP / secret scanning of uploads (Planned) | Users may upload sensitive files to their own site | Medium | `gateway.test.ts`, `routing.test.ts` |
| T25 | Compromised administrator operations | A6 | E,R | Password re-authentication for cross-department releases and every enrollment write, `PRIVILEGE_CHANGE` alert on new/promoted admins, audit with target user, append-only audit, no delete (Tested) | MFA (R-25), dual control for enrollment and admin CLI, SIEM alert routing | Admin can still replace any site or enroll accounts after re-authentication | High | `deployment-safety.test.ts` re-authentication; `enrollment.test.ts` › a stale password check blocks writes |
| T26 | Stale worker overwrites newer state | A10 | T | Lease tokens, fenced writes, reaper, reconciler (Tested) | — | Low | Medium | `deployment-safety.test.ts` |
| T27 | Preview-to-production substitution | A4,A10 | T | Promote requires PREVIEW_READY + preview opened + build hash; worker verifies hash; image id content-addressed (Tested) | Image signing | Low | High → Low | `deployment-safety.test.ts` tampered artifact |
| T28 | Gateway token replay across hosts | A3,A7 | S | Tokens bound to host + session + user, type-separated, 2-min handshake (Tested) | Single-use handshake | Handshake in URL query for 2 min (R-07) | Medium | `gateway-tokens.test.ts`, `gateway.test.ts` |
| T29 | Repudiation of production changes | A4,A6 | R | Audit with actor, request id, IP hash, result; append-only triggers (Implemented) | External immutable log shipping (**Blocked**) | DBA with DDL could TRUNCATE | Medium | `deployment-safety.test.ts` audit trail |
| T30 | Credential stuffing (passwords reused from other breaches) | A1,A2 | S | Per-IP failure limit (`RATE_LIMIT_LOGINS_PER_10MIN`) and per-account limit, identical generic errors, local blocklist, 15-character minimum, `LOGIN_DENIED` audit (Implemented, Tested) | MFA (R-25); breached-password corpus (R-26); edge/WAF limits (R-14, R-15) | Distributed low-rate stuffing from many IPs | High — Internet-facing, single factor | `auth.test.ts` › throttles one client trying many accounts (credential stuffing) |
| T31 | Online password brute force against one account | A1,A2 | S | Per-account lock (`RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT` / 15 min) refusing even the correct password, `REPEATED_LOGIN_FAILURES` alert, Argon2id cost; the same limits apply to reauth and change-password (Implemented, Tested) | MFA (R-25) | An attacker can keep a known account locked (targeted DoS) | Medium | `auth.test.ts` › locks an account after repeated failures — even the right password — and alerts; › a correct password refreshes the window; a wrong one is refused and audited |
| T32 | Account enumeration | A1,A2 | I | Same `401 INVALID_CREDENTIALS` and Argon2 work (dummy hash) for unknown / wrong / invited / disabled / removed accounts; forgot-password always `202`; enrollment errors (`EMAIL_IN_USE`) only visible to ADMINs (Implemented, Tested) | — | Low | Low | `auth.test.ts` › wrong password, unknown, disabled, revoked and not-yet-activated accounts all get the same generic answer; › always answers the same and only flags real accounts for administrators |
| T33 | Password-reset / one-time link abuse | A1,A11,A6 | S,E | 256-bit token in the URL fragment (not sent to servers, logs or Referer), SHA-256 stored, single use (atomic claim), 24 h expiry, superseded by newer links, rate-limited completion, policy rejection keeps the link usable, completion revokes sessions; forgot-password creates nothing usable (an admin issues links) (Implemented, Tested) | Email delivery with ownership verification (Planned); approved hand-over procedure | Link leaked in the hand-over channel before use (R-27) | Medium | `auth.test.ts` › a SETUP link activates an invited account, works once…; › expired or forged links never work; › issuing a new link invalidates the previous one; `enrollment.test.ts` › reset issues a one-time link |
| T34 | Session fixation | A1,A7 | S | Every login, password change and link completion issues a new random token and deletes old sessions; host-only `__Host-` cookie (sibling site/preview origins cannot plant it); hosted origins never accept the management cookie (Implemented, Tested) | — | Low | Medium → Low | `auth.test.ts` › valid credentials create a session; › rotates sessions, the old password stops working; `gateway.test.ts` › management cookie not accepted |
| T35 | Privilege escalation via enrollment (self-escalation) | A4,A5,A6 | E | Enrollment APIs ADMIN-only on the server; admins cannot change their own role/status via enrollment or remove themselves (`SELF_CHANGE_NOT_ALLOWED`); recent password re-authentication; role/department/status changes revoke sessions; `PRIVILEGE_CHANGE` alert (Implemented, Tested) | Dual control (R-20) | A compromised ADMIN can enroll another admin (alerted, audited) | High | `enrollment.test.ts` › USER can neither read nor change enrollments; › admins cannot change their own role or status; `admin.test.tsx` › ordinary users have no enrollment controls or admin navigation |
| T36 | Last-admin lock-out (demote / disable / remove the last ACTIVE ADMIN, also concurrently) | A6,A4 | D | `LAST_ADMIN` check with `SELECT … FOR UPDATE` on active admin rows; no self-change (Implemented, Tested) | CLI `disable-user` does not apply the last-admin rule (infra operators only) | Recovery via CLI `create-user --role ADMIN` | Medium | `enrollment.test.ts` › the last active administrator can never be demoted, disabled or removed (also under races) |
| T37 | MFA bypass | — | S | N/A — MFA not implemented (R-25, release gate G2) | MFA | — | — | — |

## 6. Review cadence
Update with every change that adds an entry point or boundary (`deploy-studio-threat-model` skill) and before
each release-gate review.
