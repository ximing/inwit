#!/usr/bin/env bash
# T5 smoke: live digest agent + retrieval. Does not mock LLM.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$ROOT/apps/server"
BASE_URL="${BASE_URL:-http://127.0.0.1:3020}"
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
      for pid in $(lsof -t -nP -iTCP:3020 -sTCP:LISTEN 2>/dev/null || true); do
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

echo "== T5 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server..."
  (cd "$SERVER_DIR" && exec pnpm exec tsx src/index.ts) >/tmp/inwit-t5-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t5-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

echo "starting worker..."
(cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t5-worker.log 2>&1 &
STARTED_WORKER_PID=$!
sleep 0.8
if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
  echo "worker exited immediately:"
  tail -80 /tmp/inwit-t5-worker.log || true
  exit 1
fi

STAMP="$(date +%s)"
EMAIL="t5-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t5-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$REG"
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

CONTENT='梯度消失是深度神经网络训练中的一个经典问题。反向传播时，误差信号需要从输出层一层层传到更浅的层；若激活函数的导数小于 1（例如 sigmoid 的导数最大只有 0.25），多层连乘会让靠近输入的层拿到的梯度接近 0，于是那些层几乎不再更新，网络也就学不动。这在很深的、使用 sigmoid 或 tanh 的网络里尤其明显。常见缓解办法包括：改用 ReLU 一类导数在正半轴恒为 1 的激活函数、做批归一化稳住激活尺度、用残差连接给梯度一条近道，以及更谨慎的权重初始化。需要和梯度爆炸区分开：爆炸是连乘大于 1 导致梯度过大、训练发散；消失则是梯度过小、训练停滞。两者都来自深层连乘，只是方向相反。'

BODY=$(CONTENT="$CONTENT" node -e 'console.log(JSON.stringify({content: process.env.CONTENT}))')

echo "-- POST /api/captures (梯度消失)"
CAP=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/captures" \
  -H 'content-type: application/json' \
  -d "$BODY")
echo "$CAP"
CAP_ID=$(printf '%s' "$CAP" | json_field id || true)
CAP_STATUS=$(printf '%s' "$CAP" | json_field status || true)
check "capture id" "$([[ -n "$CAP_ID" ]] && echo 1 || echo 0)"
check "capture starts pending" "$([[ "$CAP_STATUS" == "pending" ]] && echo 1 || echo 0)"

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

CARD_STATS=$(printf '%s' "$DETAIL" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const cards=Array.isArray(j.cards)?j.cards:[];
  const withQ=cards.filter((c)=>Array.isArray(c.questions)&&c.questions.length>=1);
  process.stdout.write(JSON.stringify({count:cards.length, withQuestions:withQ.length}));
')
echo "card stats=$CARD_STATS"
CARD_COUNT=$(printf '%s' "$CARD_STATS" | json_field count || true)
CARD_WITH_Q=$(printf '%s' "$CARD_STATS" | json_field withQuestions || true)
check "cards >= 2" "$([[ "${CARD_COUNT:-0}" -ge 2 ]] && echo 1 || echo 0)"
check "every card has >=1 question" "$([[ "${CARD_COUNT:-0}" -ge 1 && "$CARD_COUNT" == "$CARD_WITH_Q" ]] && echo 1 || echo 0)"

echo "-- GET /api/jobs?type=digest"
JOBS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs?type=digest&limit=50")
echo "$JOBS"
JOB_DONE=$(printf '%s' "$JOBS" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const id=process.argv[1];
  const job=(j.items||[]).find((it)=>it.payload&&it.payload.captureId===id&&it.type==="digest");
  process.stdout.write(job&&job.status==="done"?"1":"0");
' "$CAP_ID" || true)
check "digest job done" "$([[ "$JOB_DONE" == "1" ]] && echo 1 || echo 0)"

if [[ -n "${USER_ID}" && -n "${PG_HOST:-}" ]]; then
  STEPS_N=$(psql_val "SELECT COALESCE(jsonb_array_length(steps),0) FROM agent_executions WHERE user_id='$USER_ID' AND agent_type='digest' ORDER BY started_at DESC LIMIT 1;")
  echo "agent_executions.steps=$STEPS_N"
  check "agent_executions has steps" "$([[ "${STEPS_N:-0}" -ge 1 ]] && echo 1 || echo 0)"

  CHAT_N=$(psql_val "SELECT count(*) FROM llm_usage_logs WHERE user_id='$USER_ID' AND capability='chat';")
  EMBED_N=$(psql_val "SELECT count(*) FROM llm_usage_logs WHERE user_id='$USER_ID' AND capability='embed';")
  echo "llm_usage_logs chat=$CHAT_N embed=$EMBED_N"
  check "llm_usage_logs has chat" "$([[ "${CHAT_N:-0}" -ge 1 ]] && echo 1 || echo 0)"
  check "llm_usage_logs has embed" "$([[ "${EMBED_N:-0}" -ge 1 ]] && echo 1 || echo 0)"
else
  echo "FAIL  missing user id or PG env for telemetry checks"
  FAIL=$((FAIL + 1))
fi

echo "-- searchCards 梯度"
SEARCH_OUT=""
if [[ -n "${USER_ID}" ]]; then
  set +e
  SEARCH_OUT=$(cd "$SERVER_DIR" && pnpm exec tsx src/retrieval/self-test.ts --search --user-id "$USER_ID" --query "梯度消失" --limit 8)
  SEARCH_RC=$?
  set -e
  echo "$SEARCH_OUT"
  check "searchCards recalled digested cards" "$([[ "$SEARCH_RC" -eq 0 ]] && echo 1 || echo 0)"
else
  echo "FAIL  missing user id for search"
  FAIL=$((FAIL + 1))
fi

echo
echo "passed=$PASS failed=$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  echo "-- worker log (tail)"
  tail -80 /tmp/inwit-t5-worker.log || true
  echo "-- server log (tail)"
  tail -40 /tmp/inwit-t5-server.log || true
  exit 1
fi
