# Docker and worker isolation

| Control | Implementation | Status |
|---|---|---|
| Web app has no Docker socket, CLI or `child_process` | `docker-compose.yml`, ESLint rule, `tests/unit/boundaries.test.ts` | Tested (static) |
| Docker socket mounted only into `docker-socket-proxy`, read-only | compose | Config-Tested |
| Worker uses filtered API (`DOCKER_HOST=tcp://docker-socket-proxy:2375`; EXEC/VOLUMES/SWARM/SECRETS/SYSTEM/AUTH denied) | compose | Implemented; **POST/CONTAINERS/BUILD still allow creating arbitrary containers** (R-01) |
| Worker container: non-root (1000), read-only rootfs, tmpfs, cap-drop ALL, no-new-privileges, CPU/memory limits | compose, `docker/worker.Dockerfile` | Implemented |
| Web container: same hardening, non-root, read-only | compose, `docker/web.Dockerfile` | Implemented (verified running read-only with a tmpfs `.next/cache` in the e2e run) |
| No privileged containers | compose | Config-Tested |
| Images only from `infra/site-template` (COPY only, no RUN, `USER 101`) | template, `worker/src/build.ts` | Tested (`routing.test.ts`) |
| Builds with `--network=none` | `worker/src/runtime/docker.ts` | Implemented |
| Site containers: `--read-only`, tmpfs `/tmp` noexec/nosuid/nodev, `--cap-drop ALL`, `no-new-privileges`, `--user 101:101`, memory/CPU/pids limits, log rotation | `docker.ts` `startContainer` | Implemented; runtime-verified locally (`docs/verification.md` §3) |
| Site network `ds-sites` `internal: true` (no egress, no company services, no metadata endpoint) | compose | Config-Tested; host/cloud egress rules **Blocked** |
| Image scanning hook (`IMAGE_SCAN_COMMAND`, e.g. Trivy) blocks preview on findings | `docker.ts` `scanImage` | Implemented, **not configured by default** (R-09) |
| Base images pinned by digest | Dockerfiles use tags | **Planned** (R-10) |
| docker CLI invoked without shell (argument arrays), timeouts, stderr only to worker logs | `docker.ts` | Implemented |

## ADR 0001 — per-site hardened static containers (pending approval)
The security spec prefers serving static artifacts from a trusted gateway over running a container per
department. Current design: per-revision **nginx-unprivileged** containers built from a controlled template
(no user code executes server-side), always behind the gateway. Trade-offs: stronger per-site isolation and simple
rollback vs. larger Docker attack surface (socket proxy) and resource use. Alternative: one hardened read-only
nginx serving immutable artifact directories per host. **Decision requires approval** (R-11).

## Recommendations
Run the worker + Docker daemon on a dedicated VM or rootless Docker; consider gVisor/Kata for site containers;
enforce egress deny at the host firewall/cloud security group.
