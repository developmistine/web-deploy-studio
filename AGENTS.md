# AGENTS.md — Deploy Studio

## Mission
Deploy Studio is an Internet-facing, authenticated corporate platform where each department uploads, previews and
publishes **one** private static website. Primary invariant: **an authenticated employee, a malicious upload or a
compromised website must never automatically gain access to another department, modify privileged
infrastructure, or expose private corporate content.**

## Sources of truth and precedence
1. **Master implementation prompt (2026-11-11)** — supersedes earlier briefs. Gap analysis: `docs/gap-analysis.md`.
   Approved deviations (owner decisions, 2026-11-11): upload auto-starts on drop (no separate Preview button);
   admin "All deployments" has no department filter (each department opens its own page); **MFA is deferred**
   (not implemented — release blocker); no email delivery: password setup/reset uses one-time links an admin
   hands over internally; the site name of an existing website can be edited on the upload page — pressing Deploy
   asks to confirm the new address, then renames (`PATCH /api/v1/websites/:id`) and deploys in one step (owner
   decisions 2026-11-12). USER "My department" shows only the latest version (Preview button, failure reason);
   admins keep the full history with rollback. Upload failures show the specific reason in Thai.
2. **Security specification** (`docs/security/`) — authoritative for controls, status labels, risks and release gates.
3. **This file** — non-negotiables only. Detailed procedures live in the skills; do not copy them here.
4. **Pending decisions are not approved architecture.** ADR 0001 (per-site hardened static containers instead of
   gateway-served artifacts) is *Proposed*: keep hosting behind `SiteRuntime` (`worker/src/runtime/types.ts`).
   ADR 0002 (`docs/adr/0002-local-accounts.md`) records the local-account decision. Open risks needing a decision:
   `docs/security/residual-risks.md` (notably **R-01**, Docker API ≈ root).
5. **Evidence:** `docs/verification.md` records what has actually been verified. Anything not listed there is unverified.

## Non-negotiable invariants
1. **Stack:** Next.js 16 App Router + TypeScript 5.9 strict + Tailwind 4 + MySQL 8 (Prisma 7 + mariadb adapter) + Zod 4.
2. **Local accounts:** corporate email + Deploy Studio password (never the mailbox password). Argon2id only
   (`src/server/auth/password.ts`); no plaintext, no hashes in responses/logs, no passwords in URLs. Email domains
   are allowlisted (`ALLOWED_EMAIL_DOMAINS`). **No development backdoors** (no shared test passwords, no identity
   pickers, no auth bypass flags). MFA is **not implemented** — never claim it. SSO may be added later behind the
   same session model (ADR 0002); do not ship an unconfigured OIDC integration.
3. **Admin-managed enrollment is the only source of role and department membership.** Only ADMINs create
   accounts (`/admin/users`, `src/server/services/users.ts`) or the infra-only CLI bootstraps the first admin.
   Revocation is soft (history kept); the last active admin can never be disabled, demoted or revoked; admins cannot
   change their own role/status. Role/department/status changes revoke the user's sessions.
4. **No trust in the frontend.** Role and department come from the server session. Hidden buttons, URL params,
   request bodies and client filters are never authorization.
5. **Dynamic departments.** Departments are DB rows (free-text label → normalized lower-case `code`). DTD/ERP/KA
   are examples only. **A typed department never grants membership.**
6. **Two roles:** USER (own department only) and ADMIN (all departments + enrollment). Sensitive admin actions and
   cross-department production changes require **recent password re-authentication**. Authorization is role +
   department — never the uploader.
7. **One website per department** (`websites.department_id UNIQUE`); re-uploads are new immutable revisions.
8. **Private, read-only hosted websites.** Every request to a site or preview origin passes the gateway
   (`/api/internal/gate`, Traefik `forwardAuth`) and needs a fully signed-in session. No public route exists.
9. **Uploaded content is untrusted** — validated, hashed, stored privately, never executed server-side.
10. **Separate origins:** management (`APP_URL`), sites (`SITES_BASE_URL`), previews (`PREVIEW_BASE_URL`);
    production must use separate registrable domains. Uploaded HTML/JS never runs on the management origin.
11. **Dedicated worker** is the only component with a Docker API (via `docker-socket-proxy`). **No Docker socket,
    CLI or `child_process` in the web app.** The socket-proxy filter is *not* a security boundary (R-01): never
    create privileged containers, host mounts or BuildKit/buildx helper containers; classic builder only.
12. **Immutable revisions; safe replacement & rollback.** A failed build/health check/promotion never changes or
    breaks the active production revision. Promotion targets the exact previewed artifact.
13. **No Delete UI or API** for websites/deployments. Enrollment "Remove" = soft revocation. Incident containment
    uses `scripts/admin.ts` (infra-only).
14. **Secrets never enter images, logs, client bundles or artifacts.** `.dockerignore` keeps `.env*` out of builds.
15. **Security tests are mandatory** for any change touching auth, enrollment, authz, uploads, gateway or deployment.
16. **Production release blockers:** `docs/security/release-gates.md`. Never declare production readiness, MFA, SSO,
    infrastructure isolation or any control verified without recorded evidence.

## Architecture boundaries
- `src/app/**` — pages (`/`, `/login`, `/password`, `/account/password`, `/admin/users`) + Route Handlers
  (`/api/v1/*`, `/api/gateway/authorize`, `/api/internal/gate`). The only HTTP backend.
- `src/server/**` — server-only: `auth/` (passwords, email rules, sessions, password links), `authz/policy.ts`,
  `gateway/`, `services/` (auth, users, websites, deployments), `uploads/`, `storage/`, `deployments/`, `audit.ts`.
  Route Handlers: `route()` wrapper → Zod → service → policy. Thin handlers.
- `src/components/**`, `src/lib/**` — client-safe only; never import `@/server/*`.
- `worker/**` — jobs, runtime adapters, Traefik route writer, reconciler. Talks to the web app only through MySQL.
- `scripts/admin.ts` — infra-only CLI (bootstrap admin, revocation, suspension, quarantine). Not exposed over HTTP.
- `infra/**` — Traefik, site image template, MySQL grants. `prisma/**` — schema, migrations, seed.

## Conventions
- Validate every external input with Zod (`.strict()` bodies). Read cookies/headers from the `Request`.
- Throw `AppError(code)`; clients only see `{ error: { code, message, details? } }` from `src/server/http/errors.ts`.
- Every state change writes `audit_logs` (append-only; triggers block UPDATE/DELETE).
- Deployment status changes only via `transition()` in `src/server/deployments/state.ts`.
- Comments explain *why*. Pure functions for policy decisions.

## Skills — pick before you change code
Skills live in `.agents/skills/<name>/SKILL.md` (Codex discovers them there). Use every skill whose area you touch.

| Skill | Owns |
|---|---|
| `deploy-studio-auth` | login, passwords, password links, sessions, CSRF, enrollment, roles, department membership, authorization policy, gateway access decisions |
| `deploy-studio-security` | uploads, browser/origin isolation, CSP, API/DB hardening, secrets, logging/alerts, dependencies, incident response, security reviews |
| `deploy-studio-deployment` | worker, job queue, Docker isolation, image builds, artifacts, previews, Traefik routes, promotion, rollback, reconciliation |
| `deploy-studio-threat-model` | STRIDE analysis, trust boundaries, abuse cases, risk register, release-gate reviews |

Any change that adds an endpoint, origin, trust boundary or infrastructure component also needs `deploy-studio-threat-model`.

## UI preservation
`deploy-studio-layout-updated.html` is the layout source of truth, with the approved brand refresh: Deploy Studio
wordmark (`public/brand/deploy-studio.png`) left, pink BW logo (`public/brand/bw-logo-pink.svg`) centered, brand
colour `#EF348C`, plain background, monochrome tokens, `.sketch` outlines, light/dark toggle (sun/moon).
localStorage holds UI preferences only (theme, sidebar state). Department (free text, no dropdown arrow; prefilled and
locked for USER) and Site name on one row. Dropping files uploads immediately; the dropzone is replaced by progress,
then by the 75vh / min 650px preview iframe on the preview origin with **Change file**. Deploy only after the preview
is ready, loaded and any script findings acknowledged. **ADMIN:** collapsible left sidebar (Deploy เว็บไซต์,
จัดการบัญชีผู้ใช้งาน; icon rail when collapsed, drawer ≤ 900px opened from the header). **USER:** no sidebar, no admin
controls. No role selector, no website Delete. Header = `BrandHeader` (product + corporate logo, never distorted or hidden)
with one account row: name · Light/Dark · ออกจากระบบ (no self-service change-password button — admins issue reset links).
Enrollment: role labels in English (Admin/User), status = on/off switch (Online/Offline), status filter ทุกสถานะ/Online/Offline.
Admin/account UI reuses the shared primitives in `src/components/ui/` (Button, Select, DropdownMenu, Dialog, badges,
FormField — Radix-based, accessible); do not add parallel button/select styles. Enrollment UI text is Thai
(`src/lib/i18n/enrollment-th.ts`); enum values, routes and API fields stay English.

## Testing
- Always: `npm run typecheck && npm run lint && npm test` (unit + ui, no DB).
- Auth/enrollment/authz/upload/gateway/deployment changes: also `npm run test:integration` — MySQL with a database name
  ending in `_test` (`TEST_DATABASE_URL`; setup in `docs/local-development.md`).
- Docker, Traefik, compose or site-template changes: also `scripts/e2e-compose.sh`; record evidence in `docs/verification.md`.
- Add a negative test for every abuse case you touch (`tests/unit`, `tests/integration`, `tests/ui`).

## Prohibited
- Plaintext passwords; exposing hashes; passwords/tokens in URLs, logs or audit metadata; shared or default passwords.
- Trusting client-sent role/department/user ids; uploader-based visibility; typed department as membership.
- Non-admin access to enrollment APIs/pages; self-enrollment; self role/department/status changes.
- `DELETE` handlers or delete UI for websites/deployments (`tests/unit/boundaries.test.ts` enforces).
- Docker socket/CLI/`child_process` in `src/`; running uploaded Dockerfiles/scripts; RUN steps in the site template;
  privileged or host-mounted containers; buildx/BuildKit builder containers.
- Serving uploaded content from the management origin (`srcdoc`, blob URLs) or any route without `ds-gateway@file`.
- Archives in MySQL; localStorage as data store; secrets/tokens/cookies/raw IPs in logs or audit metadata.
- CORS headers on management APIs; shared (wildcard) cookies between origins.
- Weakening or disabling a control to make a test pass; bypassing authorization for convenience.
- Destructive security tests against production without explicit approval.

## Maintaining this file and the skills
Record every change to AGENTS.md or a skill in `.agents/CHANGELOG.md`. `tests/unit/agent-skills.test.ts` validates
skill frontmatter, the skill list above and every repository path these files reference — keep it passing.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
