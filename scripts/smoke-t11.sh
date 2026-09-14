#!/usr/bin/env bash
# T11 smoke: register → POST /api/documents → digest → GET /api/cards/:id/links
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$ROOT/apps/server"
COOKIE_JAR="$(mktemp)"
STARTED_SERVER_PID=""
STARTED_WORKER_PID=""
PASS=0
FAIL=0

kill_tree() {
  local pid="$1"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

cleanup() {
  rm -f "$COOKIE_JAR"
  if [[ -n "${STARTED_WORKER_PID}" ]]; then
    kill_tree "$STARTED_WORKER_PID"
    wait "$STARTED_WORKER_PID" 2>/dev/null || true
  fi
  if [[ -n "${STARTED_SERVER_PID}" ]]; then
    if command -v lsof >/dev/null 2>&1; then
      for pid in $(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
        kill_tree "$pid"
      done
    fi
    kill_tree "$STARTED_SERVER_PID"
    wait "$STARTED_SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -f "$SERVER_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$SERVER_DIR/.env"
  set +a
fi

PORT="${SMOKE_PORT:-3023}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"

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

echo "== T11 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t11-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t11-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

echo "starting worker..."
(cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t11-worker.log 2>&1 &
STARTED_WORKER_PID=$!
sleep 0.8
if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
  echo "worker exited immediately:"
  tail -80 /tmp/inwit-t11-worker.log || true
  exit 1
fi

UNAUTH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/documents" \
  -H 'content-type: application/json' \
  -d '{"contentMd":"test"}')
check "unauthenticated documents is 401" "$([[ "$UNAUTH_CODE" == "401" ]] && echo 1 || echo 0)"

STAMP="$(date +%s)"
EMAIL="t11-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t11-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$REG"
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

CONTENT='梯度消失：深层网络反向传播时，靠前的层梯度会指数衰减，参数几乎不更新。常见缓解：ReLU、残差连接、BatchNorm、合理初始化。'
BODY=$(CONTENT="$CONTENT" node -e 'console.log(JSON.stringify({contentMd: process.env.CONTENT}))')

echo "-- POST /api/documents"
CREATED=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
  -H 'content-type: application/json' \
  -d "$BODY")
echo "$CREATED"
DOC_ID=$(printf '%s' "$CREATED" | json_field id || true)
DOC_SOURCE=$(printf '%s' "$CREATED" | json_field source || true)
DOC_STATUS=$(printf '%s' "$CREATED" | json_field status || true)
DOC_TITLE=$(printf '%s' "$CREATED" | json_field title || true)
check "document id" "$([[ -n "$DOC_ID" ]] && echo 1 || echo 0)"
check "document source is paste" "$([[ "$DOC_SOURCE" == "paste" ]] && echo 1 || echo 0)"
check "document status pending" "$([[ "$DOC_STATUS" == "pending" ]] && echo 1 || echo 0)"
TITLE_OK=$(DOC_TITLE="$DOC_TITLE" node -e 'const t=process.env.DOC_TITLE||""; process.stdout.write(t.startsWith("梯度消失")&&[...t].length<=40?"1":"0")')
check "document title from first 40 chars" "$([[ "$TITLE_OK" == "1" ]] && echo 1 || echo 0)"

echo "-- poll GET /api/documents/:id until digested"
DETAIL=""
DETAIL_STATUS=""
for _ in $(seq 1 90); do
  DETAIL=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/documents/${DOC_ID}")
  DETAIL_STATUS=$(printf '%s' "$DETAIL" | json_field status || true)
  if [[ "$DETAIL_STATUS" == "digested" || "$DETAIL_STATUS" == "failed" ]]; then
    break
  fi
  sleep 2
done
echo "$DETAIL"
check "document status digested" "$([[ "$DETAIL_STATUS" == "digested" ]] && echo 1 || echo 0)"

EVAL=$(printf '%s' "$DETAIL" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const cards=Array.isArray(j.cards)?j.cards:[];
  const ids=cards.map((c)=>c.id).filter(Boolean);
  const hasDocId=cards.every((c)=>c.documentId===j.id);
  const hasAnchor="anchorText" in (cards[0]||{}) && "anchorBlock" in (cards[0]||{});
  process.stdout.write(JSON.stringify({
    cardCount: cards.length,
    ids,
    hasDocId: hasDocId?1:0,
    hasAnchor: hasAnchor?1:0,
  }));
')
echo "eval=$EVAL"
CARD_COUNT=$(printf '%s' "$EVAL" | json_field cardCount || true)
CARD_ID=$(printf '%s' "$EVAL" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write((j.ids&&j.ids[0])||"");')
HAS_DOC=$(printf '%s' "$EVAL" | json_field hasDocId || true)
HAS_ANCHOR=$(printf '%s' "$EVAL" | json_field hasAnchor || true)
check "cards >= 1" "$([[ "${CARD_COUNT:-0}" -ge 1 ]] && echo 1 || echo 0)"
check "cards.documentId matches document" "$([[ "$HAS_DOC" == "1" ]] && echo 1 || echo 0)"
check "cards include anchor fields" "$([[ "$HAS_ANCHOR" == "1" ]] && echo 1 || echo 0)"

echo "-- GET /api/cards/:id/links"
LINKS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/cards/${CARD_ID}/links")
echo "$LINKS"
LINKS_OK=$(printf '%s' "$LINKS" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const ok=Array.isArray(j.outgoing) && Array.isArray(j.incoming);
  process.stdout.write(ok?"1":"0");
')
check "links payload has outgoing+incoming arrays" "$([[ "$LINKS_OK" == "1" ]] && echo 1 || echo 0)"

echo
echo "passed=$PASS failed=$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  echo "-- worker log (tail)"
  tail -80 /tmp/inwit-t11-worker.log || true
  echo "-- server log (tail)"
  tail -40 /tmp/inwit-t11-server.log || true
  exit 1
fi
