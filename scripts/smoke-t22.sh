#!/usr/bin/env bash
# T22 smoke: two confusable cards × forgot×2 → analyze_patterns → contrast doc + cards.
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

PORT="${SMOKE_PORT:-3031}"
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

echo "== T22 smoke @ $BASE_URL =="

echo "stopping leftover inwit workers (same DB queue)..."
pkill -f '/project/mygithub/inwit/apps/server/.*worker.ts' 2>/dev/null || true
if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    kill_tree "$pid"
  done
fi
sleep 0.5

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t22-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t22-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

echo "starting worker..."
(cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t22-worker.log 2>&1 &
STARTED_WORKER_PID=$!
sleep 0.8
if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
  echo "worker exited immediately:"
  tail -80 /tmp/inwit-t22-worker.log || true
  exit 1
fi

STAMP="$(date +%s)"
EMAIL="t22-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t22-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

CONTENT='偏差（bias）衡量模型预测的期望值和真实值差多远：高偏差通常来自模型太简单，欠拟合，训练集和测试集都差。方差（variance）衡量换一批训练数据时预测会抖多厉害：高方差通常来自模型太复杂，过拟合，训练集很好但换数据就崩。两者此消彼长，这就是偏差-方差权衡。不能靠把偏差降到零来同时消灭方差，也不能把模型做得无限灵活却指望它在新数据上稳定。实践里要同时看训练误差和泛化误差：两边都高偏偏差，训练很低测试很高偏方差。'

echo "-- POST /api/documents (digest 偏差/方差)"
DOC=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
  -H 'content-type: application/json' \
  -d "$(node -e 'const c=process.argv[1]; process.stdout.write(JSON.stringify({title:"偏差与方差", contentMd:c, source:"paste"}))' "$CONTENT")")
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
  const bias=cards.find((c)=>/偏差|bias/i.test(c.concept||"")) || cards[0];
  const variance=cards.find((c)=>bias && c.id!==bias.id && /方差|variance/i.test(c.concept||""))
    || cards.find((c)=>bias && c.id!==bias.id)
    || cards[1];
  process.stdout.write(JSON.stringify({
    n: cards.length,
    a: bias?{id:bias.id, concept:bias.concept}:null,
    b: variance?{id:variance.id, concept:variance.concept}:null,
  }));
')
echo "cards=$CARD_META"
CARD_N=$(printf '%s' "$CARD_META" | json_field n || true)
CARD_A=$(printf '%s' "$CARD_META" | json_field a.id || true)
CARD_B=$(printf '%s' "$CARD_META" | json_field b.id || true)
check "digest produced 2+ cards" "$([[ "${CARD_N:-0}" -ge 2 && -n "$CARD_A" && -n "$CARD_B" && "$CARD_A" != "$CARD_B" ]] && echo 1 || echo 0)"

feedback() {
  local id="$1"
  curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/review/${id}/feedback" \
    -H 'content-type: application/json' \
    -d '{"feedback":"forgot"}'
}

echo "-- forgot ×2 on each card"
FB_A1=$(feedback "$CARD_A")
A1_ANALYZE=$(printf '%s' "$FB_A1" | json_field analyzeJobId || true)
A1_EVOLVE=$(printf '%s' "$FB_A1" | json_field evolveJobId || true)
check "1st forgot does not enqueue analyze" "$([[ -z "$A1_ANALYZE" || "$A1_ANALYZE" == "null" ]] && echo 1 || echo 0)"
check "1st forgot does not enqueue per-card evolve" "$([[ -z "$A1_EVOLVE" || "$A1_EVOLVE" == "null" ]] && echo 1 || echo 0)"

FB_B1=$(feedback "$CARD_B")
B1_ANALYZE=$(printf '%s' "$FB_B1" | json_field analyzeJobId || true)
check "2nd forgot does not enqueue analyze" "$([[ -z "$B1_ANALYZE" || "$B1_ANALYZE" == "null" ]] && echo 1 || echo 0)"

FB_A2=$(feedback "$CARD_A")
A2_ANALYZE=$(printf '%s' "$FB_A2" | json_field analyzeJobId || true)
A2_EVOLVE=$(printf '%s' "$FB_A2" | json_field evolveJobId || true)
echo "3rd forgot analyzeJobId=$A2_ANALYZE evolveJobId=$A2_EVOLVE"
check "3rd forgot (only 1 struggling card) does not enqueue analyze" "$([[ -z "$A2_ANALYZE" || "$A2_ANALYZE" == "null" ]] && echo 1 || echo 0)"

FB_B2=$(feedback "$CARD_B")
ANALYZE_JOB=$(printf '%s' "$FB_B2" | json_field analyzeJobId || true)
echo "4th forgot analyzeJobId=$ANALYZE_JOB"
check "4th forgot (2 struggling cards) auto-enqueues analyze" "$([[ -n "$ANALYZE_JOB" && "$ANALYZE_JOB" != "null" ]] && echo 1 || echo 0)"

if [[ -z "$ANALYZE_JOB" || "$ANALYZE_JOB" == "null" ]]; then
  echo "auto enqueue missed; POST /api/evolve/analyze"
  MANUAL=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/evolve/analyze")
  ANALYZE_JOB=$(printf '%s' "$MANUAL" | json_field id || true)
fi

echo "-- wait analyze job $ANALYZE_JOB"
JOB_A=$(poll_job "$ANALYZE_JOB")
JOB_A_STATUS=$(printf '%s' "$JOB_A" | json_field status || true)
JOB_A_ACTION=$(printf '%s' "$JOB_A" | json_field payload.action || true)
JOB_A_DATE=$(printf '%s' "$JOB_A" | json_field payload.date || true)
echo "analyze job status=$JOB_A_STATUS action=$JOB_A_ACTION date=$JOB_A_DATE error=$(printf '%s' "$JOB_A" | json_field lastError || true)"
check "analyze job done" "$([[ "$JOB_A_STATUS" == "done" ]] && echo 1 || echo 0)"
check "payload action=analyze_patterns" "$([[ "$JOB_A_ACTION" == "analyze_patterns" ]] && echo 1 || echo 0)"
check "payload has YYYY-MM-DD date" "$([[ "$JOB_A_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && echo 1 || echo 0)"

echo "-- psql confusable / memory / agent document"
PSQL_EVAL=$(cd "$SERVER_DIR" && USER_ID="$USER_ID" CARD_A="$CARD_A" CARD_B="$CARD_B" JOB_A="$ANALYZE_JOB" node --input-type=module -e '
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
const links = await pool.query(
  `SELECT id, from_card_id, to_card_id, type, origin, reason
   FROM card_links
   WHERE user_id=$1 AND type=$2`,
  [process.env.USER_ID, "confusable"],
);
const mem = await pool.query(
  `SELECT key, layer, content FROM memories
   WHERE user_id=$1 AND layer=$2 AND key LIKE $3`,
  [process.env.USER_ID, "mastery", "confusable:%"],
);
const docs = await pool.query(
  `SELECT id, title, source, status, topic_id FROM documents
   WHERE user_id=$1 AND source=$2 ORDER BY created_at`,
  [process.env.USER_ID, "agent"],
);
const agentDocIds = docs.rows.map((r)=>r.id);
const cards = agentDocIds.length === 0 ? { rows: [] } : await pool.query(
  `SELECT id, document_id, source, concept FROM cards
   WHERE user_id=$1 AND document_id = ANY($2::uuid[])`,
  [process.env.USER_ID, agentDocIds],
);
const cardIds = cards.rows.map((r)=>r.id);
const questions = cardIds.length === 0 ? { rows: [] } : await pool.query(
  `SELECT card_id, type FROM card_questions WHERE card_id = ANY($1::uuid[])`,
  [cardIds],
);
const states = cardIds.length === 0 ? { rows: [] } : await pool.query(
  `SELECT card_id, due_at FROM review_states WHERE user_id=$1 AND card_id = ANY($2::uuid[])`,
  [process.env.USER_ID, cardIds],
);
const exe = await pool.query(
  `SELECT job_id, status, steps, result_summary, error FROM agent_executions
   WHERE user_id=$1 AND job_id=$2`,
  [process.env.USER_ID, process.env.JOB_A],
);
const a = process.env.CARD_A;
const b = process.env.CARD_B;
const pairLinked = links.rows.some((r)=>
  (r.from_card_id===a && r.to_card_id===b) || (r.from_card_id===b && r.to_card_id===a)
);
const qByCard = new Map();
for (const q of questions.rows) {
  const list = qByCard.get(q.card_id) ?? [];
  list.push(q.type);
  qByCard.set(q.card_id, list);
}
const cardsOk = cards.rows.length>=2 && cards.rows.length<=3
  && cards.rows.every((c)=>c.source==="agent")
  && cards.rows.every((c)=>(qByCard.get(c.id)||[]).some((t)=>t==="compare"||t==="judge"))
  && states.rows.length===cards.rows.length;
const steps = Array.isArray(exe.rows[0]?.steps) ? exe.rows[0].steps.map((s)=>s.tool) : [];
process.stdout.write(JSON.stringify({
  confusableN: links.rows.length,
  pairLinked: pairLinked?1:0,
  memN: mem.rows.length,
  memKeys: mem.rows.map((r)=>r.key),
  hasDocInMemory: mem.rows.some((r)=>typeof r.content?.documentId==="string")?1:0,
  agentDocN: docs.rows.length,
  agentTitle: docs.rows[0]?.title ?? null,
  agentStatus: docs.rows[0]?.status ?? null,
  contrastCards: cards.rows.length,
  cardsOk: cardsOk?1:0,
  contrastCardIds: cardIds,
  exeStatus: exe.rows[0]?.status ?? null,
  steps,
  summary: exe.rows[0]?.result_summary ?? null,
  error: exe.rows[0]?.error ?? null,
}));
await pool.end();
')
echo "db=$PSQL_EVAL"
check "confusable edge exists for the pair" "$([[ "$(printf '%s' "$PSQL_EVAL" | json_field pairLinked)" == "1" ]] && echo 1 || echo 0)"
check "memory key confusable:<a>+<b>" "$([[ "$(printf '%s' "$PSQL_EVAL" | json_field memN)" -ge 1 && "$(printf '%s' "$PSQL_EVAL" | json_field hasDocInMemory)" == "1" ]] && echo 1 || echo 0)"
check "one source=agent contrast document" "$([[ "$(printf '%s' "$PSQL_EVAL" | json_field agentDocN)" == "1" ]] && echo 1 || echo 0)"
check "contrast cards 2-3 with compare/judge and review_states" "$([[ "$(printf '%s' "$PSQL_EVAL" | json_field cardsOk)" == "1" ]] && echo 1 || echo 0)"
check "agent_executions done with steps" "$([[ "$(printf '%s' "$PSQL_EVAL" | json_field exeStatus)" == "done" ]] && echo 1 || echo 0)"

AGENT_TITLE=$(printf '%s' "$PSQL_EVAL" | json_field agentTitle || true)
check "title starts with 对比专题" "$([[ "$AGENT_TITLE" == 对比专题* ]] && echo 1 || echo 0)"

echo "-- document list includes agent doc"
LIST=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/documents?limit=20")
LIST_EVAL=$(printf '%s' "$LIST" | node -e '
  const page=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const items=page.items||[];
  const agent=items.filter((d)=>d.source==="agent");
  process.stdout.write(JSON.stringify({n:agent.length, title:agent[0]&&agent[0].title, status:agent[0]&&agent[0].status, cardCount:agent[0]&&agent[0].cardCount}));
')
echo "list=$LIST_EVAL"
check "agent doc appears in document list" "$([[ "$(printf '%s' "$LIST_EVAL" | json_field n)" -ge 1 ]] && echo 1 || echo 0)"

echo "-- contrast cards in today review queue"
TODAY=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/review/today")
TODAY_EVAL=$(printf '%s' "$PSQL_EVAL" | TODAY="$TODAY" node -e '
  const db=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const today=JSON.parse(process.env.TODAY);
  const ids=new Set(db.contrastCardIds||[]);
  const hit=(today.items||[]).filter((it)=>ids.has(it.card && it.card.id));
  process.stdout.write(JSON.stringify({queueN:hit.length, want:ids.size}));
')
echo "today=$TODAY_EVAL"
check "contrast cards are in today review queue" "$([[ "$(printf '%s' "$TODAY_EVAL" | json_field queueN)" -ge 1 ]] && echo 1 || echo 0)"

echo "-- re-analyze within 30 days does not duplicate the document"
SECOND=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/evolve/analyze")
SECOND_ID=$(printf '%s' "$SECOND" | json_field id || true)
echo "second job id=$SECOND_ID"
if [[ -n "$SECOND_ID" && "$SECOND_ID" != "$ANALYZE_JOB" ]]; then
  JOB_B=$(poll_job "$SECOND_ID")
  JOB_B_STATUS=$(printf '%s' "$JOB_B" | json_field status || true)
  echo "second analyze status=$JOB_B_STATUS error=$(printf '%s' "$JOB_B" | json_field lastError || true)"
  check "second analyze job finished" "$([[ "$JOB_B_STATUS" == "done" ]] && echo 1 || echo 0)"
else
  echo "manual returned the same job id (unexpected after first done)"
  check "second analyze job finished" 0
fi

PSQL2=$(cd "$SERVER_DIR" && USER_ID="$USER_ID" node --input-type=module -e '
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
const docs = await pool.query(
  `SELECT count(*)::int AS n FROM documents WHERE user_id=$1 AND source=$2`,
  [process.env.USER_ID, "agent"],
);
process.stdout.write(JSON.stringify({ agentDocN: docs.rows[0]?.n ?? 0 }));
await pool.end();
')
echo "db2=$PSQL2"
check "still only one source=agent document" "$([[ "$(printf '%s' "$PSQL2" | json_field agentDocN)" == "1" ]] && echo 1 || echo 0)"

echo
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "worker tail:"
  tail -80 /tmp/inwit-t22-worker.log || true
  echo "server tail:"
  tail -40 /tmp/inwit-t22-server.log || true
  exit 1
fi
