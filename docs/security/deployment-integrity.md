# Deployment integrity

| Property | Mechanism | Status |
|---|---|---|
| One website per department | `websites.department_id UNIQUE` + `WEBSITE_EXISTS` | Tested (incl. 8 concurrent creates) |
| Immutable revisions | write-once storage keys, `version` unique per website, state machine without backward edges | Tested |
| Source integrity | SHA-256 at upload; worker re-hashes source before build | Implemented |
| Build artifact integrity | canonical bundle (`builds/<site>/<deployment>.zip`), `build_sha256` recorded; **re-verified before every release**; mismatch → `ARTIFACT_INTEGRITY_FAILED` + `SECURITY_ALERT` | Tested (`deployment-safety.test.ts` tampered artifact) |
| Image identity | content-addressed image id stored in `image_reference`; missing image rebuilt from the verified build artifact | Tested (rebuild case) |
| Preview == production | promote requires `PREVIEW_READY`, preview opened by an authorized user, image + build hash present; the same revision id is released | Tested |
| New upload invalidates nothing silently | each upload is a new revision with its own preview; older previews cannot be promoted in its place | Implemented |
| Serialized production changes | `active_lock_key` UNIQUE + website row lock → 409 `PROMOTION_IN_PROGRESS` | Tested (concurrent promotions) |
| Idempotency | `Idempotency-Key` on upload; promote/rollback idempotent by state | Tested |
| Stale workers cannot commit | per-claim lease token, fenced writes, reaper (`WORKER_LOST`) | Tested |
| Safe switch | start → readiness → atomic route rename → proxy verify → fenced pointer commit → drain old | Tested with fake runtime + verified on real Docker/Traefik locally (`docs/verification.md` §3) |
| Failure keeps production | build/health/route failures leave pointer + route; route restored on failure | Tested |
| Reconciliation | DB pointer is truth; `reconcileAll` restores routes/containers, takes suspended/quarantined sites offline | Implemented |
| Rollback | known-good (LIVE/ROLLED_BACK, not quarantined, hashed) revisions only | Tested |
| Quarantine / suspension | admin CLI flags block preview/promote/rollback/serving | Tested (API), gateway Tested |
| Image signing / provenance | — | Planned |
