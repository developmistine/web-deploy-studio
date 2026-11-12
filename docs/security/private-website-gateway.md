# Private website gateway

All hosted content (production sites **and** previews) is private. The reverse proxy (Traefik) applies the
`ds-gateway@file` `forwardAuth` middleware to **every** route the worker writes, and the gate decides each request
— HTML, CSS, JS, images, fonts, JSON, CSV and downloads alike.

Alternatives evaluated: nginx `auth_request`, OAuth2 Proxy. Chosen: Traefik forwardAuth + Deploy Studio gate,
because department authorization and session revocation already live in Deploy Studio's DB; OAuth2 Proxy would
need a second authorization integration. — Requires security review.

## Flow
```mermaid
sequenceDiagram
  participant B as Browser
  participant P as Traefik (site origin)
  participant G as /api/internal/gate
  participant M as /api/gateway/authorize (management)
  participant C as Site container
  B->>P: GET https://dtd-sales.sites…/style.css
  P->>G: forwardAuth (X-Forwarded-Host/Uri, Cookie)
  G-->>P: 302 → M?host=…&r=/style.css (no valid gateway cookie)
  P-->>B: 302
  B->>M: GET /api/gateway/authorize (management session cookie)
  alt no management session
    M-->>B: 303 /login?returnTo=… → email + password sign-in → back to authorize
  end
  M->>M: host → department; canViewHost(role, membership)
  M-->>B: 303 https://dtd-sales.sites…/__ds_auth?t=<120 s handshake>&r=/style.css
  B->>P: GET /__ds_auth?t=…
  P->>G: forwardAuth
  G->>G: verify token (host, type, exp) + session valid + still authorized
  G-->>B: 302 r + Set-Cookie __Host-ds_gw (host-only, ≤ GATEWAY_COOKIE_MINUTES, ≤ session expiry)
  B->>P: GET /style.css (cookie)
  P->>G: forwardAuth
  G-->>P: 200 (session + authz re-checked, 10 s cache)
  P->>C: proxied request
  C-->>B: content (Cache-Control: private, no-store)
```

## Behaviour (Implemented; gate logic Tested in `tests/integration/gateway.test.ts`)
1. Host validated and mapped to an approved DB record (`resolveHostTarget`); unknown host → **404**.
2. Tokens: HMAC-SHA256 with `GATEWAY_SIGNING_SECRET`, bound to host, token type, management session id (hash) and
   user; handshake lifetime 120 s; cookie lifetime ≤ `GATEWAY_COOKIE_MINUTES` and ≤ session expiry.
3. Every request re-validates the management session (expiry, idle, revocation, account status other than
   `ACTIVE`, session stage other than `FULL` — a session that must change its password is refused) and department
   authorization; results cached in-process for **10 s** → revocation latency ≤ 10 s per web instance (R-06).
4. Suspended website → **423**; quarantined active revision, expired preview or no live version → **404**.
5. The management session cookie is never accepted on hosted origins (Tested).
6. `/__ds_health` passes only with header `X-DS-Probe: HEALTH_PROBE_TOKEN` (worker readiness probes) (Tested).
7. Return paths restricted to same-origin relative paths (Tested).
8. Errors fail closed (503 page). Denials for identified users are audited (`GATEWAY_DENIED`) and counted toward
   `REPEATED_AUTHZ_DENIALS`.
9. `/api/internal/*` is excluded from the public management router (`infra/traefik/dynamic/00-infra.yml`, config-Tested in
   `tests/unit/boundaries.test.ts`); Traefik forwards only `Cookie`, `X-DS-Probe`, `X-Request-Id` to the gate.
10. Previews opened from Deploy Studio get the handshake URL from the authorized `POST /api/v1/deployments/:id/preview`.

## Pending
End-to-end proxy behaviour (Traefik returning the gate's non-2xx `Location`/`Set-Cookie`, header allowlist) is
see the local end-to-end evidence in `docs/verification.md` §3 (production infrastructure still unverified). Production DNS/TLS — Blocked by external infrastructure.
