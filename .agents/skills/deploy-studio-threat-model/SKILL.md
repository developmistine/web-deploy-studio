---
name: deploy-studio-threat-model
description: Use when assessing or changing Deploy Studio's attack surface - new endpoints, origins, trust boundaries, hosting or proxy behaviour, infrastructure components, security design reviews, release-gate reviews, incident retrospectives, architecture decisions (ADRs), or requests for STRIDE analysis, abuse cases, risk tracking, mitigation mapping or residual-risk reporting.
---

# Deploy Studio — threat modeling workflow

## When to use
- Before implementing: a new endpoint, origin/hostname, cookie, trust boundary, job type, container capability or
  infrastructure component; a change to the gateway or hosting model (including ADR 0001).
- Reviews: security design review, release-gate review (`docs/security/release-gates.md`), incident retrospective.
- Not for implementing controls — hand off to `deploy-studio-auth`, `deploy-studio-security` or
  `deploy-studio-deployment`.

## Responsibilities
Keeps the analysis artifacts true and current: `docs/security/threat-model.md` (STRIDE per scenario),
`docs/security/trust-boundaries.md` (TB1–TB9, Mermaid), `docs/security/residual-risks.md` (R-xx register),
`docs/security/security-testing.md` (evidence map), `docs/security/release-gates.md`. Do not copy them into skills.

## Workflow
1. **Scope** — list the components, data and entry points the change touches.
2. **Trust boundaries** — locate them on the TB diagram (browser↔management, browser↔hosted origins,
   proxy↔gate, web/worker↔DB, web/worker↔storage, worker↔Docker API, site containers↔network, browser↔login/password endpoints,
   operator↔admin CLI). Add a boundary if the change creates one.
3. **STRIDE** per boundary: Spoofing, Tampering, Repudiation, Information disclosure, Denial of service,
   Elevation of privilege. Consider the threat actors A1–A10 in the threat model (anonymous, bots, stolen session,
   malicious employee, compromised department account, compromised admin, hostile uploaded HTML/JS, hostile
   ZIP, supply chain, foothold in worker/hosting).
4. **Abuse cases** — concrete attacker stories ("USER of DTD posts department=ERP", "uploaded JS fetches the
   management API", "stale worker commits a pointer", "worker asks the Docker API for a privileged container").
5. **Mitigation mapping** — for each: existing control (file:line), missing control, status label
   (Implemented / Tested / Planned / Blocked by external infrastructure / Requires security review).
6. **Severity** — qualitative (Critical/High/Medium/Low) with a one-line rationale (likelihood × impact).
   Never invent CVSS scores; never claim a vulnerability is confirmed or fixed without test evidence.
7. **Verification** — name the automated test or manual procedure; add negative tests for new abuse cases.
8. **Residual risk** — add/update an `R-xx` row in `docs/security/residual-risks.md` (owner, status, acceptance
   required). Accepting a risk is the owner's decision, never the agent's.
9. **Gates** — if a release gate is affected, update `docs/security/release-gates.md`. Never mark a gate satisfied
   without recorded evidence in `docs/verification.md`.

## Output format for reviews
Table: Scenario | Actor | STRIDE | Controls (status) | Gaps | Severity + rationale | Verification | Risk id.

## Verification
- [ ] Every new scenario has a status label and a named verification (test file or manual procedure).
- [ ] New or changed risks appear in `docs/security/residual-risks.md`; gates in `docs/security/release-gates.md`.
- [ ] Trust-boundary table and diagram in `docs/security/trust-boundaries.md` match the change.
