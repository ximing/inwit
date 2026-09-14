#!/usr/bin/env bash
# T3 smoke: auth + BYOK llm-configs against a local @inwit/server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$ROOT/apps/server"
BASE_URL="${BASE_URL:-http://127.0.0.1:3020}"
COOKIE_JAR="$(mktemp)"
STARTED_PID=""
PASS=0
FAIL=0

cleanup() {
  rm -f "$COOKIE_JAR"
  if [[ -n "${STARTED_PID}" ]]; then
    if command -v lsof >/dev/null 2>&1; then
      for pid in $(lsof -t -nP -iTCP:3020 -sTCP:LISTEN 2>/dev/null || true); do
        kill "$pid" 2>/dev/null || true
      done
    fi
    kill "$STARTED_PID" 2>/dev/null || true
    wait "$STARTED_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -f "$SERVER_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SERVER_DIR/.env"
  set +a
fi

json_field() {
  node -e 'const fs=require("fs"); const s=fs.readFileSync(0,"utf8"); const k=process.argv[1]; const v=JSON.parse(s); const parts=k.split("."); let cur=v; for (const p of parts) cur=cur?.[p]; if (cur===undefined||cur===null) process.exit(1); process.stdout.write(typeof cur==="string"?cur:JSON.stringify(cur));' "$1"
}

check() {
  local name="$1"
  local cond="$2"
  if [[ "$cond" == "1" ]]; then
    echo "PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "== T3 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server..."
  (cd "$SERVER_DIR" && pnpm exec tsx src/index.ts) >/tmp/inwit-t3-server.log 2>&1 &
  STARTED_PID=$!
  for _ in $(seq 1 40); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -50 /tmp/inwit-t3-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

STAMP="$(date +%s)"
EMAIL="t3-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t3-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$REG"
REG_EMAIL=$(printf '%s' "$REG" | json_field user.email || true)
check "register returns user.email" "$([[ "$REG_EMAIL" == "$EMAIL" ]] && echo 1 || echo 0)"

# Clear cookies so login is the source of the session used below.
rm -f "$COOKIE_JAR"
COOKIE_JAR="$(mktemp)"

echo "-- POST /api/auth/login"
LOGIN=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$LOGIN"
LOGIN_EMAIL=$(printf '%s' "$LOGIN" | json_field user.email || true)
check "login returns user.email" "$([[ "$LOGIN_EMAIL" == "$EMAIL" ]] && echo 1 || echo 0)"

echo "-- GET /api/auth/me"
ME=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/auth/me")
echo "$ME"
ME_EMAIL=$(printf '%s' "$ME" | json_field email || true)
check "me returns user" "$([[ "$ME_EMAIL" == "$EMAIL" ]] && echo 1 || echo 0)"

echo "-- GET /api/llm-configs without cookie → 401"
UNAUTH_CODE=$(curl -sS -o /tmp/inwit-t3-unauth.json -w '%{http_code}' "$BASE_URL/api/llm-configs")
echo "status=$UNAUTH_CODE body=$(cat /tmp/inwit-t3-unauth.json)"
check "unauthenticated llm-configs is 401" "$([[ "$UNAUTH_CODE" == "401" ]] && echo 1 || echo 0)"

if [[ -z "${DASHSCOPE_API_KEY:-}" ]]; then
  echo "FAIL  DASHSCOPE_API_KEY missing in env"
  FAIL=$((FAIL + 1))
else
  echo "-- POST /api/llm-configs (dashscope / qwen-plus)"
  CREATE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/llm-configs" \
    -H 'content-type: application/json' \
    -d "$(node -e 'const k=process.env.DASHSCOPE_API_KEY; process.stdout.write(JSON.stringify({provider:"dashscope",apiKey:k,model:"qwen-plus",isDefault:true}))')")
  echo "$CREATE" | node -e 'const s=require("fs").readFileSync(0,"utf8"); const j=JSON.parse(s); if (j.apiKey) { console.error("LEAKED apiKey"); process.exit(2); } j.apiKeyPreview=j.apiKeyPreview; console.log(JSON.stringify(j,null,2));'
  CONFIG_ID=$(printf '%s' "$CREATE" | json_field id || true)
  PREVIEW=$(printf '%s' "$CREATE" | json_field apiKeyPreview || true)
  PREFIX="${DASHSCOPE_API_KEY:0:6}"
  EXPECTED="${PREFIX}****"
  check "created config has masked key" "$([[ "$PREVIEW" == "$EXPECTED" ]] && echo 1 || echo 0)"
  check "preview is not the full key" "$([[ "$PREVIEW" != "$DASHSCOPE_API_KEY" && -n "$PREVIEW" ]] && echo 1 || echo 0)"

  echo "-- GET /api/llm-configs (list mask)"
  LIST=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/llm-configs")
  echo "$LIST" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); for (const c of j) { if (c.apiKey) { console.error("LEAKED apiKey"); process.exit(2); } } console.log(JSON.stringify(j,null,2));'
  LIST_PREVIEW=$(printf '%s' "$LIST" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(j[0]?.apiKeyPreview??"");')
  check "list key is masked" "$([[ "$LIST_PREVIEW" == "$EXPECTED" ]] && echo 1 || echo 0)"

  echo "-- POST /api/llm-configs/:id/test"
  TEST=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/llm-configs/${CONFIG_ID}/test")
  echo "$TEST"
  TEST_OK=$(printf '%s' "$TEST" | json_field ok || true)
  check "test returns ok:true" "$([[ "$TEST_OK" == "true" ]] && echo 1 || echo 0)"

  echo "-- psql: api_key_encrypted is not plaintext"
  SQL_OUT=$(PGPASSWORD="$PG_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -At -F $'\t' \
    -c "SELECT api_key_encrypted, (api_key_encrypted LIKE 'v1:%') AS v1, (position('$DASHSCOPE_API_KEY' in api_key_encrypted) = 0) AS not_plain FROM llm_configs WHERE id = '$CONFIG_ID';" \
    || true)
  echo "encrypted_prefix=$(printf '%s' "$SQL_OUT" | awk -F $'\t' '{print substr($1,1,20)}') v1=$(printf '%s' "$SQL_OUT" | awk -F $'\t' '{print $2}') not_plain=$(printf '%s' "$SQL_OUT" | awk -F $'\t' '{print $3}')"
  V1=$(printf '%s' "$SQL_OUT" | awk -F $'\t' '{print $2}')
  NOT_PLAIN=$(printf '%s' "$SQL_OUT" | awk -F $'\t' '{print $3}')
  check "ciphertext starts with v1:" "$([[ "$V1" == "t" ]] && echo 1 || echo 0)"
  check "ciphertext does not contain plaintext key" "$([[ "$NOT_PLAIN" == "t" ]] && echo 1 || echo 0)"
fi

echo
echo "passed=$PASS failed=$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
