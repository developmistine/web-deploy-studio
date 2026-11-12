# Deploy Studio

Internal corporate platform where each department uploads, previews and publishes **one private static website**.
It is built from the `deploy-studio-layout-updated.html` prototype with a production-oriented backend: local Deploy
Studio accounts (corporate email + Argon2id-hashed password, admin-managed enrollment), server-side RBAC (ADMIN / USER by department), immutable deployment revisions, isolated previews, a private
website gateway and safe atomic releases with rollback.

> **Status: development build. Production release gates are NOT satisfied.**
> **MFA is not implemented** (deferred by the owner, 2026-11-11 — release blocker); sign-in is single-factor
> email + password. DNS/TLS, the production network, malware/image scanning and a security review have not been verified.
> See [docs/security/release-gates.md](docs/security/release-gates.md) before any production use.
> What *has* been verified (270 automated tests, a 27-check end-to-end run on the Docker stack with real email/password login, and the defects it found):
> [docs/verification.md](docs/verification.md). Re-run the e2e with `DS_HTTP_PORT=8090 bash scripts/e2e-compose.sh`
> after `docker compose --env-file .env.compose up -d --build` (local stack only).

## How it works (one paragraph)

The Next.js app (management UI + `/api/v1`) validates uploads, stores them in private storage and enqueues jobs in
MySQL. Users sign in with their corporate email and a Deploy Studio password; accounts, roles and department
membership are created only by administrators on **Enroll IDs** (no self-registration, no SSO — planned, ADR 0002).
A separate **worker** — the only component with (proxied) Docker access — re-validates, packages the site into a
controlled nginx image, starts an isolated preview, and on request switches production only after readiness checks.
**Traefik** routes `*.sites.*` and `*.preview.*` hostnames; every request to them passes the **forward-auth gateway**,
which checks the user's Deploy Studio session and department authorization. Details: [docs/architecture.md](docs/architecture.md).

## Quick start (local development)

Prerequisites: Node.js ≥ 22.12 (developed on 26), Docker.

```bash
npm install                      # npm 11 may ask to approve install scripts: prisma, @prisma/engines, esbuild
cp .env.example .env             # then edit; see docs/local-development.md for a working local set
docker run -d --name ds-mysql -e MYSQL_ROOT_PASSWORD=devroot -e MYSQL_DATABASE=deploy_studio \
  -e MYSQL_USER=deploy_studio -e MYSQL_PASSWORD=devpass -p 3307:3306 mysql:8.4
npm run db:migrate && SEED_DEPARTMENTS="DTD,ERP,KA" npm run db:seed
npm run admin -- create-user --email first.admin@<allowed-domain> --name "First Admin" --role ADMIN --operator <you>
                                 # prints a one-time setup link (needs ALLOWED_EMAIL_DOMAINS in .env)
npm run dev                      # http://localhost:3000 — open the setup link, set a password, then sign in
npx tsx --env-file=.env worker/src/main.ts   # worker; RUNTIME=fake builds nothing, RUNTIME=docker needs the compose stack
```

There are no test identities or shared passwords: every account, including local development ones, is enrolled and signs in
through the real login. Full stack with gateway, worker and real containers (also the local test environment):
`docker compose --env-file .env.compose up -d --build` with `ALLOWED_EMAIL_DOMAINS` set in `.env.compose` (e.g.
`deploystudio.test` locally), then bootstrap the first admin with the infra-only `admin` service:

```bash
docker compose --env-file .env.compose --profile tools run --rm admin create-user \
  --email first.admin@deploystudio.test --name "First Admin" --role ADMIN --operator <you>   # prints a one-time setup link
```

Details: [docs/local-development.md](docs/local-development.md).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js app |
| `npm run worker` / `worker:dev` | Deployment worker (tsx) |
| `npm run admin -- <command> --operator <you>` | Protected admin CLI (bootstrap first admin, password reset links, disable, session revocation, suspend, quarantine) — `scripts/admin.ts` |
| `npm run typecheck` | `prisma generate` + `tsc --noEmit` |
| `npm run lint` | ESLint 9 (next core-web-vitals + typescript) |
| `npm test` | Unit + UI tests (no DB needed) |
| `npm run test:integration` | DB-backed tests (MySQL, database name must end in `_test`) |
| `npm run db:migrate` / `db:migrate:dev` / `db:seed` / `db:generate` | Prisma |

## Repository layout

```
src/app/            Next.js pages + Route Handlers (/api/v1 incl. /auth and /admin/users, /api/gateway, /api/internal/gate)
src/server/         Server-only: config, db, auth (passwords, sessions, password links), authz policy, services, uploads, storage, gateway
src/components/     React components converted from the prototype
src/lib/            Client-safe types, validation (Zod), API client
worker/src/         Deployment worker: job queue, build, release, reconcile, Docker runtime, Traefik router
prisma/             Schema, migrations (incl. append-only audit triggers), seed
infra/              Traefik config, site image template, MySQL grants
docker/             web + worker Dockerfiles
scripts/admin.ts    Protected administration CLI
tests/              unit, ui (jsdom), integration (MySQL + fake runtime)
docs/               Documentation (below)
AGENTS.md, .agents/skills/   Project rules and agent skills
```

## Documentation

- [Architecture](docs/architecture.md) · [ADR 0001 — static sites in hardened containers](docs/adr/0001-static-sites-in-hardened-containers.md)
- [Authentication](docs/authentication.md) · [Enrollment (Enroll IDs)](docs/enrollment.md) · [Authorization](docs/authorization.md) · [ADR 0002 — local accounts](docs/adr/0002-local-accounts.md)
- [Deployment lifecycle](docs/deployment-lifecycle.md) · [Database](docs/database.md) · [API](docs/api.md)
- [Security overview](docs/security.md) → detailed set in [docs/security/](docs/security/)
- [Local development & troubleshooting](docs/local-development.md)

## Non-negotiables

One website per department · authorization from role + department (never the uploader, never client input) ·
no Delete UI/API · immutable revisions · a failed replacement never touches production · uploaded content never runs
on the management origin. See [AGENTS.md](AGENTS.md).
