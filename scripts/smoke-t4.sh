#!/usr/bin/env bash
# T4 smoke: captures + threads + PG job worker against a local @inwit/server.
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

echo "== T4 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server..."
  (cd "$SERVER_DIR" && exec pnpm exec tsx src/index.ts) >/tmp/inwit-t4-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 40); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -50 /tmp/inwit-t4-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

echo "starting worker..."
(cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t4-worker.log 2>&1 &
STARTED_WORKER_PID=$!
sleep 0.4
if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
  echo "worker exited immediately:"
  tail -50 /tmp/inwit-t4-worker.log || true
  exit 1
fi

STAMP="$(date +%s)"
EMAIL="t4-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t4-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$REG"
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

echo "-- GET /api/captures without cookie → 401"
UNAUTH_CODE=$(curl -sS -o /tmp/inwit-t4-unauth.json -w '%{http_code}' "$BASE_URL/api/captures")
echo "status=$UNAUTH_CODE body=$(cat /tmp/inwit-t4-unauth.json)"
check "unauthenticated captures is 401" "$([[ "$UNAUTH_CODE" == "401" ]] && echo 1 || echo 0)"

echo "-- POST /api/captures (two inbox items)"
CAP1=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/captures" \
  -H 'content-type: application/json' \
  -d '{"content":"L1 正则化把权重往零推，容易得到稀疏解。"}')
echo "$CAP1"
CAP1_ID=$(printf '%s' "$CAP1" | json_field id || true)
CAP1_STATUS=$(printf '%s' "$CAP1" | json_field status || true)
CAP1_TYPE=$(printf '%s' "$CAP1" | json_field type || true)
check "capture1 id" "$([[ -n "$CAP1_ID" ]] && echo 1 || echo 0)"
check "capture1 status pending" "$([[ "$CAP1_STATUS" == "pending" ]] && echo 1 || echo 0)"
check "capture1 type text" "$([[ "$CAP1_TYPE" == "text" ]] && echo 1 || echo 0)"

CAP2=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/captures" \
  -H 'content-type: application/json' \
  -d '{"content":"L2 正则化惩罚权重平方，解更平滑但不稀疏。"}')
echo "$CAP2"
CAP2_ID=$(printf '%s' "$CAP2" | json_field id || true)
check "capture2 id" "$([[ -n "$CAP2_ID" ]] && echo 1 || echo 0)"

echo "-- wait for digest jobs to be consumed"
JOBS_DONE=0
for _ in $(seq 1 40); do
  JOBS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs?type=digest&limit=50")
  JOBS_DONE=$(printf '%s' "$JOBS" | node -e '
    const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const items=j.items||[];
    const ids=process.argv.slice(1);
    const ok=ids.every((id)=>items.some((it)=>it.payload&&it.payload.captureId===id&&it.status==="done"&&it.type==="digest"));
    process.stdout.write(ok?"1":"0");
  ' "$CAP1_ID" "$CAP2_ID" || true)
  if [[ "$JOBS_DONE" == "1" ]]; then
    break
  fi
  sleep 0.25
done
echo "$JOBS"
check "digest jobs consumed as done" "$([[ "$JOBS_DONE" == "1" ]] && echo 1 || echo 0)"

STILL_PENDING=$(printf '%s' "$JOBS" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const items=j.items||[];
  const ids=new Set(process.argv.slice(1));
  const pending=items.filter((it)=>ids.has(it.payload&&it.payload.captureId)&&it.status!=="done");
  process.stdout.write(String(pending.length));
' "$CAP1_ID" "$CAP2_ID" || true)
check "no leftover non-done digest jobs for the two captures" "$([[ "$STILL_PENDING" == "0" ]] && echo 1 || echo 0)"

echo "-- GET /api/captures list"
LIST=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/captures")
echo "$LIST"
LIST_TOTAL=$(printf '%s' "$LIST" | json_field total || true)
LIST_LEN=$(printf '%s' "$LIST" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String((j.items||[]).length));')
check "captures list total>=2" "$([[ "$LIST_TOTAL" -ge 2 ]] && echo 1 || echo 0)"
check "captures list items>=2" "$([[ "$LIST_LEN" -ge 2 ]] && echo 1 || echo 0)"

echo "-- GET /api/captures/:id (cards array, still pending after stub)"
DETAIL=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/captures/${CAP1_ID}")
echo "$DETAIL"
DETAIL_STATUS=$(printf '%s' "$DETAIL" | json_field status || true)
DETAIL_CARDS=$(printf '%s' "$DETAIL" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(Array.isArray(j.cards)?"1":"0");')
check "capture detail still pending (stub)" "$([[ "$DETAIL_STATUS" == "pending" ]] && echo 1 || echo 0)"
check "capture detail has cards array" "$([[ "$DETAIL_CARDS" == "1" ]] && echo 1 || echo 0)"

echo "-- POST /api/threads"
THREAD=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/threads" \
  -H 'content-type: application/json' \
  -d '{"title":"正则化","goal":"搞清 L1/L2 的差别"}')
echo "$THREAD"
THREAD_ID=$(printf '%s' "$THREAD" | json_field id || true)
THREAD_STATUS=$(printf '%s' "$THREAD" | json_field status || true)
check "thread created" "$([[ -n "$THREAD_ID" ]] && echo 1 || echo 0)"
check "thread status active" "$([[ "$THREAD_STATUS" == "active" ]] && echo 1 || echo 0)"

echo "-- POST /api/captures with threadId"
CAP3=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/captures" \
  -H 'content-type: application/json' \
  -d "{\"content\":\"Elastic Net 是 L1 和 L2 的凸组合。\",\"threadId\":\"$THREAD_ID\"}")
echo "$CAP3"
CAP3_ID=$(printf '%s' "$CAP3" | json_field id || true)
CAP3_THREAD=$(printf '%s' "$CAP3" | json_field threadId || true)
check "threaded capture id" "$([[ -n "$CAP3_ID" ]] && echo 1 || echo 0)"
check "threaded capture has threadId" "$([[ "$CAP3_THREAD" == "$THREAD_ID" ]] && echo 1 || echo 0)"

echo "-- GET /api/captures?threadId="
FILTERED=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/captures?threadId=${THREAD_ID}")
echo "$FILTERED"
FILTER_OK=$(printf '%s' "$FILTERED" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const items=j.items||[];
  const tid=process.argv[1];
  const ok=items.length>=1 && items.every((it)=>it.threadId===tid);
  process.stdout.write(ok?"1":"0");
' "$THREAD_ID" || true)
FILTER_HAS=$(printf '%s' "$FILTERED" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const id=process.argv[1];
  process.stdout.write((j.items||[]).some((it)=>it.id===id)?"1":"0");
' "$CAP3_ID" || true)
FILTER_NO_INBOX=$(printf '%s' "$FILTERED" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const id=process.argv[1];
  process.stdout.write((j.items||[]).some((it)=>it.id===id)?"1":"0");
' "$CAP1_ID" || true)
check "thread filter only that thread" "$([[ "$FILTER_OK" == "1" ]] && echo 1 || echo 0)"
check "thread filter includes threaded capture" "$([[ "$FILTER_HAS" == "1" ]] && echo 1 || echo 0)"
check "thread filter excludes inbox capture" "$([[ "$FILTER_NO_INBOX" == "0" ]] && echo 1 || echo 0)"

echo "-- PATCH /api/threads/:id"
PATCHED=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X PATCH "$BASE_URL/api/threads/${THREAD_ID}" \
  -H 'content-type: application/json' \
  -d '{"title":"正则化专题"}')
echo "$PATCHED"
PATCH_TITLE=$(printf '%s' "$PATCHED" | json_field title || true)
check "thread patch title" "$([[ "$PATCH_TITLE" == "正则化专题" ]] && echo 1 || echo 0)"

echo "-- POST /api/jobs/:id/retry after manual fail"
FAIL_JOB_ID=$(printf '%s' "$JOBS" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const items=j.items||[];
  const id=process.argv[1];
  const job=items.find((it)=>it.payload&&it.payload.captureId===id&&it.status==="done");
  if(!job) process.exit(1);
  process.stdout.write(job.id);
' "$CAP1_ID" || true)
check "picked a done job to fail" "$([[ -n "$FAIL_JOB_ID" ]] && echo 1 || echo 0)"

if [[ -n "$FAIL_JOB_ID" && -n "${PG_HOST:-}" ]]; then
  PGPASSWORD="$PG_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -v ON_ERROR_STOP=1 \
    -c "UPDATE jobs SET status='failed', last_error='manual-fail', finished_at=now() WHERE id='$FAIL_JOB_ID';" \
    >/tmp/inwit-t4-psql-fail.log
  RETRY=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/jobs/${FAIL_JOB_ID}/retry")
  echo "$RETRY"
  RETRY_STATUS=$(printf '%s' "$RETRY" | json_field status || true)
  check "retry requeues as pending" "$([[ "$RETRY_STATUS" == "pending" ]] && echo 1 || echo 0)"

  RETRY_DONE=0
  for _ in $(seq 1 40); do
    ONE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs?limit=50")
    RETRY_DONE=$(printf '%s' "$ONE" | node -e '
      const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
      const id=process.argv[1];
      const job=(j.items||[]).find((it)=>it.id===id);
      process.stdout.write(job&&job.status==="done"?"1":"0");
    ' "$FAIL_JOB_ID" || true)
    if [[ "$RETRY_DONE" == "1" ]]; then
      echo "$ONE" | node -e '
        const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
        const id=process.argv[1];
        const job=(j.items||[]).find((it)=>it.id===id);
        console.log(JSON.stringify(job,null,2));
      ' "$FAIL_JOB_ID"
      break
    fi
    sleep 0.25
  done
  check "retried job consumed as done" "$([[ "$RETRY_DONE" == "1" ]] && echo 1 || echo 0)"
else
  echo "FAIL  missing job id or PG env for retry"
  FAIL=$((FAIL + 1))
fi

echo "-- POST /api/jobs/:id/cancel"
if [[ -n "${PG_HOST:-}" && -n "$USER_ID" ]]; then
  CANCEL_ID=$(PGPASSWORD="$PG_PASSWORD" psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DATABASE" -Atq \
    -c "INSERT INTO jobs (user_id, type, status, payload, run_at) VALUES ('$USER_ID', 'digest', 'pending', '{\"captureId\":\"$CAP1_ID\"}'::jsonb, now() + interval '1 hour') RETURNING id;" \
    | grep -E '^[0-9a-fA-F-]{36}$' | head -1)
  echo "future job=$CANCEL_ID"
  CANCEL=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/jobs/${CANCEL_ID}/cancel")
  echo "$CANCEL"
  CANCEL_STATUS=$(printf '%s' "$CANCEL" | json_field status || true)
  CANCEL_ERR=$(printf '%s' "$CANCEL" | json_field lastError || true)
  check "cancel pending job -> failed" "$([[ "$CANCEL_STATUS" == "failed" ]] && echo 1 || echo 0)"
  check "cancel lastError=cancelled" "$([[ "$CANCEL_ERR" == "cancelled" ]] && echo 1 || echo 0)"
else
  echo "FAIL  missing PG env for cancel"
  FAIL=$((FAIL + 1))
fi

echo "-- POST /api/threads/:id/archive + capture into archived thread"
ARCHIVED=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/threads/${THREAD_ID}/archive")
echo "$ARCHIVED"
ARCH_STATUS=$(printf '%s' "$ARCHIVED" | json_field status || true)
check "archive sets status archived" "$([[ "$ARCH_STATUS" == "archived" ]] && echo 1 || echo 0)"

ARCH_CAP_CODE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o /tmp/inwit-t4-archived.json -w '%{http_code}' \
  -X POST "$BASE_URL/api/captures" \
  -H 'content-type: application/json' \
  -d "{\"content\":\"should fail\",\"threadId\":\"$THREAD_ID\"}")
echo "status=$ARCH_CAP_CODE body=$(cat /tmp/inwit-t4-archived.json)"
check "capture into archived thread is 409" "$([[ "$ARCH_CAP_CODE" == "409" ]] && echo 1 || echo 0)"

echo "-- DELETE /api/captures/:id"
DEL_CODE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o /tmp/inwit-t4-del.json -w '%{http_code}' \
  -X DELETE "$BASE_URL/api/captures/${CAP2_ID}")
echo "status=$DEL_CODE"
check "delete capture is 204" "$([[ "$DEL_CODE" == "204" ]] && echo 1 || echo 0)"
GONE_CODE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o /tmp/inwit-t4-gone.json -w '%{http_code}' \
  "$BASE_URL/api/captures/${CAP2_ID}")
check "deleted capture is 404" "$([[ "$GONE_CODE" == "404" ]] && echo 1 || echo 0)"

echo
echo "passed=$PASS failed=$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  echo "-- worker log (tail)"
  tail -40 /tmp/inwit-t4-worker.log || true
  exit 1
fi
