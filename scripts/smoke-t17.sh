#!/usr/bin/env bash
# T17 smoke: map node CRUD, hang card/doc, review remembered → status covered.
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

PORT="${SMOKE_PORT:-3027}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
export PGGSSENCMODE="${PGGSSENCMODE:-disable}"

json_field() {
  node -e 'const fs=require("fs"); const s=fs.readFileSync(0,"utf8"); const k=process.argv[1]; const v=JSON.parse(s); const parts=k.split("."); let cur=v; for (const p of parts) cur=cur?.[p]; if (cur===undefined||cur===null) process.exit(1); process.stdout.write(typeof cur==="string"?cur:JSON.stringify(cur));' "$1"
}

json_raw() {
  node -e 'const s=require("fs").readFileSync(0,"utf8"); const k=process.argv[1]; const v=JSON.parse(s); const parts=k.split("."); let cur=v; for (const p of parts) cur=cur?.[p]; process.stdout.write(cur===undefined?"undefined":JSON.stringify(cur));' "$1"
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

insert_card() {
  local user_id="$1"
  local document_id="$2"
  local topic_id="$3"
  (cd "$SERVER_DIR" && USER_ID="$user_id" DOCUMENT_ID="$document_id" TOPIC_ID="$topic_id" node --input-type=module -e '
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
  `INSERT INTO cards (user_id, document_id, topic_id, concept, example, confusion_point, tags, source)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
   RETURNING id`,
  [
    process.env.USER_ID,
    process.env.DOCUMENT_ID,
    process.env.TOPIC_ID,
    "梯度消失",
    "深层网络反向传播时靠前层梯度接近 0",
    "和梯度爆炸相对",
    ["反向传播"],
    "manual",
  ],
);
process.stdout.write(r.rows[0].id);
await pool.end();
')
}

echo "== T17 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t17-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t17-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

STAMP="$(date +%s)"
EMAIL="t17-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t17-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

echo "-- POST /api/topics"
TOPIC=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics" \
  -H 'content-type: application/json' \
  -d '{"title":"T17 机器学习","goal":"掌握核心概念"}')
TOPIC_ID=$(printf '%s' "$TOPIC" | json_field id || true)
check "create topic" "$([[ -n "$TOPIC_ID" ]] && echo 1 || echo 0)"

echo "-- POST /api/documents"
DOC=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
  -H 'content-type: application/json' \
  -d "{\"title\":\"梯度消失笔记\",\"contentMd\":\"梯度消失是深层网络的典型问题。\",\"topicId\":\"$TOPIC_ID\"}")
DOC_ID=$(printf '%s' "$DOC" | json_field id || true)
check "create document" "$([[ -n "$DOC_ID" ]] && echo 1 || echo 0)"

echo "-- SQL insert card"
CARD_ID=$(insert_card "$USER_ID" "$DOC_ID" "$TOPIC_ID" || true)
check "insert card" "$([[ -n "$CARD_ID" ]] && echo 1 || echo 0)"

echo "-- GET empty map / summary"
EMPTY=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map")
EMPTY_LEN=$(printf '%s' "$EMPTY" | json_field nodes || true)
check "empty map nodes=[]" "$([[ "$EMPTY_LEN" == "[]" ]] && echo 1 || echo 0)"
SUM0=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map/summary")
check "empty summary totalNodes=0" "$([[ "$(printf '%s' "$SUM0" | json_field totalNodes)" == "0" ]] && echo 1 || echo 0)"

echo "-- POST root node"
ROOT_NODE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics/${TOPIC_ID}/map/nodes" \
  -H 'content-type: application/json' \
  -d '{"title":"基础概念","note":"第一章"}')
ROOT_ID=$(printf '%s' "$ROOT_NODE" | json_field id || true)
ROOT_STATUS=$(printf '%s' "$ROOT_NODE" | json_field status || true)
check "create root node" "$([[ -n "$ROOT_ID" ]] && echo 1 || echo 0)"
check "new node status uncovered" "$([[ "$ROOT_STATUS" == "uncovered" ]] && echo 1 || echo 0)"

echo "-- POST child + grandchild"
CHILD=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics/${TOPIC_ID}/map/nodes" \
  -H 'content-type: application/json' \
  -d "{\"title\":\"训练问题\",\"parentId\":\"$ROOT_ID\"}")
CHILD_ID=$(printf '%s' "$CHILD" | json_field id || true)
check "create child node" "$([[ -n "$CHILD_ID" ]] && echo 1 || echo 0)"

GRAND=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics/${TOPIC_ID}/map/nodes" \
  -H 'content-type: application/json' \
  -d "{\"title\":\"梯度消失\",\"parentId\":\"$CHILD_ID\"}")
GRAND_ID=$(printf '%s' "$GRAND" | json_field id || true)
check "create grandchild node" "$([[ -n "$GRAND_ID" ]] && echo 1 || echo 0)"

echo "-- POST 4th level rejected"
DEPTH_CODE=$(curl -sS -o /tmp/inwit-t17-depth.json -w '%{http_code}' -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X POST "$BASE_URL/api/topics/${TOPIC_ID}/map/nodes" \
  -H 'content-type: application/json' \
  -d "{\"title\":\"太深了\",\"parentId\":\"$GRAND_ID\"}")
DEPTH_ERR=$(json_field error.code </tmp/inwit-t17-depth.json || true)
check "4th level is 400" "$([[ "$DEPTH_CODE" == "400" ]] && echo 1 || echo 0)"
check "4th level MAP_NODE_INVALID_PARENT" "$([[ "$DEPTH_ERR" == "MAP_NODE_INVALID_PARENT" ]] && echo 1 || echo 0)"

echo "-- PATCH rename grandchild"
PATCHED=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X PATCH "$BASE_URL/api/map-nodes/${GRAND_ID}" \
  -H 'content-type: application/json' \
  -d '{"title":"梯度消失与爆炸","note":"成对出现"}')
check "patch title" "$([[ "$(printf '%s' "$PATCHED" | json_field title)" == "梯度消失与爆炸" ]] && echo 1 || echo 0)"

echo "-- PUT card → grandchild"
HUNG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X PUT "$BASE_URL/api/cards/${CARD_ID}/map-node" \
  -H 'content-type: application/json' \
  -d "{\"nodeId\":\"$GRAND_ID\"}")
check "card hung on grandchild" "$([[ "$(printf '%s' "$HUNG" | json_field mapNodeId)" == "$GRAND_ID" ]] && echo 1 || echo 0)"

echo "-- PUT document → grandchild"
HUNG_DOC=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X PUT "$BASE_URL/api/documents/${DOC_ID}/map-node" \
  -H 'content-type: application/json' \
  -d "{\"nodeId\":\"$GRAND_ID\"}")
check "document hung on grandchild" "$([[ "$(printf '%s' "$HUNG_DOC" | json_field mapNodeId)" == "$GRAND_ID" ]] && echo 1 || echo 0)"

echo "-- GET map after hang"
MAP1=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map")
MAP_EVAL=$(printf '%s' "$MAP1" | node -e '
  const t=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const root=t.nodes?.[0];
  const child=root?.children?.[0];
  const leaf=child?.children?.[0];
  process.stdout.write(JSON.stringify({
    roots: t.nodes?.length ?? 0,
    rootTitle: root?.title ?? "",
    childTitle: child?.title ?? "",
    leafTitle: leaf?.title ?? "",
    leafCards: leaf?.cardCount ?? -1,
    leafDocs: leaf?.docCount ?? -1,
    leafStatus: leaf?.status ?? "",
    leafMastery: leaf?.mastery ?? -1,
    rootStatus: root?.status ?? "",
  }));
')
echo "map=$MAP_EVAL"
check "tree 基础概念 > 训练问题 > 梯度消失与爆炸" "$([[ "$(printf '%s' "$MAP_EVAL" | json_field roots)" == "1" && "$(printf '%s' "$MAP_EVAL" | json_field rootTitle)" == "基础概念" && "$(printf '%s' "$MAP_EVAL" | json_field childTitle)" == "训练问题" && "$(printf '%s' "$MAP_EVAL" | json_field leafTitle)" == "梯度消失与爆炸" ]] && echo 1 || echo 0)"
check "leaf cardCount=1 docCount=1" "$([[ "$(printf '%s' "$MAP_EVAL" | json_field leafCards)" == "1" && "$(printf '%s' "$MAP_EVAL" | json_field leafDocs)" == "1" ]] && echo 1 || echo 0)"
check "leaf status learning (has card, mastery 0)" "$([[ "$(printf '%s' "$MAP_EVAL" | json_field leafStatus)" == "learning" && "$(printf '%s' "$MAP_EVAL" | json_field leafMastery)" == "0" ]] && echo 1 || echo 0)"
check "empty parent still uncovered" "$([[ "$(printf '%s' "$MAP_EVAL" | json_field rootStatus)" == "uncovered" ]] && echo 1 || echo 0)"

echo "-- GET summary after hang"
SUM1=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map/summary")
echo "summary=$SUM1"
check "summary totalNodes=3 uncovered=2 cardCount=1 masteryPct=0" "$([[ "$(printf '%s' "$SUM1" | json_field totalNodes)" == "3" && "$(printf '%s' "$SUM1" | json_field uncoveredNodes)" == "2" && "$(printf '%s' "$SUM1" | json_field cardCount)" == "1" && "$(printf '%s' "$SUM1" | json_field masteryPct)" == "0" ]] && echo 1 || echo 0)"

echo "-- POST review remembered"
FB=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/review/${CARD_ID}/feedback" \
  -H 'content-type: application/json' \
  -d '{"feedback":"remembered"}')
FB_FEEDBACK=$(printf '%s' "$FB" | json_field reviewState.lastFeedback || true)
check "feedback remembered" "$([[ "$FB_FEEDBACK" == "remembered" ]] && echo 1 || echo 0)"

echo "-- GET map after remembered"
MAP2=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map")
LEAF_STATUS=$(printf '%s' "$MAP2" | node -e '
  const t=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const leaf=t.nodes?.[0]?.children?.[0]?.children?.[0];
  process.stdout.write(JSON.stringify({ status: leaf?.status ?? "", mastery: leaf?.mastery ?? -1 }));
')
echo "leaf=$LEAF_STATUS"
check "leaf status covered after remembered" "$([[ "$(printf '%s' "$LEAF_STATUS" | json_field status)" == "covered" ]] && echo 1 || echo 0)"
check "leaf mastery=1" "$([[ "$(printf '%s' "$LEAF_STATUS" | json_field mastery)" == "1" ]] && echo 1 || echo 0)"

SUM2=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map/summary")
check "summary masteryPct=100 uncovered=2" "$([[ "$(printf '%s' "$SUM2" | json_field masteryPct)" == "100" && "$(printf '%s' "$SUM2" | json_field uncoveredNodes)" == "2" ]] && echo 1 || echo 0)"

echo "-- DELETE grandchild (unbind card/doc, keep content)"
DEL_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X DELETE "$BASE_URL/api/map-nodes/${GRAND_ID}")
check "delete node 204" "$([[ "$DEL_CODE" == "204" ]] && echo 1 || echo 0)"

CARD_AFTER=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/cards/${CARD_ID}")
DOC_AFTER=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/documents/${DOC_ID}")
CARD_NODE=$(printf '%s' "$CARD_AFTER" | json_raw mapNodeId || true)
DOC_NODE=$(printf '%s' "$DOC_AFTER" | json_raw mapNodeId || true)
CARD_CONCEPT=$(printf '%s' "$CARD_AFTER" | json_field concept || true)
check "card still exists after node delete" "$([[ "$CARD_CONCEPT" == "梯度消失" ]] && echo 1 || echo 0)"
check "card mapNodeId null" "$([[ "$CARD_NODE" == "null" ]] && echo 1 || echo 0)"
check "document mapNodeId null" "$([[ "$DOC_NODE" == "null" ]] && echo 1 || echo 0)"

MAP3=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map")
AFTER_DEL=$(printf '%s' "$MAP3" | node -e '
  const t=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const root=t.nodes?.[0];
  process.stdout.write(JSON.stringify({
    roots: t.nodes?.length ?? 0,
    children: root?.children?.length ?? -1,
    grand: root?.children?.[0]?.children?.length ?? -1,
  }));
')
check "grandchild gone, parents remain" "$([[ "$(printf '%s' "$AFTER_DEL" | json_field roots)" == "1" && "$(printf '%s' "$AFTER_DEL" | json_field children)" == "1" && "$(printf '%s' "$AFTER_DEL" | json_field grand)" == "0" ]] && echo 1 || echo 0)"

echo "-- DELETE child cascades? child has no further kids now; delete root should drop remaining child"
DEL_ROOT=$(curl -sS -o /dev/null -w '%{http_code}' -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -X DELETE "$BASE_URL/api/map-nodes/${ROOT_ID}")
check "delete root 204" "$([[ "$DEL_ROOT" == "204" ]] && echo 1 || echo 0)"
MAP4=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map")
check "map empty after deleting root" "$([[ "$(printf '%s' "$MAP4" | json_field nodes)" == "[]" ]] && echo 1 || echo 0)"

echo
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
