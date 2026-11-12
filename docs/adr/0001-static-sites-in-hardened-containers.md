# ADR 0001 — Serve department sites from hardened per-site containers behind the gateway

- **Status:** Proposed — **requires approval** (deviates from the security specification's stated preference)
- **Date:** 2026-11-11

## Context

The security specification (§13 "Static Hosting Optimization") prefers *private static artifact delivery through a
trusted gateway* over running a container per department. The original product brief asked for a controlled
Dockerfile template and Docker-based packaging. At the time the specification arrived, per-site packaging and
release (build, readiness checks, atomic switch, rollback) were already implemented around containers.

## Decision

Keep one container per **active revision** (plus short-lived preview containers), built only from
`infra/site-template/`:

- `nginxinc/nginx-unprivileged` base (pin by digest in production), uploaded files `COPY`'d only — **no `RUN` steps**,
  no uploaded Dockerfiles, `docker build --network=none`.
- Runtime flags: `--read-only`, tmpfs `/tmp` (noexec), `--cap-drop ALL`, `no-new-privileges`, `--user 101:101`,
  memory / CPU / PID limits, on the `ds-sites` network (`internal: true`, no egress).
- nginx serves GET/HEAD only, `Cache-Control: private, no-store`, restrictive CSP (`connect-src 'self'`), blocks service
  worker registration, `frame-ancestors` limited to Deploy Studio.
- **All** traffic reaches these containers only through Traefik with the `ds-gateway` forward-auth middleware; no
  route to hosted content exists without it.

No user-supplied server-side code ever executes: nginx is trusted code; uploaded content is static data.

## Consequences

- (+) Strong runtime isolation between departments (separate processes, filesystems, resource quotas).
- (+) Immutable, content-addressed images; rollback restarts a known image (or rebuilds from the stored build artifact).
- (−) The worker needs Docker API access (mitigated by `docker-socket-proxy`; still equivalent to host root if the
  worker is compromised — see docs/security residual risks). Recommended: dedicated VM / rootless Docker for the worker.
- (−) More moving parts (container lifecycle, reconciliation) than a static file server.

## Alternative (recommended for future evaluation)

A single trusted static file server (behind the same gateway) that maps `Host` → website → active revision and streams
files from the **immutable build artifact** in private storage (`builds/<website>/<deployment>.zip`, hash-verified).
No per-site containers and no Docker access for the worker at runtime (Docker only for packaging, or not at all).

## Migration path

The worker talks to infrastructure only through two interfaces — `SiteRuntime` (`worker/src/runtime/types.ts`) and
`Router` (`worker/src/routing/types.ts`). The alternative can be introduced as a new runtime/router pair whose
"start" registers a revision with the file server and whose health check probes it via the proxy; the state machine,
fencing, gateway and API stay unchanged.
