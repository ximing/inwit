#!/usr/bin/env bash
# T23 smoke: weekly_report job → recap document + latest API + worker rescan.
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

PORT="${SMOKE_PORT:-3032}"
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

poll_doc() {
  local id="$1"
  local detail=""
  local status=""
  for _ in $(seq 1 90); do
    detail=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/documents/${id}")
    status=$(printf '%s' "$detail" | json_field status || true)
    if [[ "$status" == "digested" || "$status" == "failed" ]]; then
      printf '%s' "$detail"
      return 0
    fi
    sleep 2
  done
  printf '%s' "$detail"
}

poll_job() {
  local id="$1"
  local row=""
  local status=""
  for _ in $(seq 1 120); do
    row=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs/${id}")
    status=$(printf '%s' "$row" | json_field status || true)
    if [[ "$status" == "done" || "$status" == "failed" ]]; then
      printf '%s' "$row"
      return 0
    fi
    sleep 3
  done
  printf '%s' "${row:-{}}"
}

start_worker() {
  local skip="${1:-}"
  if [[ -n "${STARTED_WORKER_PID}" ]]; then
    kill_tree "$STARTED_WORKER_PID"
    wait "$STARTED_WORKER_PID" 2>/dev/null || true
    STARTED_WORKER_PID=""
  fi
  echo "starting worker skip_scan=${skip:-0}..."
  if [[ "$skip" == "1" ]]; then
    (cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 INWIT_SKIP_WEEKLY_SCAN=1 pnpm exec tsx src/worker.ts) >/tmp/inwit-t23-worker.log 2>&1 &
  else
    (cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t23-worker.log 2>&1 &
  fi
  STARTED_WORKER_PID=$!
  sleep 0.8
  if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
    echo "worker exited immediately:"
    tail -80 /tmp/inwit-t23-worker.log || true
    exit 1
  fi
}

pg_pool_js() {
  cat <<'EOF'
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
});
EOF
}

delete_weekly_jobs() {
  local uid="$1"
  (cd "$SERVER_DIR" && USER_ID="$uid" node --input-type=module -e "$(pg_pool_js)
const r = await pool.query(
  'DELETE FROM jobs WHERE user_id=\$1 AND type=\$2',
  [process.env.USER_ID, 'weekly_report'],
);
process.stdout.write(String(r.rowCount ?? 0));
await pool.end();
")
}

reset_weekly_queue() {
  (cd "$SERVER_DIR" && node --input-type=module -e "$(pg_pool_js)
const r = await pool.query(
  \`UPDATE jobs SET status='failed', last_error='t23-smoke-reset', finished_at=now(), updated_at=now()
    WHERE type='weekly_report' AND status IN ('pending','running')\`,
);
process.stdout.write(String(r.rowCount ?? 0));
await pool.end();
")
}

echo "== T23 smoke @ $BASE_URL =="

echo "stopping leftover inwit workers (same DB queue)..."
# cmdline is `tsx src/worker.ts` (relative); the inwit path is in node_modules.
# pgrep exits 1 when nothing matches; keep going under `set -o pipefail`.
pgrep -fl 'src/worker.ts|dist/worker.js' | grep '/inwit/' | awk '{print $1}' | while read -r pid; do
  [[ "$pid" =~ ^[0-9]+$ ]] || continue
  [[ "$pid" == "$$" || "$pid" == "$PPID" ]] && continue
  kill_tree "$pid"
done || true
if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    kill_tree "$pid"
  done
fi
sleep 0.5

RESET_N=$(reset_weekly_queue || echo 0)
echo "reset leftover weekly_report queue=$RESET_N"

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t23-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t23-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

start_worker 1

STAMP="$(date +%s)"
EMAIL="t23-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t23-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

CONTENT1='偏差（bias）衡量模型预测的期望值和真实值差多远：高偏差通常来自模型太简单，欠拟合，训练集和测试集都差。方差（variance）衡量换一批训练数据时预测会抖多厉害：高方差通常来自模型太复杂，过拟合，训练集很好但换数据就崩。两者此消彼长，这就是偏差-方差权衡。'
CONTENT2='过拟合是模型把训练噪声也学进去了，换数据就垮；欠拟合是模型连训练集都学不像。正则化、早停、更多数据用来压过拟合；加特征、换更强模型用来救欠拟合。两者都是泛化出了问题，只是方向相反。'

digest_one() {
  local title="$1"
  local content="$2"
  local doc
  doc=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
    -H 'content-type: application/json' \
    -d "$(node -e 'const c=process.argv[1]; const t=process.argv[2]; process.stdout.write(JSON.stringify({title:t, contentMd:c, source:"paste"}))' "$content" "$title")")
  local id
  id=$(printf '%s' "$doc" | json_field id || true)
  echo "$id"
}

echo "-- digest 偏差/方差"
DOC1=$(digest_one "偏差与方差" "$CONTENT1")
check "create document 1" "$([[ -n "$DOC1" ]] && echo 1 || echo 0)"
DETAIL1=$(poll_doc "$DOC1")
check "document 1 digested" "$([[ "$(printf '%s' "$DETAIL1" | json_field status || true)" == "digested" ]] && echo 1 || echo 0)"

echo "-- digest 过拟合/欠拟合"
DOC2=$(digest_one "过拟合与欠拟合" "$CONTENT2")
check "create document 2" "$([[ -n "$DOC2" ]] && echo 1 || echo 0)"
DETAIL2=$(poll_doc "$DOC2")
check "document 2 digested" "$([[ "$(printf '%s' "$DETAIL2" | json_field status || true)" == "digested" ]] && echo 1 || echo 0)"

CARDS_JSON=$(DETAIL1="$DETAIL1" DETAIL2="$DETAIL2" node -e '
  const a=JSON.parse(process.env.DETAIL1);
  const b=JSON.parse(process.env.DETAIL2);
  const cards=[...(a.cards||[]), ...(b.cards||[])];
  process.stdout.write(JSON.stringify({ n: cards.length, ids: cards.map((c)=>c.id), concepts: cards.map((c)=>c.concept) }));
')
echo "cards=$CARDS_JSON"
CARD_N=$(printf '%s' "$CARDS_JSON" | json_field n || true)
CARD_A=$(printf '%s' "$CARDS_JSON" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(d.ids[0]||"");')
CARD_B=$(printf '%s' "$CARDS_JSON" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(d.ids[1]||"");')
CARD_C=$(printf '%s' "$CARDS_JSON" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(d.ids[2]||d.ids[0]||"");')
check "digest produced 3+ cards" "$([[ "${CARD_N:-0}" -ge 3 && -n "$CARD_A" && -n "$CARD_B" && -n "$CARD_C" ]] && echo 1 || echo 0)"

feedback() {
  local id="$1"
  local kind="$2"
  curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/review/${id}/feedback" \
    -H 'content-type: application/json' \
    -d "{\"feedback\":\"$kind\"}" >/dev/null
}

echo "-- seed 三档反馈 (forgot×3 + fuzzy + remembered)"
feedback "$CARD_A" forgot
feedback "$CARD_B" forgot
feedback "$CARD_C" forgot
feedback "$CARD_A" remembered
feedback "$CARD_B" fuzzy

echo "-- POST /api/reports/weekly/generate"
GEN=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/reports/weekly/generate")
JOB_ID=$(printf '%s' "$GEN" | json_field id || true)
JOB_TYPE=$(printf '%s' "$GEN" | json_field type || true)
WEEK_START=$(printf '%s' "$GEN" | json_field payload.weekStart || true)
echo "generate job=$JOB_ID type=$JOB_TYPE weekStart=$WEEK_START"
check "manual generate returns weekly_report job" "$([[ -n "$JOB_ID" && "$JOB_TYPE" == "weekly_report" ]] && echo 1 || echo 0)"
check "payload weekStart is YYYY-MM-DD" "$([[ "$WEEK_START" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && echo 1 || echo 0)"

GEN2=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/reports/weekly/generate")
JOB2=$(printf '%s' "$GEN2" | json_field id || true)
check "second generate returns the in-flight job" "$([[ "$JOB2" == "$JOB_ID" ]] && echo 1 || echo 0)"

echo "-- wait weekly_report job"
JOB=$(poll_job "$JOB_ID")
JOB_STATUS=$(printf '%s' "$JOB" | json_field status || true)
JOB_ERR=$(printf '%s' "$JOB" | json_field lastError || true)
echo "weekly job status=$JOB_STATUS error=$JOB_ERR"
if [[ "$JOB_STATUS" != "done" ]]; then
  echo "worker log (tail):"
  tail -60 /tmp/inwit-t23-worker.log || true
fi
check "weekly_report job done" "$([[ "$JOB_STATUS" == "done" ]] && echo 1 || echo 0)"

echo "-- document list includes 学习复盘"
LIST=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/documents?limit=20")
LIST_EVAL=$(printf '%s' "$LIST" | node -e '
  const page=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const items=page.items||[];
  const recap=items.find((d)=>d.source==="agent" && String(d.title||"").includes("学习复盘"));
  process.stdout.write(JSON.stringify({
    n: items.filter((d)=>d.source==="agent" && String(d.title||"").includes("学习复盘")).length,
    id: recap?.id ?? null,
    title: recap?.title ?? null,
    source: recap?.source ?? null,
  }));
')
echo "list=$LIST_EVAL"
RECAP_ID=$(printf '%s' "$LIST_EVAL" | json_field id || true)
RECAP_TITLE=$(printf '%s' "$LIST_EVAL" | json_field title || true)
check "document list has 学习复盘" "$([[ "$(printf '%s' "$LIST_EVAL" | json_field n)" -ge 1 && -n "$RECAP_ID" ]] && echo 1 || echo 0)"
check "title looks like M/D–M/D 学习复盘" "$([[ "$RECAP_TITLE" == *学习复盘 ]] && echo 1 || echo 0)"

echo "-- recap document body"
RECAP=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/documents/${RECAP_ID}")
BODY_EVAL=$(printf '%s' "$RECAP" | CARD_A="$CARD_A" CARD_B="$CARD_B" CARD_C="$CARD_C" node -e '
  const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const md=d.contentMd||"";
  const ids=[process.env.CARD_A, process.env.CARD_B, process.env.CARD_C].filter(Boolean);
  const linked=ids.filter((id)=>md.includes("/cards/"+id)).length;
  process.stdout.write(JSON.stringify({
    source: d.source,
    remembered: /想起来了/.test(md)?1:0,
    fuzzy: /模糊/.test(md)?1:0,
    forgot: /忘了/.test(md)?1:0,
    linked,
    hasCardsPath: md.includes("/cards/")?1:0,
  }));
')
echo "body=$BODY_EVAL"
check "document source=agent" "$([[ "$(printf '%s' "$BODY_EVAL" | json_field source)" == "\"agent\"" || "$(printf '%s' "$BODY_EVAL" | json_field source)" == "agent" ]] && echo 1 || echo 0)"
check "body has 三档分布" "$([[ "$(printf '%s' "$BODY_EVAL" | json_field remembered)" == "1" && "$(printf '%s' "$BODY_EVAL" | json_field fuzzy)" == "1" && "$(printf '%s' "$BODY_EVAL" | json_field forgot)" == "1" ]] && echo 1 || echo 0)"
# 周报正文仍写 [概念](/cards/:id)；前端 /cards/:id 已重定向到 /review。
check "body has /cards/ links" "$([[ "$(printf '%s' "$BODY_EVAL" | json_field hasCardsPath)" == "1" ]] && echo 1 || echo 0)"
check "body links at least 3 recap cards" "$([[ "$(printf '%s' "$BODY_EVAL" | json_field linked)" -ge 3 ]] && echo 1 || echo 0)"

echo "-- GET /api/reports/latest"
LATEST=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/reports/latest")
LATEST_DOC=$(printf '%s' "$LATEST" | json_field report.documentId || true)
LATEST_RATE=$(printf '%s' "$LATEST" | json_field report.successRate || true)
LATEST_N=$(printf '%s' "$LATEST" | json_field report.relearnCount || true)
echo "latest doc=$LATEST_DOC rate=$LATEST_RATE relearn=$LATEST_N"
check "latest report points at recap document" "$([[ "$LATEST_DOC" == "$RECAP_ID" ]] && echo 1 || echo 0)"
check "latest report has successRate and relearnCount" "$([[ -n "$LATEST_RATE" && "${LATEST_N:-0}" -ge 1 ]] && echo 1 || echo 0)"

echo "-- psql memory + execution"
PSQL_EVAL=$(cd "$SERVER_DIR" && USER_ID="$USER_ID" JOB_ID="$JOB_ID" WEEK_START="$WEEK_START" node --input-type=module -e '
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pg = require("pg");
const pool = new pg.Pool({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT ?? 5432),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  ssl: process.env.PG_SSL === "true" ? { rejectUnauthorized: false } : false,
});
const key = "weekly_report:" + process.env.WEEK_START;
const mem = await pool.query(
  `SELECT key, layer, content FROM memories WHERE user_id=$1 AND layer=$2 AND key=$3`,
  [process.env.USER_ID, "mastery", key],
);
const exe = await pool.query(
  `SELECT status, steps, result_summary, error FROM agent_executions WHERE user_id=$1 AND job_id=$2`,
  [process.env.USER_ID, process.env.JOB_ID],
);
const steps = Array.isArray(exe.rows[0]?.steps) ? exe.rows[0].steps.map((s)=>s.tool) : [];
process.stdout.write(JSON.stringify({
  memN: mem.rows.length,
  hasDoc: typeof mem.rows[0]?.content?.documentId === "string" ? 1 : 0,
  hasSummary: typeof mem.rows[0]?.content?.summary === "string" ? 1 : 0,
  exeStatus: exe.rows[0]?.status ?? null,
  steps,
  summary: exe.rows[0]?.result_summary ?? null,
  error: exe.rows[0]?.error ?? null,
}));
await pool.end();
')
echo "db=$PSQL_EVAL"
check "memory weekly_report:<weekStart>" "$([[ "$(printf '%s' "$PSQL_EVAL" | json_field memN)" == "1" && "$(printf '%s' "$PSQL_EVAL" | json_field hasDoc)" == "1" && "$(printf '%s' "$PSQL_EVAL" | json_field hasSummary)" == "1" ]] && echo 1 || echo 0)"
check "agent_executions done with read_week_stats" "$([[ "$(printf '%s' "$PSQL_EVAL" | json_field exeStatus)" == "done" && "$(printf '%s' "$PSQL_EVAL" | json_field steps)" == *read_week_stats* ]] && echo 1 || echo 0)"

echo "-- delete this week jobs and restart worker (auto scan)"
DELETED=$(delete_weekly_jobs "$USER_ID")
echo "deleted weekly_report jobs=$DELETED"
check "deleted at least one weekly_report job" "$([[ "${DELETED:-0}" -ge 1 ]] && echo 1 || echo 0)"

start_worker

RESCAN_OK=0
RESCAN_JOB=""
for _ in $(seq 1 40); do
  PAGE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs?type=weekly_report&limit=10")
  RESCAN_JOB=$(printf '%s' "$PAGE" | node -e '
    const page=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const items=page.items||[];
    const hit=items.find((j)=>j.type==="weekly_report");
    process.stdout.write(hit?.id || "");
  ' || true)
  if [[ -n "$RESCAN_JOB" ]]; then
    RESCAN_OK=1
    break
  fi
  sleep 0.5
done
echo "rescanned job=$RESCAN_JOB"
check "worker restart re-enqueues weekly_report" "$([[ "$RESCAN_OK" == "1" ]] && echo 1 || echo 0)"

echo
echo "T23 smoke $PASS passed, $FAIL failed (user $EMAIL)"
if [[ "$FAIL" -gt 0 ]]; then
  echo "worker log (tail):"
  tail -40 /tmp/inwit-t23-worker.log || true
  exit 1
fi
