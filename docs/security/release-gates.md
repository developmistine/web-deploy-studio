# Production release gates (spec §24)

Deploy Studio is **not production-ready**. All gates must be satisfied with recorded evidence and remaining risks
formally accepted.

| # | Gate | Status | Evidence / blocker |
|---|---|---|---|
| G1 | Authentication verified (local accounts, ADR 0002; formerly "OIDC with the corporate IdP" — SSO removed, Planned) | ⚠️ Partial | local email/password sign-in, Argon2id, throttling, one-time links, sessions: Implemented + Tested (`auth.test.ts`, `password.test.ts`, `session-security.test.ts`; `scripts/e2e-compose.sh` signs in through the real login on the compose stack; recorded run results: `docs/verification.md`). Production use still needs HTTPS (Blocked by external infrastructure) and a security review of the local-account model (G19) |
| G2 | MFA implemented and verified | ❌ Blocked — not implemented (owner deferred, 2026-11-11) | single-factor password sign-in on an Internet-facing system (R-25); release blocker until MFA exists or the risk is formally accepted |
| G3 | Trusted department membership source exists | ⚠️ Partial | admin-managed enrollment (Enroll IDs + infra-only CLI bootstrap) is the only source; self-escalation and last-admin lock-out blocked (Implemented + Tested: `enrollment.test.ts`, `admin.test.tsx`; run evidence to be recorded in `docs/verification.md`). Organisational process for who may request enrollment — not defined |
| G4 | Server-side RBAC tests pass | ✅ Locally | `authorization.test.ts`, `policy.test.ts` (see `docs/verification.md`) |
| G5 | Cross-department access blocked | ✅ Locally (app) | API + gateway tests; infra pending |
| G6 | Private Website Gateway functional | ⚠️ Partial | verified end-to-end through Traefik on the local compose stack (anonymous redirect, department allow/deny, host-bound cookies — `docs/verification.md` §3); still needs TLS and production domains |
| G7 | All static assets protected | ⚠️ Partial | gateway on every route (renderer tested); e2e pending |
| G8 | Preview and management origins isolated | ⚠️ Partial | config checks; real separate registrable domains Blocked |
| G9 | Direct storage / origin bypass blocked | ⚠️ Config only | needs network verification |
| G10 | Upload validation tests pass | ✅ Locally | `archive.test.ts`, `upload-api.test.ts` |
| G11 | Worker isolation verified | ❌ Not met | site containers verified isolated at runtime (no egress, no access to web/MySQL, hardened flags). Worker is still root-equivalent through the Docker API (R-01): the e2e run showed buildx could create a privileged container through the proxy |
| G12 | No privileged Docker access from Next.js | ✅ Locally verified | compose + source scan + runtime check (no socket in the web container, uid 1000) |
| G13 | Safe replacement tests pass | ✅ Locally | fake-runtime failure injection + real Docker/Traefik promotion; real failed releases left production unchanged (`docs/verification.md`) |
| G14 | Rollback tests pass | ✅ Locally | integration tests + real rollback v6→v5 on the compose stack |
| G15 | Secrets and dependencies scanned | ⚠️ Partial | `npm audit --omit=dev` = 0; no secret scanning, no image scanning configured |
| G16 | Network access policies verified | ❌ Not met | host firewall/egress/cloud SG — Blocked |
| G17 | Monitoring and audit logging operational | ⚠️ Partial | audit + alerts implemented; SIEM shipping Blocked |
| G18 | Backups and restore tested | ❌ Not met | no backup procedure executed |
| G19 | Security review + authorized penetration test | ❌ Not met | not scheduled |
| G20 | Critical findings resolved, residual risks accepted | ❌ Not met | `residual-risks.md` awaiting acceptance; ADR 0001 pending |

Never skip these gates to complete a development task.
