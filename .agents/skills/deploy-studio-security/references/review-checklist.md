# Security review checklist

Authentication & authorization
- [ ] Every new/changed route uses `route()`; `mutating: true` (CSRF + Origin) for non-GET.
- [ ] Resources loaded then authorized via `authorizeDepartment()` / policy; lists use `websiteScope()`.
- [ ] Bodies validated with `.strict()` Zod schemas; no client role/department/user id honoured.
- [ ] A typed department is only compared with the session membership (never creates/grants for USER).
- [ ] ADMIN cross-department promote/rollback and every enrollment write still require recent password re-auth.
- [ ] Login/reset/forgot responses stay generic (no account enumeration); failures are rate limited and audited.
- [ ] No password, hash or link token in any response (except the one-time link to the admin), log or audit row.
- [ ] Enrollment APIs/pages are ADMIN-only on the server; last-admin and self-change guards intact.

Hosted content & browser isolation
- [ ] Every Traefik route written by the worker includes `ds-gateway@file` (`tests/unit/routing.test.ts`).
- [ ] Gateway decisions re-check session + department per request; unknown host → 404; suspended → 423.
- [ ] No uploaded content on the management origin (no `srcdoc`, blob URLs) (`tests/unit/boundaries.test.ts`).
- [ ] Management CSP keeps `frame-ancestors 'none'`, `frame-src` limited to preview origins; no CORS headers.
- [ ] Site template keeps `private, no-store`, SITE_CSP, service-worker block, GET/HEAD only.

Uploads & deployment
- [ ] Upload limits unchanged or raised only with justification; `tests/unit/archive.test.ts` passes.
- [ ] No `DELETE` exports; no website/deployment deletes (`tests/unit/boundaries.test.ts`).
- [ ] No Docker/`child_process` in `src/`; site template has no `RUN`.
- [ ] Site containers: read-only, cap-drop ALL, no-new-privileges, non-root, limits, `ds-sites` internal network.
- [ ] Worker builds stay on the classic builder (`DOCKER_BUILDKIT=0`); no buildx/BuildKit builder, `--privileged`
      or host-mount container can be created (R-01 — the socket-proxy filter does not prevent it).
- [ ] `.dockerignore` still excludes `.env*` (except examples), `node_modules`, `.next`.
- [ ] Build artifact hash verified before release; status changes via `transition()` with fencing.

Data, secrets, logging
- [ ] No secrets/tokens/cookies/raw IPs in logs or audit metadata; new audit action has a `result`.
- [ ] Raw SQL only via tagged templates; runtime DB account still DML-only.
- [ ] `npm audit --omit=dev` clean.
- [ ] `docs/security/residual-risks.md` and the relevant docs updated with status labels.
- [ ] Nothing claimed as verified without evidence in `docs/verification.md`.
