---
name: deploy-studio-deployment
description: Use when changing Deploy Studio's upload-to-preview flow, site image builds, the deployment worker or job queue, Docker/socket-proxy isolation, artifact storage and integrity, private previews, site hosting, Traefik routes, production promotion, rollback, reconciliation, or deployment status transitions. Enforces immutable revisions, safe replacement, serialization, fencing, isolation and rollback.
---

# Deploy Studio — deployment workflow

## When to use
- Any change under `worker/`, `src/server/deployments/`, `src/server/services/deployments.ts`, `src/server/storage/`,
  `infra/site-template/`, `infra/traefik/`, `docker/`, `docker-compose.yml`, or suspend/quarantine in `scripts/admin.ts`.
- Changing deployment statuses, job types, release order, preview behaviour or container flags.
- Not for: who may promote or view (`deploy-studio-auth`); ZIP validation (`deploy-studio-security`).

## Responsibilities
Upholds AGENTS.md invariants 6, 7 (route wiring), 10, 11 and 12. Owns the job queue, build/release/rollback, Docker
isolation, routing and reconciliation. The hosting model (container per revision) is **pending ADR 0001**: keep all
runtime access behind `SiteRuntime` (`worker/src/runtime/types.ts`) so a gateway-served static model can replace it.

## Workflow
1. Identify the invariant(s) below that the change touches.
2. Write the failure paths first: build fails, health check fails, crash mid-step, two promoters, stale worker,
   tampered artifact, image pruned, route write fails.
3. Implement with `transition()` + lease fencing; production-affecting actions audited.
4. Verify (fake runtime in integration tests; real stack for Docker/Traefik/compose changes).

## Model
- `websites` (one per department, `department_id UNIQUE`); `active_deployment_id` is **the** production pointer.
- `deployments` — immutable revisions (`version` unique per website); source artifact, build artifact
  (+`build_sha256`) and `image_reference` (content-addressed image id) are write-once.
- `deployment_jobs` — the only web↔worker channel (`BUILD`, `PROMOTE`, `ROLLBACK`).
- Status: `DRAFT → UPLOADED → VALIDATING → BUILDING → PREVIEW_READY → DEPLOYING → LIVE`; `FAILED`; rolled-away
  LIVE → `ROLLED_BACK`. Transitions only via `transition()` (`src/server/deployments/state.ts`).
- Incident flags (admin CLI): `websites.suspended_at`, `deployments.quarantined_at` — block every change/serve.

## Invariants
1. Failure never touches production: build/validation/preview errors only affect the revision; release
   failures restore the previous route and leave the pointer (`worker/src/release.ts`).
2. Release order: integrity check (`sha256(build artifact) == build_sha256`) → start new container → direct
   readiness check → atomic route-file rename → verify through proxy (probe token) → fenced DB commit of the
   pointer → retire old container after drain. Image missing → rebuild from the stored build artifact.
3. DB is the source of truth: `reconcileWebsite()` / `reconcileAll()` converge routes/containers; suspended or
   quarantined-active sites are taken offline.
4. One active PROMOTE/ROLLBACK per website: `active_lock_key` UNIQUE + website row lock → 409.
5. Fencing: `FOR UPDATE SKIP LOCKED` claim, per-claim `lease_token`, every write checks it; reaper requeues
   builds and fails production jobs (`WORKER_LOST`).
6. Idempotency: `Idempotency-Key` on uploads; promote/rollback idempotent by state.
7. API only enqueues. Never Docker or long work in a request.
8. Images only from `infra/site-template` (nginx-unprivileged, `COPY` only — no `RUN`, no `COPY --chmod`),
   built with `--network=none` by the **classic builder** (`DOCKER_BUILDKIT=0` in `worker/src/runtime/docker.ts`).
9. Hosted content is private: every route gets `ds-gateway@file`; previews and sites on separate origins.
10. A preview is `PREVIEW_READY` only after the proxy serves it (probe through Traefik). Its host is registered first
    without `preview_expires_at`, so the gateway answers the worker's probe but never serves it to users early.
11. Gateway redirects on hosted origins are absolute (configured scheme/port + validated host) — relative `Location`
    headers get rewritten to the internal upstream by some servers (`next dev`).

## Isolation (`docs/security/docker-isolation.md`)
- Worker → `DOCKER_HOST` = `docker-socket-proxy` (socket mounted read-only only there). The filter does **not** stop
  privileged containers (R-01; observed when buildx auto-created a privileged BuildKit container). Treat the Docker
  API as root-equivalent: no buildx/BuildKit builders, no `--privileged`, no host mounts, no new API sections.
- Site containers: `--read-only`, tmpfs `/tmp` noexec, `--cap-drop ALL`, `no-new-privileges`, user 101, memory/
  CPU/pids limits, `ds-sites` internal network (no egress). Web has no socket, no CLI.
- Build contexts: the repo `.dockerignore` keeps secrets and host artifacts out; the worker writes site contexts
  with 0644 files / 0755 dirs owned by root in the image.

## Routing (`infra/traefik/`, `worker/src/routing/`)
- Traefik's file provider watches **one directory, non-recursively**: the worker installs
  `infra/traefik/dynamic/00-infra.yml` into the routes directory and writes route files there via atomic rename.
- The `buffering` (body-size) middleware applies only to the upload router — it breaks empty-body redirects elsewhere.

## Verification
- [ ] State via `transition()` + fence; user-facing `error_code` only (`src/lib/status-labels.ts`); production
      actions audited.
- [ ] Tests: `tests/integration/deployment-safety.test.ts`, `tests/integration/gateway.test.ts`,
      `tests/unit/routing.test.ts` (route + compose invariants), `tests/unit/boundaries.test.ts`.
- [ ] `npm run typecheck && npm run lint && npm test && npm run test:integration` pass.
- [ ] Docker/Traefik/compose/template change → run `scripts/e2e-compose.sh` on the local stack, check no
      privileged containers exist (`docker ps -aq | xargs docker inspect -f '{{.Name}} {{.HostConfig.Privileged}}'`),
      and record the evidence in `docs/verification.md`.
- [ ] Update `docs/security/deployment-integrity.md`, `docs/deployment-lifecycle.md`, and
      `docs/security/docker-isolation.md` for isolation changes.
