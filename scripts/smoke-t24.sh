#!/usr/bin/env bash
# T24 smoke: review settings/stats + jobs queue/usage (rewrite T1/T2 APIs).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$ROOT/apps/server"
COOKIE_JAR="$(mktemp)"
STARTED_SERVER_PID=""
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
PORT="${SMOKE_PORT:-3033}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
export PGGSSENCMODE="${PGGSSENCMODE:-disable}"

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

echo "== T24 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t24-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t24-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

UNAUTH_CODE=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/review/settings")
check "unauthenticated settings is 401" "$([[ "$UNAUTH_CODE" == "401" ]] && echo 1 || echo 0)"

STAMP="$(date +%s)"
EMAIL="t24-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t24-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

echo "-- GET /api/review/settings (defaults)"
SETTINGS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/review/settings")
echo "settings=$SETTINGS"
DEF_EVAL=$(printf '%s' "$SETTINGS" | node -e '
  const s=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const steps=Array.isArray(s.learningSteps)?s.learningSteps:[];
  const ok=s.dailyReviewLimit===20 && s.dailyNewLimit===5 && s.startingEase===2.5
    && s.fuzzyScale===1.2 && JSON.stringify(steps)==="[1,3,6]";
  process.stdout.write(ok?"1":"0");
')
check "GET settings returns defaults" "$DEF_EVAL"

echo "-- PUT /api/review/settings (valid)"
NEXT='{"dailyReviewLimit":30,"dailyNewLimit":8,"startingEase":2.2,"fuzzyScale":1.1,"learningSteps":[1,4,8]}'
PUT_OK=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X PUT "$BASE_URL/api/review/settings" \
  -H 'content-type: application/json' \
  -d "$NEXT")
echo "put=$PUT_OK"
PUT_EVAL=$(printf '%s' "$PUT_OK" | node -e '
  const s=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const ok=s.dailyReviewLimit===30 && s.dailyNewLimit===8 && s.startingEase===2.2
    && s.fuzzyScale===1.1 && JSON.stringify(s.learningSteps)==="[1,4,8]";
  process.stdout.write(ok?"1":"0");
')
check "PUT settings returns new values" "$PUT_EVAL"

GET_AFTER=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/review/settings")
AFTER_LIMIT=$(printf '%s' "$GET_AFTER" | json_field dailyReviewLimit || true)
check "GET settings persists PUT" "$([[ "$AFTER_LIMIT" == "30" ]] && echo 1 || echo 0)"

echo "-- PUT /api/review/settings (invalid range)"
BAD_RANGE_FILE="$(mktemp)"
BAD_RANGE_CODE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o "$BAD_RANGE_FILE" -w '%{http_code}' \
  -X PUT "$BASE_URL/api/review/settings" \
  -H 'content-type: application/json' \
  -d '{"dailyReviewLimit":1,"dailyNewLimit":8,"startingEase":2.2,"fuzzyScale":1.1,"learningSteps":[1,4,8]}')
BAD_RANGE_BODY=$(cat "$BAD_RANGE_FILE")
rm -f "$BAD_RANGE_FILE"
echo "invalid range status=$BAD_RANGE_CODE body=$BAD_RANGE_BODY"
# Unified Zod handler returns 400 VALIDATION_ERROR (not 422).
check "PUT out-of-range settings is 400" "$([[ "$BAD_RANGE_CODE" == "400" ]] && echo 1 || echo 0)"
BAD_RANGE_CODE_FIELD=$(printf '%s' "$BAD_RANGE_BODY" | json_field error.code || true)
check "PUT out-of-range error.code=VALIDATION_ERROR" "$([[ "$BAD_RANGE_CODE_FIELD" == "VALIDATION_ERROR" ]] && echo 1 || echo 0)"

echo "-- PUT /api/review/settings (partial body)"
BAD_PARTIAL_FILE="$(mktemp)"
BAD_PARTIAL_CODE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o "$BAD_PARTIAL_FILE" -w '%{http_code}' \
  -X PUT "$BASE_URL/api/review/settings" \
  -H 'content-type: application/json' \
  -d '{"dailyReviewLimit":20}')
BAD_PARTIAL_BODY=$(cat "$BAD_PARTIAL_FILE")
rm -f "$BAD_PARTIAL_FILE"
echo "invalid partial status=$BAD_PARTIAL_CODE body=$BAD_PARTIAL_BODY"
check "PUT partial settings is 400" "$([[ "$BAD_PARTIAL_CODE" == "400" ]] && echo 1 || echo 0)"
BAD_PARTIAL_CODE_FIELD=$(printf '%s' "$BAD_PARTIAL_BODY" | json_field error.code || true)
check "PUT partial error.code=VALIDATION_ERROR" "$([[ "$BAD_PARTIAL_CODE_FIELD" == "VALIDATION_ERROR" ]] && echo 1 || echo 0)"

echo "-- PUT /api/review/settings (non-increasing learningSteps)"
BAD_STEPS_FILE="$(mktemp)"
BAD_STEPS_CODE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o "$BAD_STEPS_FILE" -w '%{http_code}' \
  -X PUT "$BASE_URL/api/review/settings" \
  -H 'content-type: application/json' \
  -d '{"dailyReviewLimit":20,"dailyNewLimit":5,"startingEase":2.5,"fuzzyScale":1.2,"learningSteps":[3,1]}')
BAD_STEPS_BODY=$(cat "$BAD_STEPS_FILE")
rm -f "$BAD_STEPS_FILE"
echo "invalid steps status=$BAD_STEPS_CODE body=$BAD_STEPS_BODY"
check "PUT non-increasing learningSteps is 400" "$([[ "$BAD_STEPS_CODE" == "400" ]] && echo 1 || echo 0)"

PERSISTED=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/review/settings")
PERSISTED_LIMIT=$(printf '%s' "$PERSISTED" | json_field dailyReviewLimit || true)
check "invalid PUTs did not clobber settings" "$([[ "$PERSISTED_LIMIT" == "30" ]] && echo 1 || echo 0)"

echo "-- GET /api/review/stats (extended fields)"
STATS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/review/stats")
echo "stats=$STATS"
STATS_EVAL=$(printf '%s' "$STATS" | node -e '
  const s=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const isInt=(n)=>Number.isInteger(n);
  const dailyOk=Array.isArray(s.daily) && s.daily.length===7
    && s.daily.every((d)=>typeof d.date==="string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date)
      && isInt(d.forgot) && isInt(d.fuzzy) && isInt(d.remembered));
  const forecastOk=Array.isArray(s.forecast) && s.forecast.length===7
    && s.forecast.every((d)=>typeof d.date==="string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && isInt(d.count));
  const last7=s.last7Days||{};
  const streak=s.streak||{};
  const ok=isInt(s.overdueCount)
    && isInt(last7.forgot) && isInt(last7.fuzzy) && isInt(last7.remembered) && isInt(last7.total)
    && isInt(streak.current) && isInt(streak.longest)
    && isInt(s.totalCards) && isInt(s.masteredCount) && isInt(s.reviews7d)
    && (s.retention7d===null || (isInt(s.retention7d) && s.retention7d>=0 && s.retention7d<=100))
    && dailyOk && forecastOk
    && s.totalCards===0 && s.masteredCount===0 && s.reviews7d===0 && s.retention7d===null
    && streak.current===0 && streak.longest===0;
  process.stdout.write(JSON.stringify({
    ok: ok?1:0,
    hasStreak: streak.current!==undefined && streak.longest!==undefined?1:0,
    hasTotalCards: s.totalCards!==undefined?1:0,
    hasMastered: s.masteredCount!==undefined?1:0,
    hasRetention: Object.prototype.hasOwnProperty.call(s,"retention7d")?1:0,
    hasReviews7d: s.reviews7d!==undefined?1:0,
    dailyN: Array.isArray(s.daily)?s.daily.length:-1,
    forecastN: Array.isArray(s.forecast)?s.forecast.length:-1,
    last7: last7.total,
    overdue: s.overdueCount,
  }));
')
echo "statsEval=$STATS_EVAL"
check "stats has streak/totalCards/masteredCount/retention7d/reviews7d" "$([[ "$(printf '%s' "$STATS_EVAL" | json_field hasStreak)" == "1" && "$(printf '%s' "$STATS_EVAL" | json_field hasTotalCards)" == "1" && "$(printf '%s' "$STATS_EVAL" | json_field hasMastered)" == "1" && "$(printf '%s' "$STATS_EVAL" | json_field hasRetention)" == "1" && "$(printf '%s' "$STATS_EVAL" | json_field hasReviews7d)" == "1" ]] && echo 1 || echo 0)"
check "stats daily and forecast are 7 local days" "$([[ "$(printf '%s' "$STATS_EVAL" | json_field dailyN)" == "7" && "$(printf '%s' "$STATS_EVAL" | json_field forecastN)" == "7" ]] && echo 1 || echo 0)"
check "stats last7Days and overdueCount still present" "$([[ "$(printf '%s' "$STATS_EVAL" | json_field last7)" == "0" && "$(printf '%s' "$STATS_EVAL" | json_field overdue)" == "0" ]] && echo 1 || echo 0)"
check "empty-user stats shape is valid" "$([[ "$(printf '%s' "$STATS_EVAL" | json_field ok)" == "1" ]] && echo 1 || echo 0)"

echo "-- GET /api/jobs/queue (empty)"
QUEUE0=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs/queue")
echo "queue0=$QUEUE0"
QUEUE0_EVAL=$(printf '%s' "$QUEUE0" | node -e '
  const q=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const c=q.counts||{};
  const ok=Array.isArray(q.running) && Array.isArray(q.pending)
    && Number.isInteger(c.running) && Number.isInteger(c.pending)
    && Number.isInteger(c.doneToday) && Number.isInteger(c.failed)
    && q.running.length===0 && q.pending.length===0
    && c.running===0 && c.pending===0 && c.doneToday===0 && c.failed===0;
  process.stdout.write(ok?"1":"0");
')
check "GET /api/jobs/queue is not captured by /:id" "$QUEUE0_EVAL"
check "empty queue counts are zero" "$QUEUE0_EVAL"

echo "-- POST /api/documents (leave digest pending, no worker)"
DOC=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
  -H 'content-type: application/json' \
  -d '{"title":"T24 队列探针","contentMd":"只为留下一条 pending digest。","source":"paste"}')
DOC_ID=$(printf '%s' "$DOC" | json_field id || true)
check "create document" "$([[ -n "$DOC_ID" ]] && echo 1 || echo 0)"

echo "-- GET /api/jobs/queue (pending digest)"
QUEUE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs/queue")
echo "queue=$QUEUE"
QUEUE_EVAL=$(printf '%s' "$QUEUE" | node -e '
  const q=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const c=q.counts||{};
  const pending=Array.isArray(q.pending)?q.pending:[];
  const digest=pending.find((j)=>j.type==="digest") || pending[0];
  const ok=c.pending>=1 && pending.length>=1
    && digest && typeof digest.summary==="string" && digest.summary.length>0
    && typeof digest.description==="string" && digest.description.length>0
    && typeof digest.scheduledFor==="string" && digest.scheduledFor.length>0;
  process.stdout.write(JSON.stringify({
    ok: ok?1:0,
    pendingN: pending.length,
    countsPending: c.pending,
    summary: digest && digest.summary,
    description: digest && digest.description,
    scheduledFor: digest && digest.scheduledFor,
  }));
')
echo "queueEval=$QUEUE_EVAL"
check "queue has pending digest with summary/description/scheduledFor" "$([[ "$(printf '%s' "$QUEUE_EVAL" | json_field ok)" == "1" ]] && echo 1 || echo 0)"

echo "-- GET /api/jobs/usage"
USAGE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs/usage")
echo "usage=$USAGE"
USAGE_EVAL=$(printf '%s' "$USAGE" | node -e '
  const u=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const dailyOk=Array.isArray(u.daily) && u.daily.length===7
    && u.daily.every((d)=>typeof d.date==="string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Number.isInteger(d.tokens));
  const byTypeOk=Array.isArray(u.byType)
    && u.byType.every((row)=>typeof row.type==="string" && row.type.length>0 && Number.isInteger(row.tokens));
  const ok=dailyOk && byTypeOk && Number.isInteger(u.total) && u.total===0;
  process.stdout.write(JSON.stringify({
    ok: ok?1:0,
    dailyN: Array.isArray(u.daily)?u.daily.length:-1,
    byTypeN: Array.isArray(u.byType)?u.byType.length:-1,
    total: u.total,
  }));
')
echo "usageEval=$USAGE_EVAL"
check "GET /api/jobs/usage is not captured by /:id" "$([[ "$(printf '%s' "$USAGE_EVAL" | json_field dailyN)" == "7" ]] && echo 1 || echo 0)"
check "usage has daily[7] + byType + total" "$([[ "$(printf '%s' "$USAGE_EVAL" | json_field ok)" == "1" ]] && echo 1 || echo 0)"

echo
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "server tail:"
  tail -40 /tmp/inwit-t24-server.log || true
  exit 1
fi
