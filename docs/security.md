# Security overview

Primary invariant: an authenticated employee, a malicious upload or a compromised website must never automatically
gain access to another department, modify privileged infrastructure or expose private corporate content.

Layers (each independently enforced): edge proxy → local email/password sign-in (Argon2id,
throttled; single-factor — **MFA not implemented**) and server sessions → admin-managed enrollment → server-side RBAC by department → upload
validation → isolated worker and hardened site containers → private website gateway → audit, alerts and incident
controls. Production readiness is decided by the release gates, which are **not yet satisfied**.

The detailed, authoritative security documentation lives in [`docs/security/`](security/):

| Document | Topic |
|---|---|
| [threat-model.md](security/threat-model.md) | STRIDE threat model, actors, attack paths |
| [trust-boundaries.md](security/trust-boundaries.md) | Boundaries and data flows |
| [authentication.md](security/authentication.md) | Local accounts, sign-in, re-authentication, MFA status |
| [password-security.md](security/password-security.md) | Argon2id, password policy, one-time links, throttling |
| [session-security.md](security/session-security.md) | Sessions, cookies, CSRF, revocation |
| [authorization.md](security/authorization.md) | RBAC, enrollment and department isolation |
| [domain-isolation.md](security/domain-isolation.md) | Origins, cookies, CSP |
| [private-website-gateway.md](security/private-website-gateway.md) | Forward-auth gateway for sites and previews |
| [upload-security.md](security/upload-security.md) | Upload/ZIP validation |
| [docker-isolation.md](security/docker-isolation.md) | Worker and container hardening |
| [network-policies.md](security/network-policies.md) | Network segmentation and egress |
| [deployment-integrity.md](security/deployment-integrity.md) | Immutable artifacts, preview-to-production integrity |
| [audit-logging.md](security/audit-logging.md) | Audit events, alerts |
| [incident-response.md](security/incident-response.md) | Containment and recovery procedures |
| [security-testing.md](security/security-testing.md) | Test inventory and evidence |
| [release-gates.md](security/release-gates.md) | Production release gates |
| [residual-risks.md](security/residual-risks.md) | Risk register |

General references: [authentication.md](authentication.md), [enrollment.md](enrollment.md), [authorization.md](authorization.md),
[ADR 0002](adr/0002-local-accounts.md),
[deployment-lifecycle.md](deployment-lifecycle.md), [ADR 0001](adr/0001-static-sites-in-hardened-containers.md).
