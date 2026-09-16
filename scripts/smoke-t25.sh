#!/usr/bin/env bash
# T23 search API smoke: two distinct docs → GET /api/search hits the right one;
# empty q → 400; INWIT_SEARCH_FALLBACK toggles PG ILIKE.
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
PORT="${SMOKE_PORT:-3034}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
export PGGSSENCMODE="${PGGSSENCMODE:-disable}"

json_field() {
  node -e 'const fs=require("fs"); const s=fs.readFileSync(0,"utf8"); const k=process.argv[1]; const v=JSON.parse(s); const parts=k.split("."); let cur=v; for (const p of parts) cur=cur?.[p]; if (cur===undefined) process.exit(1); process.stdout.write(cur===null?"null":(typeof cur==="string"?cur:JSON.stringify(cur)));' "$1"
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

stop_smoke_server() {
  if [[ -n "${STARTED_SERVER_PID}" ]]; then
    if command -v lsof >/dev/null 2>&1; then
      for pid in $(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
        kill_tree "$pid"
      done
    fi
    kill_tree "$STARTED_SERVER_PID"
    wait "$STARTED_SERVER_PID" 2>/dev/null || true
    STARTED_SERVER_PID=""
  fi
}

start_smoke_server() {
  local fallback="${1:-false}"
  stop_smoke_server
  echo "starting server on :$PORT INWIT_SEARCH_FALLBACK=$fallback ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" INWIT_SEARCH_FALLBACK="$fallback" pnpm exec tsx src/index.ts) >/tmp/inwit-t25-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 80); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      return 0
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t25-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  echo "server did not become healthy:"
  tail -80 /tmp/inwit-t25-server.log || true
  exit 1
}

if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -t -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
    kill_tree "$pid"
  done
  sleep 0.3
fi

echo "== T23 search smoke @ $BASE_URL =="
start_smoke_server false

STAMP="$(date +%s)"
EMAIL="t23-search-${STAMP}@inwit.local"
PASSWORD="smoke-t23-search-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

CONTENT1='光合作用是绿色植物、藻类和部分细菌把光能转成化学能的过程。叶绿素吸收可见光，在叶绿体类囊体膜上完成光反应，放出氧气；暗反应在叶绿体基质里用 ATP 和 NADPH 把二氧化碳固定成糖。不要和呼吸作用搞混：呼吸是氧化有机物释放能量。'
CONTENT2='面向对象编程靠封装、继承和多态组织代码。封装把状态藏在对象里；继承复用父类行为；多态让同一接口在子类里有不同实现。设计模式（工厂、策略、观察者）建立在这三条之上，和光合作用毫无关系。'

create_doc() {
  local title="$1"
  local content="$2"
  node -e 'const t=process.argv[1]; const c=process.argv[2]; process.stdout.write(JSON.stringify({title:t, contentMd:c, source:"paste"}))' "$title" "$content" \
    | curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
      -H 'content-type: application/json' -d @-
}

echo "-- POST /api/documents (photosynthesis vs OOP)"
DOC1=$(create_doc "光合作用与叶绿体" "$CONTENT1")
DOC2=$(create_doc "面向对象的三条原则" "$CONTENT2")
DOC1_ID=$(printf '%s' "$DOC1" | json_field id || true)
DOC2_ID=$(printf '%s' "$DOC2" | json_field id || true)
echo "doc1=$DOC1_ID doc2=$DOC2_ID"
check "created two documents" "$([[ -n "$DOC1_ID" && -n "$DOC2_ID" && "$DOC1_ID" != "$DOC2_ID" ]] && echo 1 || echo 0)"

eval_search() {
  local body="$1"
  local expect_id="$2"
  local other_id="$3"
  EXPECT_ID="$expect_id" OTHER_ID="$other_id" node -e '
    const body=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const docs=Array.isArray(body.documents)?body.documents:[];
    const cards=Array.isArray(body.cards)?body.cards:[];
    const ids=docs.map((d)=>d.id);
    const first=ids[0]||null;
    const expectId=process.env.EXPECT_ID;
    const other=process.env.OTHER_ID;
    const hasListItem=docs[0] && typeof docs[0].cardCount==="number" && Object.prototype.hasOwnProperty.call(docs[0],"topicTitle");
    process.stdout.write(JSON.stringify({
      n: docs.length,
      cardsN: cards.length,
      first,
      hitFirst: first===expectId?1:0,
      otherLater: !ids.includes(other) || ids.indexOf(other)>ids.indexOf(expectId)?1:0,
      shape: (Array.isArray(body.documents) && Array.isArray(body.cards) && hasListItem)?1:0,
    }));
  ' <<<"$body"
}

search_once() {
  local q="$1"
  curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -G "$BASE_URL/api/search" --data-urlencode "q=$q"
}

echo "-- GET /api/search?q=叶绿素 叶绿体 光反应"
SEARCH1=""
SEARCH1_EVAL=""
for _ in $(seq 1 12); do
  SEARCH1=$(search_once "叶绿素 叶绿体 光反应")
  SEARCH1_EVAL=$(eval_search "$SEARCH1" "$DOC1_ID" "$DOC2_ID")
  if [[ "$(printf '%s' "$SEARCH1_EVAL" | json_field hitFirst)" == "1" ]]; then
    break
  fi
  sleep 0.4
done
echo "search1=$SEARCH1_EVAL"
check "search response shape documents+cards" "$([[ "$(printf '%s' "$SEARCH1_EVAL" | json_field shape)" == "1" ]] && echo 1 || echo 0)"
check "photosynthesis query ranks doc1 first" "$([[ "$(printf '%s' "$SEARCH1_EVAL" | json_field hitFirst)" == "1" ]] && echo 1 || echo 0)"
check "OOP doc is later or absent" "$([[ "$(printf '%s' "$SEARCH1_EVAL" | json_field otherLater)" == "1" ]] && echo 1 || echo 0)"

echo "-- GET /api/search?q=封装 继承 多态"
SEARCH2=$(search_once "封装 继承 多态")
SEARCH2_EVAL=$(eval_search "$SEARCH2" "$DOC2_ID" "$DOC1_ID")
echo "search2=$SEARCH2_EVAL"
check "OOP query ranks doc2 first" "$([[ "$(printf '%s' "$SEARCH2_EVAL" | json_field hitFirst)" == "1" ]] && echo 1 || echo 0)"

echo "-- empty q → 400"
EMPTY_CODE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o /tmp/inwit-t25-empty.json -w '%{http_code}' "$BASE_URL/api/search?q=")
MISSING_CODE=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o /tmp/inwit-t25-missing.json -w '%{http_code}' "$BASE_URL/api/search")
EMPTY_ERR=$(json_field error.code </tmp/inwit-t25-empty.json || true)
check "q= returns 400 VALIDATION_ERROR" "$([[ "$EMPTY_CODE" == "400" && "$EMPTY_ERR" == "VALIDATION_ERROR" ]] && echo 1 || echo 0)"
check "missing q returns 400" "$([[ "$MISSING_CODE" == "400" ]] && echo 1 || echo 0)"

echo "-- INWIT_SEARCH_FALLBACK=true (PG ILIKE)"
start_smoke_server true
FB=$(search_once "叶绿素")
FB_EVAL=$(eval_search "$FB" "$DOC1_ID" "$DOC2_ID")
echo "fallback=$FB_EVAL"
check "fallback search still 200 with documents+cards" "$([[ "$(printf '%s' "$FB_EVAL" | json_field shape)" == "1" ]] && echo 1 || echo 0)"
check "fallback ILIKE hits photosynthesis doc" "$([[ "$(printf '%s' "$FB_EVAL" | json_field hitFirst)" == "1" || "$(printf '%s' "$FB" | DOC1_ID="$DOC1_ID" node -e 'const b=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write((b.documents||[]).some((d)=>d.id===process.env.DOC1_ID)?"1":"0");')" == "1" ]] && echo 1 || echo 0)"
FB_EMPTY=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -o /tmp/inwit-t25-fb-empty.json -w '%{http_code}' "$BASE_URL/api/search?q=")
check "fallback empty q still 400" "$([[ "$FB_EMPTY" == "400" ]] && echo 1 || echo 0)"

echo "-- INWIT_SEARCH_FALLBACK=false (hybrid back on)"
start_smoke_server false
HY=$(search_once "叶绿体")
HY_EVAL=$(eval_search "$HY" "$DOC1_ID" "$DOC2_ID")
echo "hybrid-again=$HY_EVAL"
check "hybrid can be turned back on" "$([[ "$(printf '%s' "$HY_EVAL" | json_field shape)" == "1" ]] && echo 1 || echo 0)"
check "hybrid again hits photosynthesis doc" "$([[ "$(printf '%s' "$HY_EVAL" | json_field hitFirst)" == "1" || "$(printf '%s' "$HY" | DOC1_ID="$DOC1_ID" node -e 'const b=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write((b.documents||[]).some((d)=>d.id===process.env.DOC1_ID)?"1":"0");')" == "1" ]] && echo 1 || echo 0)"

echo
echo "PASS=$PASS FAIL=$FAIL (user $EMAIL)"
if [[ "$FAIL" -gt 0 ]]; then
  echo "server tail:"
  tail -60 /tmp/inwit-t25-server.log || true
  echo "last search1 body:"
  printf '%s\n' "$SEARCH1"
  exit 1
fi
