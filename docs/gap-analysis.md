# Gap analysis — master implementation prompt (2026-11-11)

Assessment of the existing repository against the consolidated master prompt, with the owner's decisions of the same
day. Status after this iteration in the last column.

| Area | Before | Required by the prompt | Owner decision | Now |
|---|---|---|---|---|
| Authentication | Corporate OIDC SSO (never configured) + dev test accounts with a shared password | Local email/password, Argon2id, MFA, reset, change, rate limits, no backdoors | **MFA deferred**; no email delivery (links handed over internally) | Local accounts implemented and tested; OIDC and dev accounts removed; MFA **not implemented** (release blocker) |
| Department membership | IdP claims or CLI | Admin-managed enrollment | — | Enrollment is the only source |
| Enrollment UI/API | none (CLI only) | Enroll IDs page + `/api/v1/admin/users*` | — | Implemented, tested (create, edit, reset link, soft remove, search, filters, pagination, last-admin guard) |
| Admin layout | tabs only, "no sidebar" rule | Collapsible sidebar (Deploy Website, Enroll IDs), mobile drawer | — | Implemented, tested |
| Upload → preview flow | auto-upload on drop, inline preview, Change file | Preview button | **Keep current flow** | Unchanged |
| Admin website list | no department filter, each department opens its own page | filter by department | **Keep current** | Unchanged (enrollment list has department filters) |
| One website / department, revisions, rollback, worker, gateway, upload checks, content scan | implemented and tested | same | — | Unchanged; gateway now requires a fully signed-in session |
| Static hosting model | per-revision hardened nginx containers (ADR 0001, Proposed) | prefer gateway-served immutable artifacts | pending | Still pending approval |
| Docs & skills | SSO-based | local accounts | — | Updated (AGENTS.md, skills, auth/enrollment/password/session docs, ADR 0002) |
| Release gates | not satisfied | 20 gates | — | Not satisfied (see `docs/security/release-gates.md`) |
