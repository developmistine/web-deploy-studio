# Session security

Code: `src/server/auth/session.ts`, `src/server/http/handler.ts`, `src/server/gateway/`.

| Control | Detail | Status |
|---|---|---|
| Opaque server sessions | 256-bit random token in the cookie; only its SHA-256 is stored (`sessions.id`) | Implemented, Tested |
| Cookie flags | `__Host-ds_session` on HTTPS (Secure, Path=/, host-only), `ds_session` on local http; HttpOnly; SameSite=Lax | Implemented, Tested |
| Expiry | absolute `SESSION_TTL_HOURS` (8) + idle `SESSION_IDLE_MINUTES` (60) | Implemented, Tested |
| Rotation | a new token on every login and password change; the old ones are deleted | Implemented, Tested |
| Stages | `PASSWORD_CHANGE` sessions reach only `/api/v1/me`, change-password and logout; pages redirect to `/account/password`; the gateway refuses them | Implemented, Tested |
| Account status | anything but `ACTIVE` deletes every session of the user on the next request | Implemented, Tested |
| Revocation on privilege change | role, department or status change, password change/reset, removal → all sessions of the user deleted | Implemented, Tested |
| Re-authentication | `authenticated_at` (last password check) gates enrollment writes and cross-department production changes | Implemented, Tested |
| CSRF | mutating requests need `x-csrf-token` (constant-time compare to the session's token) **and** `Origin = APP_URL`; unauthenticated POSTs (login, reset, forgot) need our Origin | Implemented, Tested |
| Host validation | `Host` must be `APP_URL`'s host or `APP_ALLOWED_HOSTS` → else 421 | Implemented, Tested |
| No CORS | management APIs never send CORS headers; `Cross-Origin-Resource-Policy: same-origin` | Implemented, Tested |
| Separation from hosted content | sites/previews get their own host-only `__Host-ds_gw` cookie via a signed, host-bound handshake; the management cookie is never accepted there | Implemented, Tested |
| Gateway cache | decisions cached ≤ 10 s per instance → revocation latency ≤ 10 s on hosted origins (R-06) | Implemented (accepted risk) |
| Logout | deletes the server session and clears the cookie | Implemented, Tested |

Session state is in MySQL, so revocation is immediate across web replicas (except the gateway cache above).
