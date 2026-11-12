# Network policies

Docker Compose networks (local reference topology, `docker-compose.yml`):

| Network | Internal | Members | Purpose |
|---|---|---|---|
| `edge` | no | proxy | only published port |
| `app` | yes | proxy, web | management traffic + forward-auth |
| `db` | yes | mysql, migrate, web, worker | metadata |
| `egress` | no | web | none required today (local accounts, no outbound calls); reserved for a future SSO IdP (Planned, ADR 0002) |
| `docker-api` | yes | worker, docker-socket-proxy | filtered Docker API |
| `ds-sites` | yes | proxy, worker, site/preview containers | hosted content, no egress |
| `ds-scan` | yes | clamav | malware scanning (profile `security`) |

Compose networking is **not** a sufficient boundary on its own; production needs host firewall, routing and
cloud security-group rules (Blocked by external infrastructure).

## Required policy matrix (spec §16)
| Flow | Required | Current state | Status |
|---|---|---|---|
| Internet → reverse proxy | Allow HTTPS | proxy publishes 8080 (HTTP) in dev | TLS/WAF **Blocked** |
| Internet → MySQL | Deny | no public port; dev binds `127.0.0.1:3307` only | Config-Tested (`boundaries.test.ts`) |
| Internet → Docker worker | Deny | worker publishes nothing | Config-Tested |
| Internet → queue | Deny | queue is MySQL (`deployment_jobs`) — same as MySQL | Config-Tested |
| Internet → artifact storage origin | Deny | storage is a private volume, never routed | Implemented |
| Next.js → MySQL | Allow minimum | `db` network, DML-only account | Implemented |
| Next.js → Docker socket | Deny | no mount, no DOCKER_HOST, not on `docker-api` | Tested (static) |
| Gateway → authorization service | Allow restricted | proxy → web gate on `app`; `/api/internal` not publicly routed | Implemented |
| Gateway → artifact service | Allow restricted | proxy → site containers on `ds-sites` | Implemented |
| Gateway → MySQL direct | Deny | proxy not on `db` | Implemented |
| Worker → private storage | Allow scoped | shared `artifacts` volume (read-write) | Implemented (scope = whole volume; Review) |
| Worker → internal company network | Deny by default | worker on internal networks only | Config; host egress **Blocked** |
| Hosted content → management infrastructure | Deny | site containers only on `ds-sites`; web not on `ds-sites` | Config-Tested |
| Web → Internet | Deny (no outbound dependency since OIDC was removed; a future IdP only) | `egress` network still attached and unrestricted in compose | Remove/deny at firewall — **Blocked** |

Verification of actual packet filtering is not automated — see the local end-to-end evidence in `docs/verification.md` §3 (production infrastructure still unverified).
