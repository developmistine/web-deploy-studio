# Agent & skill guidance — change log

Every change to `AGENTS.md` or `.agents/skills/**` is recorded here. Validated by `tests/unit/agent-skills.test.ts`.

## 2026-11-12 (f) — Rename on deploy, simplified My department

**File modified:** `AGENTS.md` (rename is confirmed and applied when deploying; USER My department shows only the latest
version; Thai upload-failure reasons).

## 2026-11-12 (e) — Website rename

**File modified:** `AGENTS.md` (approved deviation: site name / hostname of an existing website can be renamed from the upload
page after a confirmation dialog, immediately; replaces the master prompt's "separate administrative workflow").

## 2026-11-12 (d) — Password policy

**File modified:** `.agents/skills/deploy-studio-auth/SKILL.md` (policy: 8 characters + one letter + one digit, owner decision;
recorded as residual risk R-28).

## 2026-11-12 (c) — Header account row, status switch

**File modified:** `AGENTS.md` (UI preservation: one-line header account row without a change-password button; English role
labels; status switch and Online/Offline filter).

## 2026-11-12 (b) — Enroll IDs redesign & dual branding

**File modified:** `AGENTS.md` (UI preservation: Thai admin navigation labels, header drawer button, `BrandHeader`, shared
`src/components/ui/` primitives, Thai enrollment strings in `src/lib/i18n/enrollment-th.ts`).

## 2026-11-12 — Next.js agent-rules block

`next dev` (Next.js 16.4) appends a `<!-- BEGIN:nextjs-agent-rules -->` block to `AGENTS.md` ("read node_modules/next/dist/docs/
before writing code"). Kept deliberately: the advice is accurate for this Next.js version and the block is re-added by every
`next dev` run. It references no repository paths, so `tests/unit/agent-skills.test.ts` is unaffected.

## 2026-11-11 (e) — Master implementation prompt: local accounts + admin enrollment

**Files modified:** `AGENTS.md` (precedence: master prompt + approved deviations; invariants 2–3, 6, 8, 13 for
local accounts, enrollment, re-auth, soft revocation; admin sidebar in UI rules; architecture boundaries);
`.agents/skills/deploy-studio-auth/SKILL.md` (rewritten: passwords, links, stages, enrollment, re-auth);
`.agents/skills/deploy-studio-security/SKILL.md` (secrets: OIDC secret removed, hashes/tokens);
`.agents/skills/deploy-studio-threat-model/SKILL.md` (IdP boundary → login/password endpoints);
`.agents/skills/deploy-studio-security/references/review-checklist.md` (enumeration, re-auth, enrollment checks).
**Outdated instructions removed:** corporate SSO/OIDC as the only login, claims-based membership, dev test accounts,
"no sidebar", step-up via IdP. **Contradictions resolved:** prompt's Preview button / admin website filter vs. owner
decisions (owner decisions kept, recorded in AGENTS.md); MFA required by the prompt vs. deferred by the owner
(recorded as not implemented + release blocker).

## 2026-11-11 (d) — Suspicious-script check

**File modified:** `.agents/skills/deploy-studio-security/SKILL.md` (upload validation now lists the heuristic
content check, `CONTENT_SCAN_MODE`, and the bounded-regex rule).

## 2026-11-11 (c) — UI adjustments

**File modified:** `AGENTS.md` (UI preservation): page background image removed; Department field without dropdown
arrow; admin All deployments without department filter, each department opens its own page (`?site=<id>`).

## 2026-11-11 (b) — UI refresh, local test accounts, preview readiness

**Files modified:** `AGENTS.md` (UI preservation: approved brand refresh, auto-upload → inline preview → Change file,
username/password test sign-in; Testing: local test stack); `.agents/skills/deploy-studio-auth/SKILL.md` (local test
accounts rule replaces the identity-picker rule); `.agents/skills/deploy-studio-deployment/SKILL.md` (invariants 10–11:
preview readiness through the proxy, absolute gateway redirects).
**Outdated instruction corrected:** AGENTS.md described the old prototype brand and a separate Preview button.

## 2026-11-11 — Synchronization with the approved security specification and verification findings

**Files modified:** `AGENTS.md`; `.agents/skills/deploy-studio-auth/SKILL.md`; `.agents/skills/deploy-studio-security/SKILL.md`;
`.agents/skills/deploy-studio-deployment/SKILL.md`; `.agents/skills/deploy-studio-threat-model/SKILL.md`;
`.agents/skills/deploy-studio-security/references/review-checklist.md`; `tests/unit/boundaries.test.ts`.
**Files created:** `.agents/CHANGELOG.md`; `tests/unit/agent-skills.test.ts`.

### AGENTS.md
- Added *Sources of truth and precedence*: the security specification overrides the original brief; ADR 0001 is
  Proposed (not approved) and the hosting runtime must stay behind `SiteRuntime`; `docs/verification.md` is the record
  of what is verified.
- Invariant 10 extended: the socket-proxy filter is not a security boundary (R-01); no privileged/host-mount/buildx
  containers; classic builder only.
- New invariant 13: secrets never enter images; `.dockerignore` requirements (a missing `.dockerignore` shipped `.env`).
- Invariant 15 (was 14): adds "never claim verification without recorded evidence".
- Invariant 5: "authorization is role + department — never the uploader" made explicit.
- **Corrected:** Testing told agents to use `docker compose up -d mysql` for integration tests — that instance listens
  on 3308 with different accounts and no `_test` database. Now points to `TEST_DATABASE_URL` + `docs/local-development.md`.
- Testing: added the stack end-to-end run (`scripts/e2e-compose.sh`) for Docker/Traefik/compose changes.
- Prohibited: added privileged/buildx containers, bypassing authorization, destructive production tests without approval.
- Replaced the "Before changing…" procedure (duplicated the security skill) with a skill ownership table.
- Added a maintenance rule: log changes here; keep `tests/unit/agent-skills.test.ts` passing.

### Skills (all four)
- Restructured to *When to use* (activation + hand-offs) / *Responsibilities* (AGENTS.md invariants upheld) /
  *Workflow* / rules / *Verification*. Existing rules kept.
- Descriptions shortened to ≤ 500 characters, single line, `name` = folder name.

### deploy-studio-auth
- Added gateway access rules (`canViewHost()`, host-bound handshake, `__Host-ds_gw`, R-06 cache latency) — previously
  implied but unowned. Added "real IdP stays unverified until tested".

### deploy-studio-deployment
- Added: classic builder / no `COPY --chmod`; Docker API treated as root-equivalent (R-01 observation); ADR 0001 pending;
  Traefik non-recursive file watcher and `00-infra.yml` installation; `buffering` only on the upload router; e2e run and
  privileged-container check in Verification; build-context ownership.
- **Corrected:** isolation section implied the filtered API was sufficient.

### deploy-studio-security
- **Corrected:** process referenced an external "spec §26" not present in the repository → now self-contained.
- Added secrets rule for `.dockerignore`, incident-response ownership (`scripts/admin.ts`, no deletes), R-02/R-08/R-09
  pointers, evidence requirement, and the production destructive-test rule. Review checklist gained builder,
  `.dockerignore` and evidence items.

### deploy-studio-threat-model
- Added activation for ADRs/hosting-model changes, explicit hand-off to implementing skills, the rule that risk
  acceptance belongs to the owner, and gates only satisfied with evidence. Added a Docker-API abuse case.

### Validation
- `tests/unit/agent-skills.test.ts` (20 tests): frontmatter (only `name` + `description`, name = folder, kebab-case ≤ 64,
  single-line description ≤ 500 chars), required sections, every referenced path exists, AGENTS.md skill table ↔ folders.
  Mutation check: renaming a skill and pointing at a missing file both fail the suite.
- `tests/unit/boundaries.test.ts`: new guard for the classic builder / no `--chmod` / no `RUN` in the template.
- Result: `npm test` 107/107, `tsc --noEmit` clean, `npm run lint` clean.
- Codex discovery (local, no model call): `codex debug prompt-input` (codex-cli 0.167.0) run in the repository lists
  all four `deploy-studio-*` skills with their descriptions and includes AGENTS.md in the model-visible prompt.

### Contradictions resolved
- AGENTS.md test-database instruction vs. the integration-test setup (see above).
- Ownership overlaps (gateway: auth = decision, deployment = route wiring; incident response: security = procedure,
  deployment = suspend/quarantine flags) made explicit in each skill's *When to use*.
- Deployment skill's "filtered API" isolation vs. residual risk R-01 and the observed privileged buildx container.
