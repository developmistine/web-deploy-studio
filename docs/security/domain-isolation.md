# Domain and browser isolation

## Origins
| Trust domain | Config | Example placeholder (not provisioned) | Content |
|---|---|---|---|
| Management | `APP_URL` | `deploy.company.com` | Deploy Studio UI/API only — never uploaded content |
| Production sites | `SITES_BASE_URL` | `<dept>-<site>.sites.company-host.net` | one origin per department website |
| Previews | `PREVIEW_BASE_URL` | `<random 26-char label>.preview.company-preview.net` | one origin per revision |

## Controls
| Control | Where | Status |
|---|---|---|
| Hosted hosts must not equal or contain the management host | `loadConfig()` in `src/server/config.ts` | Tested (`tests/unit/config-and-state.test.ts`) |
| Separate registrable domain required when `NODE_ENV=production` or `REQUIRE_SEPARATE_SITE_DOMAINS=true` | `registrableDomain()` | Tested — **heuristic** (last two labels, or three for `xx.yy` ccSLDs such as `co.th`); no Public Suffix List → Requires security review of real domains (R-05) |
| Management cookies host-only (`__Host-ds_session` on HTTPS), never wildcard | `session.ts` | Implemented |
| Gateway cookies host-only per hosted origin (`__Host-ds_gw` on secure origins) | `src/server/gateway/gate.ts` | Tested |
| No CORS on management APIs; `Cross-Origin-Resource-Policy: same-origin`; `Referrer-Policy: no-referrer` | `src/server/http/handler.ts` | Tested |
| Management pages: nonce CSP with `strict-dynamic`, `frame-src` preview origins only, `frame-ancestors 'none'`, COOP/CORP same-origin, HSTS on HTTPS | `src/proxy.ts` | Implemented |
| Preview iframe `sandbox="allow-scripts allow-same-origin allow-forms"` — no `allow-popups` / `allow-top-navigation` (popups bypass CSP, R-24); `allow-same-origin` is acceptable only because the origin differs from management | `src/components/PreviewPanel.tsx` | Tested (`tests/ui/ui.test.tsx`; browser-verified) |
| Hosted sites: `SITE_CSP` (`connect-src 'self'`, `object-src 'none'`, `worker-src 'none'`), `frame-ancestors` = management origin, Permissions-Policy, COOP/CORP same-origin, `private, no-store` | `infra/site-template/default.conf.template`, `worker/src/config.ts` | Tested (template assertions in `tests/unit/routing.test.ts`) |
| Service workers blocked (403 when `Service-Worker` header present; `worker-src 'none'`) | nginx template | Implemented |
| Sign-in, password and enrollment endpoints (`/login`, `/password`, `/api/v1/auth/*`, `/api/v1/admin/*`) only on the management origin; hosted origins never receive the management cookie or passwords | routing, host check | Implemented |

## Limits
- `SITE_CSP` allows `'unsafe-inline'` scripts (common in static dashboards). Uploaded JS can still phish, deface
  or attack other users of the *same* department site (R-02, R-03). `connect-src 'self'` / `img-src 'self'` block fetch, XHR,
  beacon and image exfiltration (verified), but not popups, top-level navigation or WebRTC on deployed sites (R-24);
  the static check warns about `window.open`, WebRTC and runtime-built redirects.
- Hosted JavaScript runs in employee browsers and could probe internal network addresses; protection depends on
  browser Private Network Access support.
- Embedded previews need `SameSite=None; Partitioned` cookies (CHIPS) — browser-dependent (R-04).

## Recommendation
Three **separate registrable domains** (management, sites, previews); consider a dedicated domain for high-risk
departments. DNS/TLS provisioning — **Blocked by external infrastructure**.
