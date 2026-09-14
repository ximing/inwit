#!/usr/bin/env bash
# T6 smoke: digest → today queue → SM-2 feedback → stats. Uses live LLM for digest.
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

# .env may set PORT=3020; pin a dedicated smoke port after sourcing.
PORT="${SMOKE_PORT:-3021}"
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

psql_val() {
  PGPASSWORD="$PG_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -Atq -c "$1"
}

echo "== T6 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t6-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t6-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

echo "starting worker..."
(cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t6-worker.log 2>&1 &
STARTED_WORKER_PID=$!
sleep 0.8
if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
  echo "worker exited immediately:"
  tail -80 /tmp/inwit-t6-worker.log || true
  exit 1
fi

UNAUTH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/review/today")
check "unauthenticated today is 401" "$([[ "$UNAUTH_CODE" == "401" ]] && echo 1 || echo 0)"

STAMP="$(date +%s)"
EMAIL="t6-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t6-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$REG"
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

CONTENT='梯度消失是深度神经网络训练中的一个经典问题。反向传播时，误差信号需要从输出层一层层传到更浅的层；若激活函数的导数小于 1（例如 sigmoid 的导数最大只有 0.25），多层连乘会让靠近输入的层拿到的梯度接近 0，于是那些层几乎不再更新，网络也就学不动。这在很深的、使用 sigmoid 或 tanh 的网络里尤其明显。常见缓解办法包括：改用 ReLU 一类导数在正半轴恒为 1 的激活函数、做批归一化稳住激活尺度、用残差连接给梯度一条近道，以及更谨慎的权重初始化。需要和梯度爆炸区分开：爆炸是连乘大于 1 导致梯度过大、训练发散；消失则是梯度过小、训练停滞。两者都来自深层连乘，只是方向相反。'

BODY=$(CONTENT="$CONTENT" node -e 'console.log(JSON.stringify({content: process.env.CONTENT}))')

echo "-- POST /api/captures"
CAP=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/captures" \
  -H 'content-type: application/json' \
  -d "$BODY")
echo "$CAP"
CAP_ID=$(printf '%s' "$CAP" | json_field id || true)
check "capture id" "$([[ -n "$CAP_ID" ]] && echo 1 || echo 0)"

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

CARD_COUNT=$(printf '%s' "$DETAIL" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  process.stdout.write(String((j.cards||[]).length));
')
check "cards >= 2" "$([[ "${CARD_COUNT:-0}" -ge 2 ]] && echo 1 || echo 0)"

echo "-- backfill review_states (idempotent)"
BACKFILL_OUT=$(cd "$SERVER_DIR" && pnpm exec tsx ../../scripts/backfill-review-states.ts)
echo "$BACKFILL_OUT"

if [[ -n "${USER_ID}" && -n "${PG_HOST:-}" ]]; then
  STATES_N=$(psql_val "SELECT count(*) FROM review_states WHERE user_id='$USER_ID';")
  echo "review_states for user=$STATES_N"
  check "review_states created for cards" "$([[ "${STATES_N:-0}" -ge "${CARD_COUNT:-0}" ]] && echo 1 || echo 0)"

  echo "-- set due_at to now so today queue includes the new cards"
  psql_val "UPDATE review_states SET due_at = now() WHERE user_id='$USER_ID';" >/dev/null
else
  echo "FAIL  missing user id or PG env"
  FAIL=$((FAIL + 1))
fi

echo "-- GET /api/review/today"
TODAY=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/review/today")
echo "$TODAY"
TODAY_STATS=$(printf '%s' "$TODAY" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const items=Array.isArray(j.items)?j.items:[];
  const withQ=items.filter((it)=>it.card && Array.isArray(it.card.questions));
  const withState=items.filter((it)=>it.reviewState && it.reviewState.cardId);
  process.stdout.write(JSON.stringify({
    count: items.length,
    withQuestions: withQ.length,
    withState: withState.length,
    reviewedToday: j.reviewedToday,
    total: j.total,
    card0: items[0]?.card?.id || "",
    card1: items[1]?.card?.id || "",
    card2: items[2]?.card?.id || "",
  }));
')
echo "today stats=$TODAY_STATS"
TODAY_COUNT=$(printf '%s' "$TODAY_STATS" | json_field count || true)
TODAY_STATE=$(printf '%s' "$TODAY_STATS" | json_field withState || true)
TODAY_Q=$(printf '%s' "$TODAY_STATS" | json_field withQuestions || true)
CARD_A=$(printf '%s' "$TODAY_STATS" | json_field card0 || true)
CARD_B=$(printf '%s' "$TODAY_STATS" | json_field card1 || true)
CARD_C=$(printf '%s' "$TODAY_STATS" | json_field card2 || true)
check "today queue has cards" "$([[ "${TODAY_COUNT:-0}" -ge 2 ]] && echo 1 || echo 0)"
check "today items include reviewState" "$([[ "$TODAY_STATE" == "$TODAY_COUNT" ]] && echo 1 || echo 0)"
check "today items include questions array" "$([[ "$TODAY_Q" == "$TODAY_COUNT" ]] && echo 1 || echo 0)"

echo "-- POST feedback=remembered on card A"
FB_A=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/review/${CARD_A}/feedback" \
  -H 'content-type: application/json' \
  -d '{"feedback":"remembered"}')
echo "$FB_A"
A_INTERVAL=$(printf '%s' "$FB_A" | json_field reviewState.intervalDays || true)
A_REPS=$(printf '%s' "$FB_A" | json_field reviewState.reps || true)
A_LAPSES=$(printf '%s' "$FB_A" | json_field reviewState.lapses || true)
A_FEEDBACK=$(printf '%s' "$FB_A" | json_field reviewState.lastFeedback || true)
A_LOG=$(printf '%s' "$FB_A" | json_field log.feedback || true)
A_DUE=$(printf '%s' "$FB_A" | json_field reviewState.dueAt || true)
check "remembered intervalDays=1" "$([[ "$A_INTERVAL" == "1" ]] && echo 1 || echo 0)"
check "remembered reps=1" "$([[ "$A_REPS" == "1" ]] && echo 1 || echo 0)"
check "remembered lapses=0" "$([[ "$A_LAPSES" == "0" ]] && echo 1 || echo 0)"
check "remembered lastFeedback" "$([[ "$A_FEEDBACK" == "remembered" ]] && echo 1 || echo 0)"
check "remembered log written" "$([[ "$A_LOG" == "remembered" ]] && echo 1 || echo 0)"

if [[ -n "${USER_ID}" && -n "$CARD_A" && -n "${PG_HOST:-}" ]]; then
  LOG_N=$(psql_val "SELECT count(*) FROM review_logs WHERE user_id='$USER_ID' AND card_id='$CARD_A' AND feedback='remembered';")
  check "review_logs has remembered row" "$([[ "${LOG_N:-0}" -ge 1 ]] && echo 1 || echo 0)"
  DUE_OK=$(A_DUE="$A_DUE" node -e '
    const due=Date.parse(process.env.A_DUE||"");
    const delta=due-Date.now();
    const day=24*60*60*1000;
    process.stdout.write(delta>day-60*1000 && delta<day+10*60*1000 ? "1":"0");
  ')
  check "remembered due_at ~ +1 day" "$DUE_OK"
fi

echo "-- POST feedback=forgot twice on card B"
FB_B1=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/review/${CARD_B}/feedback" \
  -H 'content-type: application/json' \
  -d '{"feedback":"forgot"}')
echo "$FB_B1"
FB_B2=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/review/${CARD_B}/feedback" \
  -H 'content-type: application/json' \
  -d '{"feedback":"forgot"}')
echo "$FB_B2"
B_INTERVAL=$(printf '%s' "$FB_B2" | json_field reviewState.intervalDays || true)
B_LAPSES=$(printf '%s' "$FB_B2" | json_field reviewState.lapses || true)
B_REPS=$(printf '%s' "$FB_B2" | json_field reviewState.reps || true)
B_EVOLVE=$(printf '%s' "$FB_B2" | json_field evolveJobId || true)
check "two forgots intervalDays=1" "$([[ "$B_INTERVAL" == "1" ]] && echo 1 || echo 0)"
check "two forgots lapses=2" "$([[ "$B_LAPSES" == "2" ]] && echo 1 || echo 0)"
check "two forgots reps=0" "$([[ "$B_REPS" == "0" ]] && echo 1 || echo 0)"
check "two forgots enqueue evolve" "$([[ -n "$B_EVOLVE" && "$B_EVOLVE" != "null" ]] && echo 1 || echo 0)"

echo "-- POST feedback=fuzzy"
FUZZY_CARD="${CARD_C:-$CARD_A}"
FB_C=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/review/${FUZZY_CARD}/feedback" \
  -H 'content-type: application/json' \
  -d '{"feedback":"fuzzy"}')
echo "$FB_C"
C_EVOLVE=$(printf '%s' "$FB_C" | json_field evolveJobId || true)
check "fuzzy enqueues evolve" "$([[ -n "$C_EVOLVE" && "$C_EVOLVE" != "null" ]] && echo 1 || echo 0)"

echo "-- GET /api/jobs?type=evolve"
EVOLVE_JOBS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs?type=evolve&limit=50")
echo "$EVOLVE_JOBS"
EVOLVE_N=$(printf '%s' "$EVOLVE_JOBS" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  process.stdout.write(String((j.items||[]).length));
')
check "evolve jobs listed" "$([[ "${EVOLVE_N:-0}" -ge 2 ]] && echo 1 || echo 0)"

echo "-- GET /api/review/stats"
STATS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/review/stats")
echo "$STATS"
S_FORGOT=$(printf '%s' "$STATS" | json_field last7Days.forgot || true)
S_FUZZY=$(printf '%s' "$STATS" | json_field last7Days.fuzzy || true)
S_REM=$(printf '%s' "$STATS" | json_field last7Days.remembered || true)
S_TOTAL=$(printf '%s' "$STATS" | json_field last7Days.total || true)
S_OVERDUE=$(printf '%s' "$STATS" | json_field overdueCount || true)
check "stats remembered=1" "$([[ "$S_REM" == "1" ]] && echo 1 || echo 0)"
check "stats forgot=2" "$([[ "$S_FORGOT" == "2" ]] && echo 1 || echo 0)"
check "stats fuzzy=1" "$([[ "$S_FUZZY" == "1" ]] && echo 1 || echo 0)"
check "stats total=4" "$([[ "$S_TOTAL" == "4" ]] && echo 1 || echo 0)"
check "stats overdueCount is a number" "$([[ "$S_OVERDUE" =~ ^[0-9]+$ ]] && echo 1 || echo 0)"

echo
echo "passed=$PASS failed=$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  echo "-- worker log (tail)"
  tail -80 /tmp/inwit-t6-worker.log || true
  echo "-- server log (tail)"
  tail -40 /tmp/inwit-t6-server.log || true
  exit 1
fi
