#!/usr/bin/env bash
# End-to-end check of the LOCAL docker compose stack (run from the repo root after `docker compose up`).
# Enrolls test accounts as the MySQL root user and signs in through the real login endpoint — local only.
# Usage: DS_HTTP_PORT=8090 bash scripts/e2e-compose.sh
set -u
PORT=${DS_HTTP_PORT:-8080}
P=http://127.0.0.1:$PORT
STUDIO=studio.localhost:$PORT
ORIGIN=http://studio.localhost:$PORT
SITE=${E2E_SITE_FILE:-demo-dashboard.html}
J() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const o=JSON.parse(s);console.log($1)}catch(e){console.log('PARSE_ERR',s.slice(0,200))}})"; }
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; FAILED=1; }
FAILED=0

DC="docker compose -f ./docker-compose.yml --env-file ./.env.compose"
E2E_PW='e2e violet harbor lantern 2026'
login() { # $1 email-local-part $2 role $3 dept code ('' = none) $4 var suffix
  # Enrolls an ACTIVE account (real Argon2id hash, production cost) as MySQL root — the enrollment UI/API is covered by
  # the integration tests — then signs in through the REAL login endpoint of the production image.
  local email="$1@deploystudio.test" hash dept res
  hash=$(node -e "require('@node-rs/argon2').hash(process.argv[1],{algorithm:2,memoryCost:19456,timeCost:2,parallelism:1}).then(h=>console.log(h))" "$E2E_PW")
  if [ -n "$3" ]; then dept="(SELECT id FROM departments WHERE code='$3')"; else dept="NULL"; fi
  $DC exec -T mysql sh -c "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" deploy_studio" <<SQL 2>/dev/null
INSERT INTO users (id, email, email_normalized, active_email, display_name, password_hash, status, role, department_id, updated_at)
  VALUES (UUID(), '$email', '$email', '$email', '$1', '$hash', 'ACTIVE', '$2', $dept, NOW(3))
  ON DUPLICATE KEY UPDATE password_hash='$hash', status='ACTIVE', role='$2';
SQL
  res=$(curl -s -D - "$P/api/v1/auth/login" -H "Host: $STUDIO" -H "Origin: $ORIGIN" -H 'content-type: application/json' -d "{\"email\":\"$email\",\"password\":\"$E2E_PW\"}")
  eval "COOKIE_$4='$(echo "$res" | grep -i '^set-cookie' | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]+);.*/\1/' | tr -d '\r')'"
  eval "CSRF_$4='$(echo "$res" | tail -1 | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).csrfToken)}catch{console.log('')}})")'"
}
# Evidence: no development login route exists in the production image.
code=$(curl -s -o /dev/null -w '%{http_code}' "$P/api/test-auth/login" -H "Host: $STUDIO" -H "Origin: $ORIGIN" -H 'content-type: application/json' -d '{"identity":"admin"}')
[ "$code" = 404 ] && pass "no development login route (404)" || fail "test-auth returned $code"
# Evidence: wrong password → generic 401, no cookie.
H=$(curl -s -D - -o /dev/null "$P/api/v1/auth/login" -H "Host: $STUDIO" -H "Origin: $ORIGIN" -H 'content-type: application/json' -d '{"email":"nobody@deploystudio.test","password":"wrong password guess"}')
echo "$H" | grep -q '^HTTP/1.1 401' && ! echo "$H" | grep -qi '^set-cookie' && pass "login: unknown account → generic 401, no cookie" || fail "bad login: $H"
api() { # method path cookie csrf [curl args...]
  local m=$1 p=$2 c=$3 t=$4; shift 4
  curl -s "$P$p" -X "$m" -H "Host: $STUDIO" -H "Origin: $ORIGIN" -H "Cookie: $c" -H "x-csrf-token: $t" "$@"
}

login e2e-dtd USER dtd DTD; login e2e-erp USER erp ERP
[ -n "$COOKIE_DTD" ] && pass "real email/password login (Argon2id, production image) issues a session" || fail "login did not set a cookie"
code=$(api GET /api/v1/me "$COOKIE_DTD" x -o /dev/null -w "%{http_code}"); [ "$code" = 200 ] && pass "server session accepted by production build" || fail "session $code"

R=$(api POST /api/v1/websites "$COOKIE_DTD" "$CSRF_DTD" -H 'content-type: application/json' -d '{"department":"DTD","siteName":"sales-dashboard"}')
WID=$(echo "$R" | J 'o.website ? o.website.id : o.error.details.websiteId')
HOST=$(api GET "/api/v1/websites/$WID" "$COOKIE_DTD" x | J 'o.website.hostname')
echo "website $WID host $HOST"

R=$(api POST "/api/v1/websites/$WID/deployments" "$COOKIE_DTD" "$CSRF_DTD" -H "idempotency-key: e2e-$(date +%s)-key" -F "files=@$SITE;filename=index.html")
DID=$(echo "$R" | J 'o.deployment.id'); echo "deployment $DID status $(echo "$R" | J 'o.deployment.status')"

for i in $(seq 1 90); do S=$(api GET "/api/v1/deployments/$DID" "$COOKIE_DTD" x | J 'o.deployment.status'); [ "$S" = PREVIEW_READY ] || [ "$S" = FAILED ] && break; sleep 2; done
[ "$S" = PREVIEW_READY ] && pass "real Docker build of controlled template + isolated preview container (status $S)" || { fail "build status $S"; api GET "/api/v1/deployments/$DID/logs" "$COOKIE_DTD" x; }

# Preview through the gateway
L=$(api POST "/api/v1/deployments/$DID/preview" "$COOKIE_DTD" "$CSRF_DTD" -H 'content-type: application/json' -d '{}' | J 'o.preview.launchUrl')
PHOST=$(node -e "console.log(new URL('$L').host)"); PPATH=$(node -e "const u=new URL('$L');console.log(u.pathname+u.search)")
code=$(curl -s -o /dev/null -w '%{http_code}' "$P/" -H "Host: $PHOST"); [ "$code" = 302 ] && pass "anonymous preview request → 302 (no content)" || fail "anon preview $code"
H=$(curl -s -D - -o /dev/null "$P$PPATH" -H "Host: $PHOST"); PCK=$(echo "$H" | grep -i '^set-cookie' | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]+);.*/\1/' | tr -d '\r')
echo "$H" | grep -qi 'Partitioned' && pass "preview handshake sets host-only Partitioned cookie" || fail "preview cookie: $H"
B=$(curl -s "$P/" -H "Host: $PHOST" -H "Cookie: $PCK"); echo "$B" | grep -q 'Pulse' && pass "preview serves the uploaded site via gateway" || fail "preview body: ${B:0:200}"
HD=$(curl -s -D - -o /dev/null "$P/" -H "Host: $PHOST" -H "Cookie: $PCK")
echo "$HD" | grep -qi 'cache-control: private, no-store' && pass "hosted content: Cache-Control private, no-store" || fail "cache headers"
echo "$HD" | grep -qi "content-security-policy:.*connect-src 'self'" && pass "hosted content: restrictive site CSP" || fail "csp"
code=$(curl -s -o /dev/null -w '%{http_code}' "$P/" -X POST -H "Host: $PHOST" -H "Cookie: $PCK"); [ "$code" = 403 ] && pass "hosted content is read-only (POST → 403)" || fail "POST → $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$P/sw.js" -H "Host: $PHOST" -H "Cookie: $PCK" -H 'Service-Worker: script'); [ "$code" = 403 ] && pass "service worker registration blocked" || fail "sw $code"

# Promote
R=$(api POST "/api/v1/deployments/$DID/promote" "$COOKIE_DTD" "$CSRF_DTD" -H 'content-type: application/json' -d '{}'); echo "promote: $(echo "$R" | J 'o.deployment ? o.deployment.status : JSON.stringify(o)')"
for i in $(seq 1 60); do S=$(api GET "/api/v1/deployments/$DID" "$COOKIE_DTD" x | J 'o.deployment.status+":"+o.deployment.isActive'); [ "$S" = "LIVE:true" ] || [[ "$S" == FAILED* ]] && break; sleep 2; done
[ "$S" = "LIVE:true" ] && pass "promotion: health check + atomic route switch + proxy verification → LIVE" || { fail "promote $S"; api GET "/api/v1/deployments/$DID/logs" "$COOKIE_DTD" x; }

# Private production site via gateway
H=$(curl -s -D - -o /dev/null "$P/style.css" -H "Host: $HOST:$PORT"); echo "$H" | grep -q '^HTTP/1.1 302' && echo "$H" | grep -qi "location: http://studio.localhost:$PORT/api/gateway/authorize" && pass "anonymous asset request on production site → redirect to the authorize/sign-in flow" || fail "anon site: $H"
A=$(curl -s -D - -o /dev/null "$P/api/gateway/authorize?host=$HOST&r=/" -H "Host: $STUDIO" -H "Cookie: $COOKIE_DTD")
HS=$(echo "$A" | grep -i '^location' | sed -E 's/^[Ll]ocation: //' | tr -d '\r'); HSP=$(node -e "const u=new URL('$HS');console.log(u.pathname+u.search)")
H=$(curl -s -D - -o /dev/null "$P$HSP" -H "Host: $HOST:$PORT"); SCK=$(echo "$H" | grep -i '^set-cookie' | sed -E 's/^[Ss]et-[Cc]ookie: ([^;]+);.*/\1/' | tr -d '\r')
B=$(curl -s "$P/" -H "Host: $HOST:$PORT" -H "Cookie: $SCK"); echo "$B" | grep -q 'Pulse' && pass "DTD member views the private DTD production site" || fail "site body ${B:0:200}"
code=$(curl -s -o /dev/null -w '%{http_code}' "$P/api/gateway/authorize?host=$HOST&r=/" -H "Host: $STUDIO" -H "Cookie: $COOKIE_ERP"); [ "$code" = 403 ] && pass "ERP user denied DTD production site" || fail "erp authorize $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$P/" -H "Host: $HOST:$PORT" -H "Cookie: $COOKIE_DTD"); [ "$code" = 302 ] && pass "management session cookie not accepted on site origin" || fail "mgmt cookie on site $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$P/" -H "Host: nothing-here.sites.localhost:$PORT"); [ "$code" = 404 ] && pass "unknown hostname → 404" || fail "unknown host $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$P/api/internal/gate" -H "Host: $STUDIO" -H "x-forwarded-host: $HOST" -H "Cookie: $SCK"); [ "$code" = 404 ] && pass "internal gate endpoint not reachable through the edge" || fail "internal gate reachable: $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$P/api/v1/me" -H "Host: evil.example"); [ "$code" = 404 ] && pass "unknown Host on edge → 404" || echo "INFO  unknown Host on edge → $code"

# Container / infrastructure isolation
C=ds-site-$DID
docker inspect $C --format '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.Config.User}} {{.HostConfig.Privileged}} {{.HostConfig.Memory}} {{.HostConfig.PidsLimit}} {{.HostConfig.SecurityOpt}}' | tee /tmp/ds_inspect
grep -q '^true \[ALL\] 101:101 false 134217728 64 \[no-new-privileges:true\]' /tmp/ds_inspect && pass "site container: read-only, cap-drop ALL, non-root, unprivileged, mem/pids limits, no-new-privileges" || fail "container hardening"
docker exec $C wget -T 4 -qO- http://example.com >/dev/null 2>&1 && fail "site container has Internet egress" || pass "site container has no egress (internal network)"
docker exec $C wget -T 4 -qO- http://web:3000/api/health >/dev/null 2>&1 && fail "site container reaches management app" || pass "site container cannot reach management app"
docker exec $C wget -T 4 -qO- http://mysql:3306 >/dev/null 2>&1 && fail "site container reaches MySQL" || pass "site container cannot reach MySQL"
docker compose -f ./docker-compose.yml --env-file ./.env.compose exec -T web sh -c 'test -S /var/run/docker.sock' && fail "docker socket in web" || pass "no Docker socket inside web container"
docker compose -f ./docker-compose.yml --env-file ./.env.compose exec -T web sh -c 'id -u' | grep -q '^1000$' && pass "web runs as non-root (uid 1000)" || fail "web uid"
docker compose -f ./docker-compose.yml --env-file ./.env.compose exec -T mysql sh -c 'mysql -uds_app -p"$DS_APP_PASSWORD" deploy_studio -e "DROP TABLE audit_logs" 2>&1' | grep -q 'denied' && pass "runtime DB account cannot run DDL" || fail "ds_app DDL"
echo; [ $FAILED = 0 ] && echo "E2E RESULT: ALL PASSED" || echo "E2E RESULT: FAILURES"
