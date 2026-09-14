#!/usr/bin/env bash
# T18 smoke: digest hangs cards on the topic map, organize keeps every card, fill seeds review.
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

PORT="${SMOKE_PORT:-3028}"
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
  for _ in $(seq 1 90); do
    row=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs?type=topic&limit=20")
    status=$(JOB_ID="$id" node -e '
      const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
      const id=process.env.JOB_ID;
      const hit=(j.items||[]).find((it)=>it.id===id);
      process.stdout.write(hit?hit.status:"");
    ' <<<"$row")
    if [[ "$status" == "done" || "$status" == "failed" ]]; then
      printf '%s' "$status"
      return 0
    fi
    sleep 2
  done
  printf '%s' "${status:-timeout}"
}

echo "== T18 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t18-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t18-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

echo "starting worker..."
(cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t18-worker.log 2>&1 &
STARTED_WORKER_PID=$!
sleep 0.8
if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
  echo "worker exited immediately:"
  tail -80 /tmp/inwit-t18-worker.log || true
  exit 1
fi

STAMP="$(date +%s)"
EMAIL="t18-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t18-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

echo "-- POST /api/topics"
TOPIC=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics" \
  -H 'content-type: application/json' \
  -d '{"title":"T18 深度学习基础","goal":"掌握梯度问题与正则化，能自己画出这门课的概念大纲"}')
TOPIC_ID=$(printf '%s' "$TOPIC" | json_field id || true)
check "create topic" "$([[ -n "$TOPIC_ID" ]] && echo 1 || echo 0)"

DOC_BODY=$(TOPIC_ID="$TOPIC_ID" node -e '
const topicId=process.env.TOPIC_ID;
const contentMd = [
  "# 梯度消失、梯度爆炸和正则化",
  "",
  "深层神经网络用反向传播更新参数。梯度从输出层往输入层传时，如果每一层的导数都小于 1，连乘之后靠近输入的层梯度会接近 0，这就是梯度消失。表现是浅层权重几乎不更新，网络学不动。",
  "",
  "反过来，如果每一层导数经常大于 1，连乘会让梯度指数级变大，参数更新一步就飞出去，这就是梯度爆炸。训练 loss 突然变成 NaN，往往就是爆炸。",
  "",
  "常见缓解手段：换激活函数（ReLU 在正区间导数为 1，比 sigmoid 更不容易消失）、合理初始化、Batch Normalization、残差连接。残差把恒等映射加回去，梯度有一条不衰减的捷径。",
  "",
  "正则化是另一条线。L2 正则给损失函数加上权重平方和，倾向把参数往 0 拉但不拉成精确的 0，也叫权重衰减。L1 正则加的是绝对值，容易把部分权重变成精确的 0，得到稀疏模型。",
  "",
  "不要把 L1/L2 和梯度消失混在一起：前者约束模型复杂度，后者是深层反向传播的数值问题。它们会同时出现在同一门课里，但机制不同。",
].join("\n");
process.stdout.write(JSON.stringify({
  title: "梯度消失与正则化",
  contentMd,
  topicId,
  source: "editor",
}));
')

echo "-- POST /api/documents (digest in topic)"
DOC=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
  -H 'content-type: application/json' \
  -d "$DOC_BODY")
DOC_ID=$(printf '%s' "$DOC" | json_field id || true)
check "create document" "$([[ -n "$DOC_ID" ]] && echo 1 || echo 0)"

echo "-- poll digest"
DETAIL=$(poll_doc "$DOC_ID")
DOC_STATUS=$(printf '%s' "$DETAIL" | json_field status || true)
echo "document status=$DOC_STATUS"
check "document digested" "$([[ "$DOC_STATUS" == "digested" ]] && echo 1 || echo 0)"

DIGEST_EVAL=$(printf '%s' "$DETAIL" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const cards=Array.isArray(j.cards)?j.cards:[];
  const hung=cards.filter((c)=>c.mapNodeId);
  process.stdout.write(JSON.stringify({
    cardCount: cards.length,
    hung: hung.length,
    ids: cards.map((c)=>c.id),
  }));
')
echo "digest cards=$DIGEST_EVAL"
DIGEST_CARDS=$(printf '%s' "$DIGEST_EVAL" | json_field cardCount || true)
DIGEST_HUNG=$(printf '%s' "$DIGEST_EVAL" | json_field hung || true)
check "digest produced >=2 cards" "$([[ "${DIGEST_CARDS:-0}" -ge 2 ]] && echo 1 || echo 0)"
check "digest hung at least 1 card on the map" "$([[ "${DIGEST_HUNG:-0}" -ge 1 ]] && echo 1 || echo 0)"

MAP1=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map")
MAP1_EVAL=$(printf '%s' "$MAP1" | node -e '
  const t=JSON.parse(require("fs").readFileSync(0,"utf8"));
  function walk(nodes, acc) {
    for (const n of nodes||[]) {
      acc.nodes += 1;
      acc.cards += n.cardCount||0;
      acc.titles.push(n.title);
      if ((n.cardCount||0)===0) acc.blank += 1;
      walk(n.children||[], acc);
    }
    return acc;
  }
  const acc=walk(t.nodes||[], {nodes:0, cards:0, blank:0, titles:[]});
  process.stdout.write(JSON.stringify(acc));
')
echo "map after digest=$MAP1_EVAL"
MAP1_NODES=$(printf '%s' "$MAP1_EVAL" | json_field nodes || true)
MAP1_CARDS=$(printf '%s' "$MAP1_EVAL" | json_field cards || true)
check "map has nodes after digest" "$([[ "${MAP1_NODES:-0}" -ge 1 ]] && echo 1 || echo 0)"
check "map cardCount matches hung cards" "$([[ "${MAP1_CARDS:-0}" -ge "${DIGEST_HUNG:-0}" ]] && echo 1 || echo 0)"

BEFORE_CARDS="$MAP1_CARDS"

echo "-- POST /api/topics/:id/map/organize"
ORG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics/${TOPIC_ID}/map/organize")
ORG_ID=$(printf '%s' "$ORG" | json_field id || true)
ORG_TYPE=$(printf '%s' "$ORG" | json_field type || true)
ORG_ACTION=$(printf '%s' "$ORG" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String(j.payload&&j.payload.action||""));')
check "organize enqueued" "$([[ -n "$ORG_ID" ]] && echo 1 || echo 0)"
check "organize job type=topic" "$([[ "$ORG_TYPE" == "topic" ]] && echo 1 || echo 0)"
check "organize payload action=organize" "$([[ "$ORG_ACTION" == "organize" ]] && echo 1 || echo 0)"

echo "-- poll organize job"
ORG_STATUS=$(poll_job "$ORG_ID")
echo "organize status=$ORG_STATUS"
check "organize job done" "$([[ "$ORG_STATUS" == "done" ]] && echo 1 || echo 0)"

MAP2=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map")
MAP2_EVAL=$(printf '%s' "$MAP2" | node -e '
  const t=JSON.parse(require("fs").readFileSync(0,"utf8"));
  function walk(nodes, acc, depth) {
    for (const n of nodes||[]) {
      acc.nodes += 1;
      acc.cards += n.cardCount||0;
      acc.maxDepth = Math.max(acc.maxDepth, depth);
      if ((n.cardCount||0)===0) {
        acc.blank += 1;
        acc.blankIds.push(n.id);
      }
      acc.titles.push(n.title);
      walk(n.children||[], acc, depth+1);
    }
    return acc;
  }
  const acc=walk(t.nodes||[], {nodes:0, cards:0, blank:0, maxDepth:0, titles:[], blankIds:[]}, 1);
  process.stdout.write(JSON.stringify(acc));
')
echo "map after organize=$MAP2_EVAL"
MAP2_NODES=$(printf '%s' "$MAP2_EVAL" | json_field nodes || true)
MAP2_CARDS=$(printf '%s' "$MAP2_EVAL" | json_field cards || true)
MAP2_DEPTH=$(printf '%s' "$MAP2_EVAL" | json_field maxDepth || true)
MAP2_BLANK=$(printf '%s' "$MAP2_EVAL" | json_field blank || true)
check "organize produced a chapter tree (>=2 nodes or depth>=2)" "$([[ "${MAP2_NODES:-0}" -ge 2 || "${MAP2_DEPTH:-0}" -ge 2 ]] && echo 1 || echo 0)"
check "organize did not drop hung cards (${BEFORE_CARDS} -> ${MAP2_CARDS})" "$([[ "${MAP2_CARDS:-0}" -ge "${BEFORE_CARDS:-0}" ]] && echo 1 || echo 0)"

EXEC=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/admin/executions?limit=20")
EXEC_EVAL=$(JOB_ID="$ORG_ID" node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const id=process.env.JOB_ID;
  const hit=(j.items||[]).find((it)=>it.jobId===id || (it.resultSummary||"").includes("organize"));
  const item=hit || (j.items||[])[0];
  process.stdout.write(JSON.stringify({
    found: item?1:0,
    agentType: item&&item.agentType||"",
    status: item&&item.status||"",
    summary: item&&item.resultSummary||"",
  }));
' <<<"$EXEC")
echo "organize execution=$EXEC_EVAL"
check "organize wrote agent_executions" "$([[ "$(printf '%s' "$EXEC_EVAL" | json_field found)" == "1" && "$(printf '%s' "$EXEC_EVAL" | json_field agentType)" == "topic" ]] && echo 1 || echo 0)"

MEM_KEYS=$(cd "$SERVER_DIR" && USER_ID="$USER_ID" TOPIC_ID="$TOPIC_ID" node --input-type=module -e '
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
const r = await pool.query(
  `SELECT key FROM memories WHERE user_id=$1 AND scope=$2 AND scope_id=$3 AND layer=$4 ORDER BY key`,
  [process.env.USER_ID, "topic", process.env.TOPIC_ID, "topic_map"],
);
process.stdout.write(r.rows.map((row)=>row.key).join(","));
await pool.end();
' || true)
echo "memories keys=$MEM_KEYS"
check "memories has snapshot:before and snapshot:after" "$([[ "$MEM_KEYS" == *snapshot:before* && "$MEM_KEYS" == *snapshot:after* ]] && echo 1 || echo 0)"

BLANK_ID=$(printf '%s' "$MAP2_EVAL" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const id=(j.blankIds&&j.blankIds[0])||"";
  process.stdout.write(id);
')
if [[ -z "$BLANK_ID" ]]; then
  echo "-- no blank node after organize; creating one for fill"
  BLANK=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics/${TOPIC_ID}/map/nodes" \
    -H 'content-type: application/json' \
    -d '{"title":"Batch Normalization"}')
  BLANK_ID=$(printf '%s' "$BLANK" | json_field id || true)
fi
check "have a blank node to fill" "$([[ -n "$BLANK_ID" ]] && echo 1 || echo 0)"

echo "-- POST /api/map-nodes/:id/fill"
FILL=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/map-nodes/${BLANK_ID}/fill")
FILL_ID=$(printf '%s' "$FILL" | json_field id || true)
FILL_ACTION=$(printf '%s' "$FILL" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String(j.payload&&j.payload.action||""));')
FILL_DOC=$(printf '%s' "$FILL" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String(j.payload&&j.payload.documentId||""));')
check "fill enqueued" "$([[ -n "$FILL_ID" ]] && echo 1 || echo 0)"
check "fill payload action=fill" "$([[ "$FILL_ACTION" == "fill" ]] && echo 1 || echo 0)"

echo "-- poll fill job"
FILL_STATUS=$(poll_job "$FILL_ID")
echo "fill status=$FILL_STATUS"
check "fill job done" "$([[ "$FILL_STATUS" == "done" ]] && echo 1 || echo 0)"

if [[ -n "$FILL_DOC" ]]; then
  FILL_DETAIL=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/documents/${FILL_DOC}")
  FILL_CARDS=$(printf '%s' "$FILL_DETAIL" | node -e '
    const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const cards=Array.isArray(j.cards)?j.cards:[];
    process.stdout.write(String(cards.length));
  ')
  FILL_DOC_STATUS=$(printf '%s' "$FILL_DETAIL" | json_field status || true)
  check "fill document digested" "$([[ "$FILL_DOC_STATUS" == "digested" ]] && echo 1 || echo 0)"
  check "fill produced 1-2 cards" "$([[ "${FILL_CARDS:-0}" -ge 1 && "${FILL_CARDS:-0}" -le 4 ]] && echo 1 || echo 0)"
fi

TODAY=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/review/today")
TODAY_N=$(printf '%s' "$TODAY" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  process.stdout.write(String((j.items||[]).length));
')
echo "today queue=$TODAY_N"
check "fill cards entered today review queue" "$([[ "${TODAY_N:-0}" -ge 1 ]] && echo 1 || echo 0)"

echo
echo "card-count ledger: digest_hung=${DIGEST_HUNG} map_after_digest=${MAP1_CARDS} map_after_organize=${MAP2_CARDS} fill_today=${TODAY_N}"
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  echo "-- worker log (tail)"
  tail -120 /tmp/inwit-t18-worker.log || true
  echo "-- server log (tail)"
  tail -40 /tmp/inwit-t18-server.log || true
  exit 1
fi
