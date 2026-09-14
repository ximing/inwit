#!/usr/bin/env bash
# T21 smoke: digest → fuzzy evolve (new question type) + two forgots (split cards).
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

PORT="${SMOKE_PORT:-3030}"
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

echo "== T21 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t21-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t21-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

echo "starting worker..."
(cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t21-worker.log 2>&1 &
STARTED_WORKER_PID=$!
sleep 0.8
if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
  echo "worker exited immediately:"
  tail -80 /tmp/inwit-t21-worker.log || true
  exit 1
fi

STAMP="$(date +%s)"
EMAIL="t21-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t21-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

CONTENT='梯度消失是深度神经网络训练中的一个经典问题。反向传播时，误差信号需要从输出层一层层传到更浅的层；若激活函数的导数小于 1（例如 sigmoid 的导数最大只有 0.25），多层连乘会让靠近输入的层拿到的梯度接近 0，于是那些层几乎不再更新，网络也就学不动。这在很深的、使用 sigmoid 或 tanh 的网络里尤其明显。常见缓解办法包括：改用 ReLU 一类导数在正半轴恒为 1 的激活函数、做批归一化稳住激活尺度、用残差连接给梯度一条近道，以及更谨慎的权重初始化。

需要和梯度爆炸区分开：爆炸是连乘大于 1 导致梯度过大、训练发散；消失则是梯度过小、训练停滞。两者都来自深层连乘，只是方向相反。'

echo "-- POST /api/documents (digest)"
DOC=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
  -H 'content-type: application/json' \
  -d "$(node -e 'const c=process.argv[1]; process.stdout.write(JSON.stringify({title:"梯度消失与爆炸", contentMd:c, source:"paste"}))' "$CONTENT")")
DOC_ID=$(printf '%s' "$DOC" | json_field id || true)
check "create document" "$([[ -n "$DOC_ID" ]] && echo 1 || echo 0)"

echo "-- wait digest"
DETAIL=$(poll_doc "$DOC_ID")
DOC_STATUS=$(printf '%s' "$DETAIL" | json_field status || true)
echo "document status=$DOC_STATUS"
check "document digested" "$([[ "$DOC_STATUS" == "digested" ]] && echo 1 || echo 0)"

CARD_META=$(printf '%s' "$DETAIL" | node -e '
  const d=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const cards=d.cards||[];
  const a=cards[0], b=cards[1]||cards[0];
  const types=(card)=>[...new Set((card.questions||[]).map((q)=>q.type))];
  process.stdout.write(JSON.stringify({
    n: cards.length,
    a: a?{id:a.id, nq:(a.questions||[]).length, types:types(a), concept:a.concept}:null,
    b: b?{id:b.id, nq:(b.questions||[]).length, types:types(b), concept:b.concept}:null,
  }));
')
echo "cards=$CARD_META"
CARD_N=$(printf '%s' "$CARD_META" | json_field n || true)
CARD_A=$(printf '%s' "$CARD_META" | json_field a.id || true)
CARD_B=$(printf '%s' "$CARD_META" | json_field b.id || true)
A_NQ=$(printf '%s' "$CARD_META" | json_field a.nq || true)
check "digest produced 2+ cards" "$([[ "${CARD_N:-0}" -ge 2 && -n "$CARD_A" && -n "$CARD_B" && "$CARD_A" != "$CARD_B" ]] && echo 1 || echo 0)"

echo "-- POST feedback=fuzzy on card A"
FB_A=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/review/${CARD_A}/feedback" \
  -H 'content-type: application/json' \
  -d '{"feedback":"fuzzy"}')
EVOLVE_A=$(printf '%s' "$FB_A" | json_field evolveJobId || true)
echo "fuzzy evolveJobId=$EVOLVE_A"
check "fuzzy enqueues evolve" "$([[ -n "$EVOLVE_A" && "$EVOLVE_A" != "null" ]] && echo 1 || echo 0)"

echo "-- wait fuzzy evolve"
JOB_A=$(poll_job "$EVOLVE_A")
JOB_A_STATUS=$(printf '%s' "$JOB_A" | json_field status || true)
JOB_A_REASON=$(printf '%s' "$JOB_A" | json_field payload.reason || true)
echo "fuzzy job status=$JOB_A_STATUS reason=$JOB_A_REASON error=$(printf '%s' "$JOB_A" | json_field lastError || true)"
check "fuzzy evolve job done" "$([[ "$JOB_A_STATUS" == "done" ]] && echo 1 || echo 0)"
check "fuzzy payload reason=fuzzy" "$([[ "$JOB_A_REASON" == "fuzzy" ]] && echo 1 || echo 0)"

CARD_A_AFTER=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/cards/${CARD_A}")
A_AFTER=$(A_NQ="$A_NQ" CARD_META="$CARD_META" node -e '
  const card=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const before=JSON.parse(process.env.CARD_META);
  const beforeTypes=new Set(before.a.types||[]);
  const qs=card.questions||[];
  const types=[...new Set(qs.map((q)=>q.type))];
  const added=qs.length - Number(process.env.A_NQ||0);
  const newAngle=types.some((t)=>!beforeTypes.has(t)) || (beforeTypes.size>=3 && added>0);
  process.stdout.write(JSON.stringify({nq:qs.length, added, types, newAngle:newAngle?1:0, stillThere:card.id?1:0}));
' <<<"$CARD_A_AFTER")
echo "card A after=$A_AFTER"
check "original card A still exists" "$([[ "$(printf '%s' "$A_AFTER" | json_field stillThere)" == "1" ]] && echo 1 || echo 0)"
check "fuzzy added a different-type question" "$([[ "$(printf '%s' "$A_AFTER" | json_field added)" -ge 1 && "$(printf '%s' "$A_AFTER" | json_field newAngle)" == "1" ]] && echo 1 || echo 0)"

echo "-- POST forgot x2 on card B"
FB_B1=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/review/${CARD_B}/feedback" \
  -H 'content-type: application/json' \
  -d '{"feedback":"forgot"}')
EVOLVE_B1=$(printf '%s' "$FB_B1" | json_field evolveJobId || true)
check "first forgot does not enqueue evolve" "$([[ -z "$EVOLVE_B1" || "$EVOLVE_B1" == "null" ]] && echo 1 || echo 0)"

FB_B2=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/review/${CARD_B}/feedback" \
  -H 'content-type: application/json' \
  -d '{"feedback":"forgot"}')
EVOLVE_B=$(printf '%s' "$FB_B2" | json_field evolveJobId || true)
LAPSES=$(printf '%s' "$FB_B2" | json_field reviewState.lapses || true)
echo "second forgot evolveJobId=$EVOLVE_B lapses=$LAPSES"
check "second forgot enqueues evolve" "$([[ -n "$EVOLVE_B" && "$EVOLVE_B" != "null" && "${LAPSES:-0}" -ge 2 ]] && echo 1 || echo 0)"

echo "-- wait split evolve"
JOB_B=$(poll_job "$EVOLVE_B")
JOB_B_STATUS=$(printf '%s' "$JOB_B" | json_field status || true)
JOB_B_REASON=$(printf '%s' "$JOB_B" | json_field payload.reason || true)
echo "split job status=$JOB_B_STATUS reason=$JOB_B_REASON error=$(printf '%s' "$JOB_B" | json_field lastError || true)"
check "split evolve job done" "$([[ "$JOB_B_STATUS" == "done" ]] && echo 1 || echo 0)"
check "split payload reason=repeated_forgot" "$([[ "$JOB_B_REASON" == "repeated_forgot" ]] && echo 1 || echo 0)"

CARD_B_AFTER=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/cards/${CARD_B}")
check "original card B still exists" "$([[ "$(printf '%s' "$CARD_B_AFTER" | json_field id)" == "$CARD_B" ]] && echo 1 || echo 0)"

LINKS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/cards/${CARD_B}/links")
SPLIT_EVAL=$(NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')" CARD_B="$CARD_B" BASE_URL="$BASE_URL" COOKIE_JAR="$COOKIE_JAR" node -e '
  const links=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const parent=process.env.CARD_B;
  const all=[...(links.outgoing||[]), ...(links.incoming||[])];
  const splits=all.filter((l)=>l.type==="related" && l.origin==="agent" && (l.reason||"").includes("由原卡拆小"));
  const childIds=[...new Set(splits.map((l)=>l.fromCardId===parent?l.toCardId:l.fromCardId).filter((id)=>id!==parent))];
  process.stdout.write(JSON.stringify({n:childIds.length, ids:childIds, reasons:splits.map((l)=>l.reason)}));
' <<<"$LINKS")
echo "split links=$SPLIT_EVAL"
CHILD_N=$(printf '%s' "$SPLIT_EVAL" | json_field n || true)
check "1-2 split children linked" "$([[ "${CHILD_N:-0}" -ge 1 && "${CHILD_N:-0}" -le 2 ]] && echo 1 || echo 0)"

CHILD_OK=$(printf '%s' "$SPLIT_EVAL" | COOKIE_JAR="$COOKIE_JAR" BASE_URL="$BASE_URL" NOW_MS="$(node -e 'process.stdout.write(String(Date.now()))')" node -e '
  const {ids}=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const jar=process.env.COOKIE_JAR;
  const base=process.env.BASE_URL;
  const now=Number(process.env.NOW_MS);
  const {execFileSync}=require("child_process");
  let ok=1;
  const details=[];
  for (const id of ids) {
    const raw=execFileSync("curl", ["-sS","-c",jar,"-b",jar, `${base}/api/cards/${id}`], {encoding:"utf8"});
    const card=JSON.parse(raw);
    const nq=(card.questions||[]).length;
    const due=card.review && Date.parse(card.review.dueAt);
    const future=Number.isFinite(due) && due>now;
    if (nq<1 || !future) ok=0;
    details.push({id, nq, dueAt:card.review&&card.review.dueAt, source:card.source, documentId:card.documentId});
  }
  process.stdout.write(JSON.stringify({ok, details}));
')
echo "children=$CHILD_OK"
check "children have questions and due in the future" "$([[ "$(printf '%s' "$CHILD_OK" | json_field ok)" == "1" ]] && echo 1 || echo 0)"

echo "-- psql memories + executions"
PSQL_EVAL=$(cd "$SERVER_DIR" && USER_ID="$USER_ID" CARD_A="$CARD_A" CARD_B="$CARD_B" JOB_A="$EVOLVE_A" JOB_B="$EVOLVE_B" node --input-type=module -e '
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
const mem = await pool.query(
  `SELECT key, layer, content FROM memories WHERE user_id=$1 AND layer=$2 ORDER BY key`,
  [process.env.USER_ID, "mastery"],
);
const exe = await pool.query(
  `SELECT job_id, agent_type, status, steps, result_summary, error FROM agent_executions WHERE user_id=$1 AND agent_type=$2 ORDER BY started_at`,
  [process.env.USER_ID, "evolve"],
);
const usage = await pool.query(
  `SELECT count(*)::int AS n FROM llm_usage_logs WHERE user_id=$1 AND execution_id = ANY(SELECT id FROM agent_executions WHERE user_id=$1 AND agent_type=$2)`,
  [process.env.USER_ID, "evolve"],
);
const keys = mem.rows.map((r)=>r.key);
const hasRecent = mem.rows.some((r)=>Array.isArray(r.content && r.content.recent) && r.content.recent.length>0);
const stepsOk = exe.rows.filter((r)=>r.job_id===process.env.JOB_A || r.job_id===process.env.JOB_B).every((r)=>Array.isArray(r.steps) && r.steps.length>0);
process.stdout.write(JSON.stringify({
  memN: mem.rows.length,
  keys,
  hasRecent: hasRecent?1:0,
  exeN: exe.rows.length,
  exeStatus: exe.rows.map((r)=>r.status),
  stepsOk: stepsOk?1:0,
  usageN: usage.rows[0]?.n ?? 0,
  summaries: exe.rows.map((r)=>r.result_summary),
}));
await pool.end();
')
echo "db=$PSQL_EVAL"
check "memories has layer=mastery" "$([[ "$(printf '%s' "$PSQL_EVAL" | json_field memN)" -ge 2 && "$(printf '%s' "$PSQL_EVAL" | json_field hasRecent)" == "1" ]] && echo 1 || echo 0)"
check "agent_executions have steps" "$([[ "$(printf '%s' "$PSQL_EVAL" | json_field exeN)" -ge 2 && "$(printf '%s' "$PSQL_EVAL" | json_field stepsOk)" == "1" ]] && echo 1 || echo 0)"
check "llm_usage_logs recorded" "$([[ "$(printf '%s' "$PSQL_EVAL" | json_field usageN)" -ge 1 ]] && echo 1 || echo 0)"

echo
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "worker tail:"
  tail -60 /tmp/inwit-t21-worker.log || true
  exit 1
fi
