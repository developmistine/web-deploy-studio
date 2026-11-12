# Password security

Applies to Deploy Studio's own accounts ([ADR 0002](../adr/0002-local-accounts.md)). Code:
`src/server/auth/password.ts`, `src/server/auth/common-passwords.ts`, `src/server/auth/password-links.ts`,
`src/server/services/auth.ts`.

| Control | Detail | Status |
|---|---|---|
| Hashing | Argon2id (`@node-rs/argon2`), random salt per hash, PHC string; defaults m=19456 KiB, t=2, p=1 (OWASP minimum); production refuses lower | Implemented, Tested |
| Parameter upgrades | hashes weaker than the current config are re-hashed after a successful login | Implemented, Tested |
| Normalisation | NFKC before hashing (same passphrase from different keyboards/IMEs verifies) | Implemented, Tested |
| Minimum length | `PASSWORD_MIN_LENGTH` default **8** (owner decision 2026-11-12, replacing the NIST single-factor value 15); config never allows < 8 | Implemented, Tested |
| Maximum length | 128 code points (request bodies capped at 512 chars before hashing) | Implemented, Tested |
| Composition | at least one letter (any script, incl. Thai) and one digit (owner decision 2026-11-12); no forced periodic rotation | Implemented, Tested |
| Blocklist | local list of very common passwords and context words, matched on the whole password and its base word with decoration stripped | Implemented, Tested |
| Repetition / sequences | `aaaa…`, `abcdef…`, `1234…`, keyboard rows | Implemented, Tested |
| Personal info | email local part and display-name words (≥ 4 chars) | Implemented, Tested |
| Breached-password corpus (e.g. k-anonymity range API or offline corpus) | not integrated (would send hash prefixes to an external service or need a large offline list) | **Planned** (R-26) |
| Enumeration resistance | identical error, status and Argon2 work for unknown / wrong / disabled / invited / removed | Implemented, Tested |
| Brute force & stuffing | per-account (8 / 15 min) and per-IP (30 / 10 min) failure limits, refusing even correct passwords while locked; alert at the account limit | Implemented, Tested |
| Passwords in transit | JSON body over HTTPS only; never in URLs; reset tokens in the URL fragment | Implemented (HTTPS: **Blocked by external infrastructure**) |
| Secrets hygiene | passwords, hashes and link tokens never logged, never in audit metadata, never in API responses (except the one-time link to the admin) | Implemented, Tested (`tests/unit/boundaries.test.ts`) |
| Change / reset invalidates sessions | every session of the user is deleted; a fresh one is issued to the changer | Implemented, Tested |
| One-time links | 256-bit token, SHA-256 stored, single use (atomic claim), expiring, superseded by newer links | Implemented, Tested |
| MFA | — | **Not implemented** (owner decision 2026-11-11) — release gate G2 |

## Tuning Argon2

Measure on the production web host: one `hashPassword()` should take roughly 200–500 ms. Raise
`ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST` if it is much faster; never go below the defaults. Login throughput is bounded
by the rate limits above, so higher cost does not create an easy DoS lever, but watch CPU during load tests (not yet
performed).
