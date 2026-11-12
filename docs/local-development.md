# Local development

## Prerequisites

- Node.js ≥ 22.12 (developed with Node 26, npm 11), Docker Desktop / Docker Engine.
- `npm install`. npm 11 blocks install scripts until approved — approve `prisma`, `@prisma/engines` and `esbuild`
  (already recorded in `package.json` → `allowScripts`).

## Option A — app on the host (fast UI/API iteration)

1. **MySQL** (loopback port 3307, as used by the test suite):
   ```bash
   docker run -d --name ds-mysql -e MYSQL_ROOT_PASSWORD=devroot -e MYSQL_DATABASE=deploy_studio \
     -e MYSQL_USER=deploy_studio -e MYSQL_PASSWORD=devpass -p 127.0.0.1:3307:3306 mysql:8.4
   # the integration tests create deploy_studio_test themselves; allow that and the Prisma shadow DB:
   docker exec ds-mysql mysql -uroot -pdevroot -e "GRANT ALL ON *.* TO 'deploy_studio'@'%'; FLUSH PRIVILEGES;"
   ```
   (Broad grant = local only. Production uses `infra/mysql/grants.sh`.)
2. **`.env`** (copy `.env.example`; minimal working local values):
   ```env
   APP_URL=http://localhost:3000
   DATABASE_URL=mysql://deploy_studio:devpass@localhost:3307/deploy_studio?allowPublicKeyRetrieval=true
   ALLOWED_EMAIL_DOMAINS=deploystudio.test   # domains that may be enrolled (required in production)
   STORAGE_ROOT=./data/storage
   SITES_BASE_URL=http://sites.localhost:8080
   PREVIEW_BASE_URL=http://preview.localhost:8080
   GATEWAY_SIGNING_SECRET=<32+ random chars>
   HEALTH_PROBE_TOKEN=<24+ random chars>
   ```
   All variables are documented in `.env.example` (including the account settings `PASSWORD_MIN_LENGTH`,
   `ARGON2_*`, `PASSWORD_LINK_TTL_HOURS`, `RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT`, `ADMIN_STEP_UP_MAX_AGE_MINUTES`,
   whose defaults are fine locally). Config is validated at first use; errors list the offending
   **names** (never values).
3. **Migrate + seed:** `npm run db:migrate` then optionally `SEED_DEPARTMENTS="DTD,ERP,KA" npm run db:seed`.
4. **Bootstrap the first administrator** (there are no test accounts, shared passwords or identity pickers — every
   account signs in through the real login):
   ```bash
   npm run admin -- create-user --email first.admin@deploystudio.test --name "First Admin" --role ADMIN --operator <you>
   ```
   The CLI uses `DATABASE_URL` from `.env` and prints a **one-time setup link** (`<APP_URL>/password#token=…`,
   valid `PASSWORD_LINK_TTL_HOURS`). Then `npm run dev` → open the link, choose a password (≥ `PASSWORD_MIN_LENGTH`,
   default 15 characters) and sign in at http://localhost:3000/login. Further accounts (USERs with a department,
   other admins) are created on **Enroll IDs** (`/admin/users`), which shows each new setup link once. Without the
   Docker stack the preview cannot be displayed (next step).
5. **Worker:** `npx tsx --env-file=.env worker/src/main.ts` with `RUNTIME=fake` (nothing is built or served — the
   flow reaches `PREVIEW_READY`/`LIVE` in the DB, but the preview iframe has nothing to load). `RUNTIME=docker`
   requires the compose stack (the worker reaches site containers by container name on `ds-sites`).
   (`npm run worker` loads `.env` via dotenv.)

## Option B — full stack with Docker Compose

```bash
cp .env.compose.example .env.compose        # edit secrets; keep REQUIRE_SEPARATE_SITE_DOMAINS=false locally
docker compose --env-file .env.compose up --build
docker compose --env-file .env.compose --profile security up -d clamav   # optional ClamAV (MALWARE_SCAN_MODE=clamav)
```

- Deploy Studio: http://studio.localhost:8080 (set `APP_URL` accordingly). The published port is
  `DS_HTTP_PORT` (default 8080) — if 8080 is taken on your machine, set e.g. `DS_HTTP_PORT=8090` and change the
  `:8080` in `APP_URL`, `SITES_BASE_URL`, `PREVIEW_BASE_URL` to match.
- Sites: `http://<dept>-<site>.sites.localhost:8080`, previews: `http://<random>.preview.localhost:8080` — browsers
  resolve `*.localhost` to loopback. Every request goes through the gateway.
- Services: `mysql` (internal network, loopback-only port 3308), `migrate` (one-shot, `ds_migrate` account), `web`
  (read-only, non-root, no Docker socket), `worker` (Docker API only via `docker-socket-proxy`), `proxy` (Traefik),
  optional `clamav`. See `docker-compose.yml` header for network roles.
- `.env.compose.example` sets `NODE_ENV=production` (the standalone image always runs in production mode), so
  `ALLOWED_EMAIL_DOMAINS` must be set — locally e.g. `ALLOWED_EMAIL_DOMAINS=deploystudio.test` — and the Argon2id cost
  may not go below the OWASP minimum. This normal stack is also the local test environment (there is no separate
  test override and no development login).
- **First administrator:** the infra-only `admin` service (compose profile `tools`, image stage `tools` in
  `docker/web.Dockerfile`, DB network only, nothing listens) runs `scripts/admin.ts` against the stack's MySQL:
  ```bash
  docker compose --env-file .env.compose --profile tools run --rm admin create-user \
    --email first.admin@deploystudio.test --name "First Admin" --role ADMIN --operator <you>
  ```
  It prints a one-time setup link on `APP_URL`. Open it, set a password, sign in at
  `http://studio.localhost:<DS_HTTP_PORT>/login` and enroll further accounts (USERs with departments) on **Enroll IDs**.
  Dropping files uploads immediately; the preview (a real isolated container behind the gateway) replaces the
  dropzone, and **Deploy to Production** unlocks once it has loaded.
- Without Docker for the CLI: `npm run admin -- create-user …` works too, provided `DATABASE_URL` points to the
  stack's MySQL (loopback port 3308, `ds_app` account and `DS_APP_PASSWORD`) — not separately verified.
- End-to-end check: `scripts/e2e-compose.sh` (local stack only) enrolls its own test accounts with real Argon2id hashes
  and signs in through the real `POST /api/v1/auth/login` endpoint of the production image. What has actually been
  run is recorded in `docs/verification.md`.
- DB account passwords come from `DS_APP_PASSWORD` / `DS_MIGRATE_PASSWORD`; `infra/mysql/grants.sh` reads them on
  first MySQL init (changing them later requires `ALTER USER` or recreating the `mysql-data` volume).
- `.dockerignore` keeps `node_modules`, `.next`, `data/` and all `.env*` files (secrets) out of image build contexts.

## Tests

| Command | Needs | Covers |
|---|---|---|
| `npm test` | nothing | unit (archive security, policy, passwords/Argon2id/policy, tokens, config guards, boundaries, compose/route config) + UI (jsdom, incl. Enroll IDs and the admin sidebar) |
| `npm run test:integration` | MySQL | login/passwords/links (`auth.test.ts`), enrollment (`enrollment.test.ts`), authorization, sessions/CSRF, upload API, gateway, deployment safety (fake runtime) |

Integration tests use `TEST_DATABASE_URL` (default
`mysql://deploy_studio:devpass@localhost:3307/deploy_studio_test?allowPublicKeyRetrieval=true`). The database name
**must end in `_test`** (the global setup refuses otherwise); it is created and migrated automatically and tables are
truncated between tests. Tests create fixture accounts in the test database and sign in through the real login
endpoint (no test-only login route exists). Also run `npm run typecheck` and `npm run lint`.

## Admin CLI (protected operations)

Run from an operations host with DB access (never exposed over HTTP); `--operator` is mandatory and audited. Day-to-day
account management happens on Enroll IDs; the CLI bootstraps the first admin and covers incidents (full command list
in the header of `scripts/admin.ts`; in compose use `docker compose --env-file .env.compose --profile tools run --rm admin <command> …`):

```bash
npm run admin -- list-users --operator alice
npm run admin -- create-user --email first.admin@company.com --name "First Admin" --role ADMIN --operator alice
npm run admin -- reset-password --email someone@company.com --operator alice     # prints a one-time reset link
npm run admin -- revoke-sessions --email someone@company.com --operator alice
npm run admin -- disable-user --email someone@company.com --operator alice
npm run admin -- enable-user --email someone@company.com --operator alice
npm run admin -- suspend-website --department "DTD" --reason "incident 123" --operator alice
npm run admin -- quarantine-deployment --deployment <uuid> --reason "malicious JS" --operator alice
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Invalid configuration: GATEWAY_SIGNING_SECRET, …` | Missing/invalid env vars (names listed). Check `.env` vs `.env.example` |
| `must not contain the management host` / `different registrable domain` | `SITES_BASE_URL`/`PREVIEW_BASE_URL` overlap `APP_URL`; production requires separate registrable domains |
| API returns `421 HOST_NOT_ALLOWED` | `Host` header differs from `APP_URL` (e.g. using 127.0.0.1 vs localhost, or behind a proxy). Fix `APP_URL` or add `APP_ALLOWED_HOSTS` |
| Logged in but every POST returns `403 CSRF_FAILED` | Page origin ≠ `APP_URL` origin, or stale page after session change — reload |
| Session cookie not kept | On https `APP_URL` the cookie is `__Host-` + Secure; don't mix http/https hosts |
| Preview iframe blank / "Preview locked" | `frame-src` comes from `PREVIEW_BASE_URL` (proxy.ts); preview cookie is SameSite=None + Partitioned and needs a secure context (https or `*.localhost`); handshake links expire after 2 minutes — click Refresh preview |
| Site URL loops to login | Management session expired or user not in that department (403 page) |
| `ALLOWED_EMAIL_DOMAINS is required in production` | Set it in `.env.compose` (e.g. `deploystudio.test` locally) |
| `EMAIL_DOMAIN_NOT_ALLOWED` when enrolling | The email's domain is not in `ALLOWED_EMAIL_DOMAINS` |
| Sign-in always says "Email or password is incorrect" | Account not yet ACTIVE (setup link not used), disabled/removed, or wrong password (deliberately the same message). "Too many requests" (`429`) = temporarily locked after `RATE_LIMIT_LOGIN_FAILURES_PER_ACCOUNT` failures per 15 min or the per-IP limit — wait for the window to end. Issue a new link from Enroll IDs or `reset-password` |
| Setup/reset link says invalid | Already used, expired, or superseded by a newer link — issue a new one |
| Routes never appear in Traefik | Worker `ROUTES_DIR` must be the volume mounted at `/etc/traefik/dynamic`; check worker logs for `invalid host/upstream` |
| Worker: `docker build failed` / cannot connect | `DOCKER_HOST` must point to `docker-socket-proxy`. The worker builds with `DOCKER_BUILDKIT=0` (classic builder) — never enable buildx's docker-container driver: it creates a privileged helper container. `DOCKER_CONFIG` must be writable (`/tmp/.docker`). Also check endpoints) |
| `Cannot find module '@/generated/prisma/client'` | Run `npm run db:generate` (generated client is git-ignored) |
| Integration tests: `Refusing to run … non-*_test database` | Set `TEST_DATABASE_URL` to a database ending in `_test` |
| Every test file fails with `Cannot read properties of undefined (reading 'config')` at `describe` | Windows + Git Bash: run from a `c:/…` path, not `/c/…` (the different path spelling loads Vitest twice) |
