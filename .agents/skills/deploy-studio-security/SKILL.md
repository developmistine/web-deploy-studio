---
name: deploy-studio-security
description: Use for Deploy Studio security work - upload and ZIP validation, XSS and browser/origin isolation, CSP and security headers, API hardening (CSRF wiring, rate limits, host checks, errors), database grants, secrets, audit logging and alerts, dependency and image scanning, incident response, security reviews and hardening. Requires abuse cases, negative tests, evidence and residual-risk notes.
---

# Deploy Studio — security workflow

## When to use
- Any change under `src/server/uploads/`, `src/proxy.ts`, `src/server/rate-limit.ts`, `src/server/log.ts`,
  `src/server/audit.ts`, `src/server/security-alerts.ts`, `infra/mysql/`, `infra/site-template/default.conf.template`,
  secrets/config handling (`src/server/config.ts`), dependencies, or `.dockerignore`.
- Security reviews, hardening tasks, incident-response tooling or procedures, and before any release-gate claim.
- Pair with `deploy-studio-auth` for identity/authorization and `deploy-studio-deployment` for Docker/worker changes.

## Responsibilities
Upholds AGENTS.md invariants 8, 9, 13–15. Owns upload safety, browser isolation, headers, API/DB hardening,
secrets, logging, dependency/image scanning, incident response and the review checklist.

## Workflow
1. Identify the trust boundary (`docs/security/trust-boundaries.md`).
2. Write abuse cases; update `docs/security/threat-model.md` via the `deploy-studio-threat-model` skill.
3. Implement least-privilege controls; never disable or weaken a control to make a test pass.
4. Add negative tests; run the verification steps.
5. Record evidence (`docs/verification.md`) and residual risk (`docs/security/residual-risks.md`) with status labels.
   Never claim an unverified control.

## Rules

### Upload validation (`src/server/uploads/`) — details: `docs/security/upload-security.md`
Limits (size, count, extracted bytes, per-file, ratio, depth/length), NFC path normalization with rejection of
absolute/`..`/`\`/control chars/dot-segments, no symlinks/devices/encrypted entries/nested archives,
extension allowlist + magic-byte/UTF-8 content checks, real-byte counting during extraction, SHA-256 hashing,
malware-scan hook (`MALWARE_SCAN_MODE`), heuristic suspicious-script check (`src/server/uploads/content-scan.ts`,
`CONTENT_SCAN_MODE`; HIGH blocks, MEDIUM needs acknowledgement before Deploy — bounded regexes only), private write-once storage, temp cleanup, per-user rate limits.

### Browser isolation & CSP — details: `docs/security/domain-isolation.md`
- Management CSP: per-request nonce, `strict-dynamic`, `frame-src` = preview origins, `frame-ancestors 'none'`
  (`src/proxy.ts`); COOP/CORP same-origin; API JSON: CORP same-origin, no CORS headers ever.
- Hosted sites: `SITE_CSP` (worker config) baked into `infra/site-template/default.conf.template`
  (`connect-src 'self'`, `frame-ancestors` = management), `Cache-Control: private, no-store`, Permissions-Policy,
  service-worker registration blocked, GET/HEAD only. `'unsafe-inline'` is an accepted-pending risk (R-02).
- Previews/sites on separate origins; `__Host-ds_gw` host-only cookies; production requires separate
  registrable domains (`src/server/config.ts`).

### API & DB hardening
- `route()` wrapper: request id, Host check, auth, CSRF+Origin, safe error mapping; rate limits on login,
  upload, promote/rollback (`src/server/rate-limit.ts`).
- MySQL: runtime account DML only (`infra/mysql/grants.sh`, passwords from env), migrations with a separate
  account; audit logs append-only via triggers; parameterized queries only (`$queryRaw` tagged templates — never
  `$queryRawUnsafe` with input).

### Secrets
Environment/secret store only (`GATEWAY_SIGNING_SECRET`, `HEALTH_PROBE_TOKEN`, DB passwords); password hashes and link tokens never leave the server; never in
code, logs, client bundles, images or artifacts. `src/server/log.ts` redacts sensitive keys. `.dockerignore` must
exclude `.env*` (except the `*.example` files) — a missing `.dockerignore` once shipped `.env` into image builds.

### Logging, alerts & incident response — details: `docs/security/audit-logging.md`, `docs/security/incident-response.md`
- Audit rows carry `result`, `request_id` (AsyncLocalStorage), `source_ip_hash`. Alerts emit `security.alert`
  logs + `SECURITY_ALERT` audit (repeated authz denials, rate-limit breach, artifact integrity).
- Containment never deletes: `scripts/admin.ts` revokes sessions, disables users, suspends websites, quarantines
  revisions — every command audited with `--operator`.

### Dependencies & images
`npm audit --omit=dev` (runtime deps) must be clean; dev-only findings are tracked but not shipped.
Image scanning: `IMAGE_SCAN_COMMAND` (e.g. Trivy) — not configured by default (R-09); malware scanning likewise (R-08).

## Verification
- [ ] Walk `references/review-checklist.md`.
- [ ] `npm run typecheck && npm run lint && npm test && npm run test:integration` pass; upload changes keep
      `tests/unit/archive.test.ts` and `tests/integration/upload-api.test.ts` green.
- [ ] `npm audit --omit=dev` clean.
- [ ] Infra-level controls (TLS, WAF, firewall, scanners, backups) stay labelled **Blocked by external
      infrastructure** until evidence exists. Destructive tests against production need explicit approval.
- [ ] Docs updated with status labels (Implemented / Tested / Planned / Blocked / Requires security review).
