# Incident response

Account containment uses **Enroll IDs** (`/admin/users`, ADMIN, password re-authentication): **Disable** (blocks
sign-in, ends sessions), **Reset password** (one-time link shown once, ends sessions), **Remove** (soft revocation:
sign-in impossible, links expired, sessions ended, history kept), role/department edits (end sessions). See
[enrollment.md](../enrollment.md). Website containment tools are deliberately **not** in the web UI/API (no Delete).
Authorized infrastructure operators use the protected admin CLI (`scripts/admin.ts`, DB credentials required, not
reachable over HTTP) when the UI is unavailable or for website containment:

```bash
npm run admin -- <command> --operator <your-id> [options]
# compose (infra-only service, profile "tools"):
docker compose --env-file .env.compose --profile tools run --rm admin <command> --operator <your-id> [options]
```
Every command is audited with the operator name (self-declared, R-20), the target user and a correlation id.

| Command | Effect |
|---|---|
| `list-users` | email, name, role, department, status |
| `create-user --email --name --role ADMIN\|USER [--department <label>]` | enroll (bootstrap / break-glass admin); prints a one-time setup link |
| `reset-password --email` | prints a one-time reset link (supersedes older links) and revokes sessions |
| `revoke-sessions --email` | delete all sessions (gateway access ends within ≤10 s) |
| `disable-user --email` / `enable-user --email` | deprovision: blocks login + revokes sessions / restore (an account without a password returns to INVITED) |
| `create-department --department <label>` | pre-create a department (grants nothing) |
| `suspend-website --department <label> --reason <text>` / `unsuspend-website` | gateway returns 423 immediately; worker removes the route and stops the container at next reconcile (≤ `RECONCILE_INTERVAL_SECONDS`); uploads/promotions blocked |
| `quarantine-deployment --deployment <id> --reason <text>` | revision can never be previewed/promoted/rolled back to; if active, the site goes offline — roll back |

Role/department changes and removal ("Remove") are done on Enroll IDs; the CLI has no command for them. Note: the CLI
does not apply the Enroll IDs safety rules (last-admin protection, no self-change) — operators must not disable the
last active administrator.

Rollback to a known-good revision: Deploy Studio UI (Version history → Roll back) or
`POST /api/v1/websites/:id/rollback` (ADMIN needs a recent password re-authentication for other departments).

## Playbooks
1. **Compromised user account** — on Enroll IDs **Disable** the account (or CLI `disable-user --email`), which ends
   its sessions; review `audit_logs` by `actor_user_id` and `target_user_id` (LOGIN, LOGIN_DENIED,
   PASSWORD_CHANGED/PASSWORD_SET, uploads, promotions, GATEWAY_* events); roll back any unauthorized revision. To
   restore access, **Reset password** (or CLI `reset-password --email`), hand the new link to the verified person
   through an approved internal channel, then re-enable. If the person should no longer have access, **Remove**.
2. **Compromised administrator** — as above (another ADMIN acts; the CLI if no other admin is available) plus: review
   USER_CREATED, ROLE_CHANGED, MEMBERSHIP_CHANGED, USER_ENABLED, PASSWORD_RESET_ISSUED, DEPARTMENT_CREATED and
   `PRIVILEGE_CHANGE` alerts issued by that actor and revert them on Enroll IDs (disable/remove accounts it created or
   promoted, reset passwords it may have learned through links it issued); review cross-department
   PROMOTION/ROLLBACK; rotate `GATEWAY_SIGNING_SECRET`; verify every website's active revision.
3. **Credential stuffing / brute force** (`REPEATED_LOGIN_FAILURES` alerts, many `LOGIN_DENIED`) — accounts and IPs are
   locked automatically for the window; check whether any targeted account then logged in successfully (LOGIN after
   LOGIN_DENIED bursts) and treat it as playbook 1; block sources at the edge/WAF (R-14, R-15).
4. **Leaked one-time link** — issue a new link for that account (the old one stops working) or disable the account;
   if it was already used by someone else, follow playbook 1 (R-27).
5. **Malicious uploaded website** — `suspend-website` (immediate), `quarantine-deployment` for the bad revision,
   roll back, `unsuspend-website`; preserve the source/build artifacts (do not delete) for forensics.
6. **Leaked credentials / secrets** — rotate and restart web + worker:
   - `GATEWAY_SIGNING_SECRET`: invalidates all gateway cookies/handshakes (users re-handshake transparently).
   - `HEALTH_PROBE_TOKEN`: update web and worker together.
   - DB passwords (`ds_app`, `ds_migrate`): `ALTER USER`, update secret store.
   - Revoke all sessions (`DELETE FROM sessions` by a DBA) if management sessions may be exposed.
   - If password hashes may have leaked (DB dump): treat as a database compromise — revoke all sessions and issue
     reset links to every account (Argon2id slows, but does not prevent, offline guessing of weak passwords).
7. **Data exposure** — suspend affected site, identify accessors via `GATEWAY_SESSION_ISSUED`/`GATEWAY_DENIED`
   audit rows and proxy logs, notify per corporate policy.
8. **Container compromise** — stop the container (`docker rm -f ds-site-<id>` by an infra admin), suspend the
   website, snapshot the host for forensics, rebuild the worker host, rotate secrets reachable from it.
9. **Suspicious deployment activity** — check `SECURITY_ALERT` and `PROMOTION_REQUESTED` rows; suspend; review.
10. **Service outage** — worker reconciles routes to DB pointers on start; check `deployment_jobs` for stuck
    RUNNING jobs (reaper recovers after lease expiry); `/api/health`.
11. **Database compromise** — isolate DB, restore from backup (procedure **untested — Blocked**), rotate all
    secrets, reset all passwords (see 6), verify active pointers and audit continuity.
12. **Unauthorized website replacement** — roll back to the last known-good revision, quarantine the bad one,
    investigate the actor, disable the account or revoke its sessions.

## Log preservation
Export `audit_logs`, `deployment_logs`, worker/web stdout and proxy access logs before remediation; audit rows are
append-only in the DB but should also be shipped off-host (Planned).

## Recovery verification
Confirm: active revision per website matches expectation; Traefik route files match DB pointers (worker log
`worker.route_reconciled`); anonymous requests to each site return 302 to sign-in; affected users cannot log in /
regain access (status DISABLED/REVOKED on Enroll IDs); new `SECURITY_ALERT` rows are absent.
