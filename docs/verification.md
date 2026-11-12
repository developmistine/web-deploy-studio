# Verification evidence

Recorded on **2026-11-11 / 2026-11-12** on a Windows 11 developer workstation (Docker Desktop 29.9.3, Node 26.13, MySQL 8.4).
This is development verification. It is **not** a production acceptance test, a security review or a penetration test.
See [security/release-gates.md](security/release-gates.md) for what is still outstanding.

## 1. Static checks

| Check | Command | Result |
|---|---|---|
| TypeScript (strict) | `npx tsc --noEmit` | 0 errors |
| Lint | `npm run lint` (ESLint 9 + eslint-config-next 16) | 0 errors, 0 warnings |
| Production build | `npx next build` | succeeded (2026-11-12, incl. auth, password and Enroll IDs routes) |
| Runtime dependency audit | `npm audit --omit=dev` | 0 vulnerabilities (dev-only tooling has moderate advisories; not shipped) |
| Migrations | `prisma migrate deploy` (7 migrations incl. append-only audit triggers and local accounts) | applied by the compose `migrate` job as the least-privilege `ds_migrate` account (2026-11-12) |

## 2. Automated tests — `npx vitest run`

**18 files, 270 tests, all passed (2026-11-12).** Integration tests run against a real MySQL 8.4 `*_test` database. New since the first run: `tests/unit/password.test.ts`, `tests/integration/auth.test.ts`, `tests/integration/enrollment.test.ts`, `tests/ui/admin.test.tsx`, content scan, agent-skill validation.

| Suite | File(s) | Covers |
|---|---|---|
| Upload security (unit) | `tests/unit/archive.test.ts` | traversal (8 variants), symlink, device entries, ZIP bomb (ratio + lying headers), size/count limits, unsupported types, nested archives, missing index, content mismatch, encrypted entries, duplicate paths, corrupt archives |
| Policy & identity (unit) | `tests/unit/policy.test.ts` | department isolation, tampering, unassigned users, strict schemas, step-up, department normalization, claim mapping (tenant, MFA amr/acr, overage, ambiguity, admin-membership mode) |
| Gateway tokens (unit) | `tests/unit/gateway-tokens.test.ts` | host binding, type confusion, expiry, tampering, open redirects |
| Config & state (unit) | `tests/unit/config-and-state.test.ts` | dev auth refused in production, OIDC required, origin/registrable-domain isolation, empty env values, state machine |
| Boundaries & infra config (unit) | `tests/unit/boundaries.test.ts`, `routing.test.ts` | no DELETE, no Docker in web, client/server separation, localStorage = theme only, no srcdoc; compose: no socket in web/worker, no privileged containers, MySQL loopback-only, internal networks; every route behind gateway; template has no RUN |
| Authorization (integration) | `tests/integration/authorization.test.ts` | unauthenticated 401, DTD ↔ ERP/KA isolation for read/upload/preview/promote/rollback/logs, shared department access, tampering, role escalation, unassigned users, admin access and filters, audit scope |
| Sessions & CSRF (integration) | `tests/integration/session-security.test.ts` | expired, idle, revoked, disabled users, logout, forged cookies, CSRF token/Origin, no CORS, Host validation, test identity disabled in production (two guards) |
| Deployment safety (integration) | `tests/integration/deployment-safety.test.ts` | one website per department (incl. 8 concurrent creates), revisions, failed build / health check / proxy verification keep production, concurrent promotions serialized, idempotency, premature/unauthorized promotion, rollback, rollback after image pruning, stale worker fenced out, tampered artifact refused, quarantine, suspension, admin step-up, audit trail |
| Upload API (integration) | `tests/integration/upload-api.test.ts` | rejection before storage + audit, size limit, file count, loose files, write-once storage, no internals leaked, storage path escape |
| Gateway (integration) | `tests/integration/gateway.test.ts` | anonymous → SSO redirect for every asset, department access, cross-department denial, admin access, host-bound cookies, management cookie rejected, revocation/membership change, unknown hosts, forged handshake, suspension, probe token, open redirect, previews (anonymous, cross-department, expiry) |
| UI (jsdom) | `tests/ui/ui.test.tsx` | light/dark persistence, drag & drop, browse, preview on isolated origin (never srcdoc), Deploy only after preview ready + loaded, failure path, USER vs ADMIN controls, no Delete buttons, no role selector, unassigned users blocked |

## 3. End-to-end on the Docker Compose stack — `scripts/e2e-compose.sh`

Stack: `mysql`, `migrate`, `web` (production `next build` standalone image, read-only, uid 1000), `worker` (uid 1000,
Docker API only via `docker-socket-proxy`), `proxy` (Traefik v3.5). `NODE_ENV=production`.

**27/27 checks passed on 2026-11-12** (`DS_HTTP_PORT=8090 bash scripts/e2e-compose.sh` → `E2E RESULT: ALL PASSED`). Accounts are inserted with real Argon2id hashes (production cost) and sign in through the **real** `/api/v1/auth/login` endpoint — no session injection:

- no development login route (404); unknown account → generic 401 without a cookie; real email/password login issues a session
- **real** image build from the controlled template → isolated preview container → `PREVIEW_READY`
- preview: anonymous → 302; handshake sets a host-only `Partitioned` cookie; site served through the gateway;
  `Cache-Control: private, no-store`; restrictive site CSP; POST → 403 (read-only); service worker blocked
- promotion: readiness check → atomic route switch → verification through Traefik → `LIVE`
- production site: anonymous asset → redirect to SSO authorize; DTD member sees content; ERP user → 403;
  management cookie not accepted on site origin; unknown host → 404; `/api/internal/gate` unreachable from the edge
- site container: read-only rootfs, `CapDrop [ALL]`, user `101:101`, not privileged, 128 MiB / 64 pids, no-new-privileges
- site container cannot reach the Internet, the management app, or MySQL (internal network)
- no Docker socket in `web`; `web` runs as uid 1000; runtime DB account cannot run DDL

A **real rollback** was also done on the stack: active v6 → rollback request → job `SUCCEEDED` → v5 `LIVE`,
v6 `ROLLED_BACK`, only v5's production container running.

**Production was preserved on real failures:** v1–v4 failed during this session's debugging (build errors, a route
verification failure). None of them changed the active version.

### Defects found by the end-to-end run (all fixed and re-verified)

| # | Finding | Fix |
|---|---|---|
| 1 | Empty variables in env files (`OIDC_ISSUER=`) failed config validation | empty values treated as unset (`withoutEmpty`), unit-tested |
| 2 | No `.dockerignore`: host `node_modules`, `.next` and **`.env` secrets** were sent into image builds | `.dockerignore` added |
| 3 | Named volumes root-owned → uid 1000 web/worker could not write artifacts | mount points created with uid 1000 ownership in the images |
| 4 | Docker CLI needed a writable config dir on the read-only worker | `DOCKER_CONFIG=/tmp/.docker` |
| 5 | **Security:** with a remote `DOCKER_HOST`, `docker buildx` auto-created a **privileged** BuildKit container (`buildx_buildkit_default`, `Privileged=true`) | removed; worker builds with the daemon's classic builder (`DOCKER_BUILDKIT=0`); template no longer uses `COPY --chmod`. This confirms risk R-01: the filtered Docker API still allows privileged containers |
| 6 | Traefik's file watcher is not recursive → routes in a subdirectory were never reloaded | the worker installs the infra config into the single watched routes directory |
| 7 | Traefik `buffering` middleware returned 500 on empty-body responses (303 redirects) | buffering scoped to the upload POST router only |
| 8 | MySQL init hardcoded account passwords | `infra/mysql/grants.sh` reads `DS_APP_PASSWORD` / `DS_MIGRATE_PASSWORD`; `--log-bin-trust-function-creators=1` lets `ds_migrate` create the audit triggers |

## 4. Local test stack in a real browser (2026-11-11)

`docker-compose.local-test.yml` (management app on `next dev`, test accounts, proxy on 127.0.0.1:8090), driven with
headless Chrome (Playwright) and curl:

- sign-in page shows a username/password form only (no identity picker, no SSO button without an IdP); wrong password
  → `/login?error=invalid_credentials`, no cookie; `dtd-user` + `DEV_LOGIN_PASSWORD` → signed in as USER of `dtd`
- dropping a single `demo-dashboard.html` uploads immediately; the dropzone is replaced by progress, then by the
  preview; the iframe on `<random>.preview.localhost:8090` renders the uploaded page through the gateway; **Change
  file** reopens the picker; Deploy unlocks after the preview loads
- `erp-user` opening the DTD preview → 404 (concealed); anonymous preview request → 302 to sign-in
- preview response: `Cache-Control: private, no-store`, site CSP with `frame-ancestors` = management origin
- light and dark themes render the new brand assets (Deploy Studio wordmark, pink BW logo)

### Defects found in this round (fixed, with regression tests)

| # | Finding | Fix |
|---|---|---|
| 9 | Department codes seeded by an early build were upper-case (`DTD`); MySQL's case-insensitive collation kept finding them while TypeScript compared case-sensitively → every DTD user got `DEPARTMENT_MISMATCH` | migration `20261111070000_department_code_lowercase` + `CHECK` constraint; integration tests |
| 10 | A single loose HTML file not named `index.html` was refused (`MISSING_INDEX`) | the only root HTML file of a loose upload becomes `index.html`; ambiguous uploads still refused |
| 11 | Preview reported ready before Traefik served its route → the iframe showed the proxy's 404 and Deploy unlocked on it | worker verifies the preview through the proxy (probe) before `PREVIEW_READY`; host registered without an expiry so users cannot see it early |
| 12 | Gateway handshake used a relative `Location`; `next dev` rewrote it to the internal upstream `http://web:3000/` | absolute URL from configured scheme/port + validated host |

## 5. Suspicious-script check and dynamic departments (2026-11-11, local test stack, Chrome)

- admin typed a new department **Marketing** in the upload form → department `marketing` created, website
  `marketing.campaign` built (departments are not limited to the test fixtures)
- upload with an external `<script src="https://…">` → `PREVIEW_READY` with a MEDIUM finding shown above Deploy;
  Deploy stayed disabled until the acknowledgement box was ticked
- upload with a crypto-miner script → `FAILED` / `SUSPICIOUS_CONTENT`, finding `m.js:1` shown, `SECURITY_ALERT` audited
  (Windows Defender on the workstation also deleted the on-disk test file — the test file was built in memory)
- theme toggle shows a sun in light mode and a moon in dark mode

## 6. Browser egress canary (2026-11-11, local test stack, Chrome)

A user-supplied canary page (`deploy-security-egress-test.html`, synthetic data only) was uploaded as `dtd-user` and run
in the preview against `https://canary.invalid/…` (reserved TLD — nothing can leave the machine). The upload passes the
static check (the destination is typed at runtime, so there is nothing to detect statically); the runtime result:

| Channel | Result |
|---|---|
| `fetch` POST | **blocked by CSP** (`connect-src 'self'`) — no request sent |
| `navigator.sendBeacon` | **blocked by CSP** — the page reports "queued", but no request was sent |
| `Image` GET with data in the query | **blocked by CSP** (`img-src 'self' data: blob:`; failure reason `csp`) |
| `window.open(external)` from the preview | first run: **not blocked** (DNS lookup reached) → fixed: `allow-popups` removed from the preview sandbox; re-test: `window.open` returned `null`, no popup, 0 requests |
| top-level navigation / WebRTC | not covered by CSP in current browsers (known platform limit) → static warnings `window-open`, `webrtc`, `dynamic-redirect` (browser-verified on an upload using all three); remaining risk R-24 |

## 7. Local accounts and enrollment on the stack (2026-11-12, production image, Chrome)

- **Bootstrap via the compose `tools` service:** `docker compose --env-file .env.compose --profile tools run --rm admin create-user --email admin@deploystudio.test … --role ADMIN` → account enrolled, `PRIVILEGE_CHANGE` alert, one-time link printed; `reset-password` issued a fresh link. Host CLI (`npm run admin -- create-user …` against the dev DB) also verified.
- **CLI guard:** `disable-user` on the only active ADMIN → `refused: this is the last active administrator`.
- **Browser flow:** setup link → weak password rejected with the policy message → strong password accepted, token removed from the address bar → wrong password shows the generic error → sign-in → ADMIN sidebar → Enroll IDs → enroll a DTD user (link shown once) → the user activates the account in another browser, signs in, has no sidebar, Department locked to DTD, `/admin/users` → **404**.
- Sidebar collapse to icon rail and mobile drawer rendered correctly.

### Defects found in this round (fixed)

| # | Finding | Fix |
|---|---|---|
| 13 | Times rendered on the server stayed in UTC (`suppressHydrationWarning` kept server text) and caused intermittent React hydration errors (#418) on the first page load after sign-in | `LocalTime` formats in the browser only; re-test: 0 hydration errors in 3 fresh sign-ins × 4 pages, local time shown |
| 14 | CLI `create-user` wrote `USER_CREATED` twice; CLI `disable-user` could disable the last admin | single audit row with operator metadata; last-admin guard added (verified above) |

Note: `next dev` (Next.js 16.4) appends a `nextjs-agent-rules` block to `AGENTS.md`; it is kept (accurate advice; re-added by every `next dev` run).

## 8. Enroll IDs redesign and dual branding (2026-11-12, production image, Chrome)

- Shared Radix-based primitives (`src/components/ui/`): three-dot row menu, selects, dialogs (focus trap, Escape), badges,
  form fields; brand `#EF348C`; Thai enrollment labels; `BrandHeader` with both logos.
- Measured at 1920, 1440, 1366, 1280, 1100, 1000, 901, 900, 768 and 390 px wide, sidebar expanded **and** collapsed:
  no horizontal page overflow; every row's actions button inside the viewport; full table at ≥ 1280 px, account cards when
  the panel is narrower than 880 px (container query); notebook rows stay single-line (61 px).
- Both logos visible at every size with intrinsic aspect ratio (e.g. 1366: 171×64 / 113×56; 390: 96×36 / 65×32); no
  overlap between logos, menu button and theme toggle; menu button only ≤ 900 px; light, dark and collapsed states checked.
- Row menu at 1366×768: inside the viewport, keyboard-opened, focus on the first item, Escape closes; no page errors.
- `npm test` + integration: **18 files, 277 tests passed**; lint clean; production build succeeded.
- Follow-up (same day): status switch toggled a real account off and on through the API (own account locked); status
  filter shows only ทุกสถานะ/Online/Offline; edit dialog has no status field; department input has no datalist arrow;
  header row name · Light/Dark · ออกจากระบบ on one line at 1920, 1366, 1100, 768 and 390 px (name hidden ≤ 900 px,
  icon-only sign-out ≤ 640 px) with no overflow.

## 9. Not verified (explicitly)

- **Corporate SSO:** no real IdP was available. The OIDC adapter is unit-tested only. In the e2e run, sessions were
  inserted directly into the DB to simulate a completed SSO callback.
- MFA policy at the IdP, real department/group claims, group overage handling against the real IdP.
- TLS, real DNS, separate registrable domains, WAF/DDoS, host firewall / egress rules, cloud security groups.
- ClamAV and Trivy integrations (hooks exist; not configured in this run).
- Load and performance, backup/restore, multi-replica gateway cache behaviour, a penetration test.
