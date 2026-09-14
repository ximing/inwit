#!/usr/bin/env bash
# T9 smoke: POST /api/chat → poll digested → answer + cards → today queue.
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

PORT="${SMOKE_PORT:-3022}"
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

echo "== T9 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t9-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t9-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

echo "starting worker..."
(cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t9-worker.log 2>&1 &
STARTED_WORKER_PID=$!
sleep 0.8
if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
  echo "worker exited immediately:"
  tail -80 /tmp/inwit-t9-worker.log || true
  exit 1
fi

UNAUTH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$BASE_URL/api/chat" \
  -H 'content-type: application/json' \
  -d '{"question":"test"}')
check "unauthenticated chat is 401" "$([[ "$UNAUTH_CODE" == "401" ]] && echo 1 || echo 0)"

STAMP="$(date +%s)"
EMAIL="t9-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t9-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$REG"
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

QUESTION='L1 和 L2 正则化到底啥区别'
BODY=$(QUESTION="$QUESTION" node -e 'console.log(JSON.stringify({question: process.env.QUESTION}))')

echo "-- POST /api/chat"
CHAT=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/chat" \
  -H 'content-type: application/json' \
  -d "$BODY")
echo "$CHAT"
CAP_ID=$(printf '%s' "$CHAT" | json_field id || true)
CAP_TYPE=$(printf '%s' "$CHAT" | json_field type || true)
CAP_STATUS=$(printf '%s' "$CHAT" | json_field status || true)
check "chat returns capture id" "$([[ -n "$CAP_ID" ]] && echo 1 || echo 0)"
check "capture type is chat" "$([[ "$CAP_TYPE" == "chat" ]] && echo 1 || echo 0)"
check "capture status pending" "$([[ "$CAP_STATUS" == "pending" ]] && echo 1 || echo 0)"

echo "-- poll GET /api/captures/:id until digested"
DETAIL=""
DETAIL_STATUS=""
for _ in $(seq 1 90); do
  DETAIL=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/captures/${CAP_ID}")
  DETAIL_STATUS=$(printf '%s' "$DETAIL" | json_field status || true)
  if [[ "$DETAIL_STATUS" == "digested" || "$DETAIL_STATUS" == "failed" ]]; then
    break
  fi
  sleep 2
done
echo "$DETAIL"
check "capture status digested" "$([[ "$DETAIL_STATUS" == "digested" ]] && echo 1 || echo 0)"

EVAL=$(printf '%s' "$DETAIL" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const answer=typeof j.answer==="string"?j.answer:"";
  const cards=Array.isArray(j.cards)?j.cards:[];
  const ids=cards.map((c)=>c.id).filter(Boolean);
  const lower=answer.toLowerCase();
  const mentions=/l1|l2|正则|范数|lasso|ridge/i.test(answer);
  process.stdout.write(JSON.stringify({
    answerLen: answer.length,
    mentions: mentions?1:0,
    cardCount: cards.length,
    ids,
  }));
')
echo "eval=$EVAL"
ANSWER_LEN=$(printf '%s' "$EVAL" | json_field answerLen || true)
MENTIONS=$(printf '%s' "$EVAL" | json_field mentions || true)
CARD_COUNT=$(printf '%s' "$EVAL" | json_field cardCount || true)
check "answer nonempty (>=80 chars)" "$([[ "${ANSWER_LEN:-0}" -ge 80 ]] && echo 1 || echo 0)"
check "answer mentions L1/L2/正则" "$([[ "$MENTIONS" == "1" ]] && echo 1 || echo 0)"
check "cards >= 1" "$([[ "${CARD_COUNT:-0}" -ge 1 ]] && echo 1 || echo 0)"

echo "-- GET /api/review/today"
TODAY=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/review/today")
TODAY_STATS=$(CAP_ID="$CAP_ID" node -e '
  const fs=require("fs");
  const j=JSON.parse(fs.readFileSync(0,"utf8"));
  const items=Array.isArray(j.items)?j.items:[];
  const cap=process.env.CAP_ID;
  const fromChat=items.filter((it)=>it.card && it.card.captureId===cap);
  process.stdout.write(JSON.stringify({
    total: items.length,
    fromChat: fromChat.length,
  }));
' <<<"$TODAY")
echo "today stats=$TODAY_STATS"
FROM_CHAT=$(printf '%s' "$TODAY_STATS" | json_field fromChat || true)
check "today queue includes chat cards" "$([[ "${FROM_CHAT:-0}" -ge 1 ]] && echo 1 || echo 0)"

echo
echo "passed=$PASS failed=$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  echo "-- worker log (tail)"
  tail -80 /tmp/inwit-t9-worker.log || true
  echo "-- server log (tail)"
  tail -40 /tmp/inwit-t9-server.log || true
  exit 1
fi
