# ADR 0002 — Local email/password accounts with admin-managed enrollment

- **Status:** Accepted by the product owner (2026-11-11, master implementation prompt). MFA explicitly deferred by the
  owner the same day.
- **Supersedes:** the corporate OIDC SSO design (no IdP configuration was available; it was never verified).

## Context

The organisation has not confirmed whether department membership (or any identity) can be obtained from a corporate
identity provider. Deploy Studio must still be usable and secure. Email delivery infrastructure is not available.

## Decision

1. Deploy Studio keeps its own accounts: corporate email (allowlisted domains) + a Deploy Studio password hashed with
   Argon2id. It never touches mailbox passwords.
2. Accounts, roles and department membership are created **only** by administrators (Enroll IDs) or, for the first
   administrator, by the infra-only CLI. A department typed elsewhere never grants membership.
3. Password setup and resets use single-use, expiring links shown once to the administrator, who hands them over
   through an internal channel. No email is sent.
4. Sessions remain opaque server sessions (unchanged); the website gateway keeps validating the same sessions.
5. The OIDC integration code is removed rather than left unconfigured. SSO can be added later as another way to
   create the same session (an `AuthProvider` step before `createSession()`), mapping IdP identities to enrolled
   accounts — never auto-provisioning roles or departments from unverified claims.

## Consequences

- **Single-factor authentication** until MFA is implemented: password minimum 8 characters with a letter and a digit (owner decision 2026-11-12; was 15), strict
  throttling, re-authentication for sensitive actions. MFA is release gate G2 and is not claimed anywhere.
- Administrators handle password handover; the link channel is outside the system (residual risk R-27).
- Existing SSO / development identities were migrated to `REVOKED` legacy rows; their history is preserved.
- Development login backdoors (test identities, shared passwords) were removed; tests create fixture accounts in the
  test database and sign in through the real endpoint.
