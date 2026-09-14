#!/usr/bin/env bash
# T20 smoke: unattributed cluster → suggest → accept (map) and dismiss (no repeat).
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

PORT="${SMOKE_PORT:-3029}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
export PGGSSENCMODE="${PGGSSENCMODE:-disable}"

json_field() {
  node -e 'const fs=require("fs"); const s=fs.readFileSync(0,"utf8"); const k=process.argv[1]; const v=JSON.parse(s); const parts=k.split("."); let cur=v; for (const p of parts) cur=cur?.[p]; if (cur===undefined||cur===null) process.exit(1); process.stdout.write(typeof cur==="string"?cur:JSON.stringify(cur));' "$1"
}

uri_enc() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"
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
    row=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs/${id}")
    status=$(printf '%s' "$row" | json_field status || true)
    if [[ "$status" == "done" || "$status" == "failed" ]]; then
      printf '%s' "$status"
      return 0
    fi
    sleep 2
  done
  printf '%s' "${status:-timeout}"
}

find_suggest_job() {
  local listing
  listing=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/jobs?type=topic&limit=20")
  printf '%s' "$listing" | node -e '
    const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const hit=(j.items||[]).find((it)=>it.payload && it.payload.action==="suggest");
    process.stdout.write(hit?hit.id:"");
  '
}

post_doc() {
  local payload="$1"
  curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
    -H 'content-type: application/json' \
    -d "$payload"
}

echo "== T20 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t20-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t20-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

echo "starting worker..."
(cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t20-worker.log 2>&1 &
STARTED_WORKER_PID=$!
sleep 0.8
if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
  echo "worker exited immediately:"
  tail -80 /tmp/inwit-t20-worker.log || true
  exit 1
fi

STAMP="$(date +%s)"
EMAIL="t20-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t20-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

echo "-- POST 5 unattributed Rust docs"
RUST_DOCS=(
  '{"title":"Rust 所有权","contentMd":"# Rust 所有权\n\nRust 里每个值都有一个所有者（owner）。同一时刻只能有一个 owner。owner 离开作用域时，值被 drop。\n\n这和垃圾回收不同：编译期就决定谁负责释放，运行时没有扫描。\n\n把所有权搞清楚，才能理解后面的借用和生命周期。","source":"editor"}'
  '{"title":"所有权移动","contentMd":"# 所有权移动\n\n把变量赋给另一个变量，所有权会 move，原来的名字不能再用。\n\n`let s2 = s1;` 之后再读 s1 会编译失败。这是为了避免二次释放。\n\nCopy 类型（i32 等）是例外：赋值是复制不是移动。","source":"editor"}'
  '{"title":"不可变借用","contentMd":"# 不可变借用\n\n`&T` 是不可变借用：可以同时有很多个，但不能在借用期间移动或可变借用。\n\n函数用 `&str` 或 `&T` 读数据，不拿走所有权。\n\n借用结束之后，owner 才能再次独占。","source":"editor"}'
  '{"title":"可变借用","contentMd":"# 可变借用\n\n`&mut T` 同一时刻只能有一个。这是为了避免数据竞争。\n\n有可变借用时，不能再有不可变借用。\n\nNLL 让借用在最后一次使用处结束，不必等到作用域末尾。","source":"editor"}'
  '{"title":"生命周期标注","contentMd":"# 生命周期\n\n生命周期标注告诉编译器引用能活多久。函数签名里的 a 表示返回值和两个参数里较短的那个一样长。\n\n标注不改变实际寿命，只是约束。\n\n结构体里存引用时必须写生命周期参数。","source":"editor"}'
)

RUST_IDS=()
for payload in "${RUST_DOCS[@]}"; do
  DOC=$(post_doc "$payload")
  DID=$(printf '%s' "$DOC" | json_field id || true)
  echo "  posted $DID"
  RUST_IDS+=("$DID")
done
check "posted 5 rust docs" "$([[ "${#RUST_IDS[@]}" -eq 5 && -n "${RUST_IDS[0]}" ]] && echo 1 || echo 0)"

echo "-- poll 5 digests"
DIGESTED=0
for id in "${RUST_IDS[@]}"; do
  DETAIL=$(poll_doc "$id")
  STATUS=$(printf '%s' "$DETAIL" | json_field status || true)
  echo "  $id status=$STATUS"
  if [[ "$STATUS" == "digested" ]]; then
    DIGESTED=$((DIGESTED + 1))
  fi
done
check "all 5 rust docs digested" "$([[ "$DIGESTED" -eq 5 ]] && echo 1 || echo 0)"

echo "-- wait for auto suggest or POST /api/topics/suggest-scan"
SUGGEST_ID="$(find_suggest_job)"
if [[ -z "$SUGGEST_ID" ]]; then
  SCAN=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics/suggest-scan")
  SUGGEST_ID=$(printf '%s' "$SCAN" | json_field id || true)
  echo "manual scan job=$SUGGEST_ID"
else
  echo "auto suggest job=$SUGGEST_ID"
fi
check "suggest job exists" "$([[ -n "$SUGGEST_ID" ]] && echo 1 || echo 0)"

SUGGEST_STATUS=$(poll_job "$SUGGEST_ID")
echo "suggest status=$SUGGEST_STATUS"
check "suggest job done" "$([[ "$SUGGEST_STATUS" == "done" ]] && echo 1 || echo 0)"

echo "-- GET /api/topic-suggestions"
SUGGESTIONS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topic-suggestions")
SUG_EVAL=$(printf '%s' "$SUGGESTIONS" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const items=Array.isArray(j)?j:(j.items||[]);
  const first=items[0];
  process.stdout.write(JSON.stringify({
    n: items.length,
    key: first&&first.key||"",
    title: first&&first.title||"",
    count: first&&first.documentCount||0,
    ids: first&&first.documentIds||[],
  }));
')
echo "suggestions=$SUG_EVAL"
SUG_N=$(printf '%s' "$SUG_EVAL" | json_field n || true)
SUG_KEY=$(printf '%s' "$SUG_EVAL" | json_field key || true)
SUG_COUNT=$(printf '%s' "$SUG_EVAL" | json_field count || true)
check "GET returns at least 1 pending suggestion" "$([[ "${SUG_N:-0}" -ge 1 && -n "$SUG_KEY" ]] && echo 1 || echo 0)"
check "suggestion covers >=4 docs" "$([[ "${SUG_COUNT:-0}" -ge 4 ]] && echo 1 || echo 0)"

echo "-- POST /api/topic-suggestions/:key/accept"
ACCEPT=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topic-suggestions/$(uri_enc "$SUG_KEY")/accept")
TOPIC_ID=$(printf '%s' "$ACCEPT" | json_field topic.id || true)
ORG_ID=$(printf '%s' "$ACCEPT" | json_field job.id || true)
ORG_ACTION=$(printf '%s' "$ACCEPT" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String(j.job&&j.job.payload&&j.job.payload.action||""));')
echo "accept topic=$TOPIC_ID organize=$ORG_ID action=$ORG_ACTION"
check "accept created topic" "$([[ -n "$TOPIC_ID" ]] && echo 1 || echo 0)"
check "accept enqueued organize" "$([[ -n "$ORG_ID" && "$ORG_ACTION" == "organize" ]] && echo 1 || echo 0)"

ATTR=0
for id in "${RUST_IDS[@]}"; do
  DETAIL=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/documents/${id}")
  TID=$(printf '%s' "$DETAIL" | json_field topicId || true)
  if [[ "$TID" == "$TOPIC_ID" ]]; then
    ATTR=$((ATTR + 1))
  fi
done
echo "attributed=$ATTR/${#RUST_IDS[@]}"
check "at least 4 rust docs attributed to new topic" "$([[ "$ATTR" -ge 4 ]] && echo 1 || echo 0)"

echo "-- poll organize"
ORG_STATUS=$(poll_job "$ORG_ID")
echo "organize status=$ORG_STATUS"
check "organize job done" "$([[ "$ORG_STATUS" == "done" ]] && echo 1 || echo 0)"

MAP=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topics/${TOPIC_ID}/map")
MAP_EVAL=$(printf '%s' "$MAP" | node -e '
  const t=JSON.parse(require("fs").readFileSync(0,"utf8"));
  function walk(nodes, acc) {
    for (const n of nodes||[]) {
      acc.nodes += 1;
      acc.cards += n.cardCount||0;
      walk(n.children||[], acc);
    }
    return acc;
  }
  process.stdout.write(JSON.stringify(walk(t.nodes||[], {nodes:0, cards:0})));
')
echo "map after accept organize=$MAP_EVAL"
MAP_NODES=$(printf '%s' "$MAP_EVAL" | json_field nodes || true)
check "initial map has nodes" "$([[ "${MAP_NODES:-0}" -ge 1 ]] && echo 1 || echo 0)"

AFTER_ACCEPT=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topic-suggestions")
AFTER_N=$(printf '%s' "$AFTER_ACCEPT" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); const items=Array.isArray(j)?j:(j.items||[]); process.stdout.write(String(items.length));')
check "accepted suggestion no longer pending" "$([[ "${AFTER_N:-0}" -eq 0 ]] && echo 1 || echo 0)"

echo "-- archive rust topic so later digests are not soft-attributed"
ARCH=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics/${TOPIC_ID}/archive")
ARCH_STATUS=$(printf '%s' "$ARCH" | json_field status || true)
check "archived rust topic" "$([[ "$ARCH_STATUS" == "archived" ]] && echo 1 || echo 0)"

echo "-- POST 4 unattributed photography docs for dismiss"
PHOTO_DOCS=(
  '{"title":"三分法构图","contentMd":"# 三分法\n\n把画面横竖各分成三等份，主体放在交叉点上，比放正中更稳、更有呼吸感。\n\n地平线也尽量落在上三分或下三分，不要切成两半。\n\n这是入门构图里最常用的一条。","source":"editor"}'
  '{"title":"引导线","contentMd":"# 引导线\n\n路、栏杆、河流可以把视线引向主体。线条从角落进来，比平行边框更有纵深。\n\n引导线要有去处，不要把眼睛带出画面。\n\n广角更容易夸张引导线。","source":"editor"}'
  '{"title":"前景中景背景","contentMd":"# 层次\n\n前景、中景、背景叠在一起，平面照片才有空间。前景放一枝叶子或栏杆，立刻有深度。\n\n三层都要可读，不要糊成一块。\n\n小光圈更容易让三层都清楚。","source":"editor"}'
  '{"title":"黄金时刻光线","contentMd":"# 黄金时刻\n\n日出后、日落前大约一小时，光线低、色温暖、阴影长。人像和风景都合适。\n\n此时侧光能勾轮廓，逆光能出光晕。\n\n中午顶光硬、阴影丑，能躲就躲。","source":"editor"}'
)

PHOTO_IDS=()
for payload in "${PHOTO_DOCS[@]}"; do
  DOC=$(post_doc "$payload")
  DID=$(printf '%s' "$DOC" | json_field id || true)
  echo "  posted $DID"
  PHOTO_IDS+=("$DID")
done
check "posted 4 photo docs" "$([[ "${#PHOTO_IDS[@]}" -eq 4 && -n "${PHOTO_IDS[0]}" ]] && echo 1 || echo 0)"

PHOTO_DIGESTED=0
for id in "${PHOTO_IDS[@]}"; do
  DETAIL=$(poll_doc "$id")
  STATUS=$(printf '%s' "$DETAIL" | json_field status || true)
  echo "  $id status=$STATUS"
  if [[ "$STATUS" == "digested" ]]; then
    PHOTO_DIGESTED=$((PHOTO_DIGESTED + 1))
  fi
done
check "all 4 photo docs digested" "$([[ "$PHOTO_DIGESTED" -eq 4 ]] && echo 1 || echo 0)"

echo "-- suggest-scan for photography cluster (retry if an early mixed-pool scan wrote nothing)"
PHOTO_KEY=""
PHOTO_N=0
PHOTO_EVAL=""
for attempt in 1 2 3; do
  SCAN2=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics/suggest-scan")
  SCAN2_ID=$(printf '%s' "$SCAN2" | json_field id || true)
  echo "  scan attempt $attempt job=$SCAN2_ID"
  SCAN2_STATUS=$(poll_job "$SCAN2_ID")
  echo "  scan attempt $attempt status=$SCAN2_STATUS"
  PHOTO_SUG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topic-suggestions")
  PHOTO_EVAL=$(printf '%s' "$PHOTO_SUG" | node -e '
    const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
    const items=Array.isArray(j)?j:(j.items||[]);
    const first=items[0];
    process.stdout.write(JSON.stringify({
      n: items.length,
      key: first&&first.key||"",
      title: first&&first.title||"",
    }));
  ')
  echo "  suggestions=$PHOTO_EVAL"
  PHOTO_KEY=$(printf '%s' "$PHOTO_EVAL" | json_field key || true)
  PHOTO_N=$(printf '%s' "$PHOTO_EVAL" | json_field n || true)
  if [[ "${PHOTO_N:-0}" -ge 1 && -n "$PHOTO_KEY" ]]; then
    break
  fi
  sleep 1
done
check "photography suggestion appeared" "$([[ "${PHOTO_N:-0}" -ge 1 && -n "$PHOTO_KEY" ]] && echo 1 || echo 0)"

echo "-- dismiss photography suggestion"
DISMISS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topic-suggestions/$(uri_enc "$PHOTO_KEY")/dismiss")
DISMISS_STATUS=$(printf '%s' "$DISMISS" | json_field status || true)
check "dismiss marked ignored" "$([[ "$DISMISS_STATUS" == "dismissed" ]] && echo 1 || echo 0)"

EMPTY=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topic-suggestions")
EMPTY_N=$(printf '%s' "$EMPTY" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); const items=Array.isArray(j)?j:(j.items||[]); process.stdout.write(String(items.length));')
check "pending list empty after dismiss" "$([[ "${EMPTY_N:-0}" -eq 0 ]] && echo 1 || echo 0)"

echo "-- scan again should not re-propose dismissed cluster"
SCAN3=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/topics/suggest-scan")
SCAN3_ID=$(printf '%s' "$SCAN3" | json_field id || true)
SCAN3_STATUS=$(poll_job "$SCAN3_ID")
echo "third suggest status=$SCAN3_STATUS"
check "third suggest job done" "$([[ "$SCAN3_STATUS" == "done" ]] && echo 1 || echo 0)"

AGAIN=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/topic-suggestions")
AGAIN_EVAL=$(PHOTO_KEY="$PHOTO_KEY" node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const items=Array.isArray(j)?j:(j.items||[]);
  const key=process.env.PHOTO_KEY;
  const hit=items.find((it)=>it.key===key);
  process.stdout.write(JSON.stringify({ n: items.length, sameKey: hit?1:0, titles: items.map((it)=>it.title) }));
' <<<"$AGAIN")
echo "after re-scan=$AGAIN_EVAL"
AGAIN_SAME=$(printf '%s' "$AGAIN_EVAL" | json_field sameKey || true)
check "dismissed suggestion did not reappear" "$([[ "${AGAIN_SAME:-0}" -eq 0 ]] && echo 1 || echo 0)"

echo
echo "PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  echo "-- worker log (tail)"
  tail -160 /tmp/inwit-t20-worker.log || true
  echo "-- server log (tail)"
  tail -40 /tmp/inwit-t20-server.log || true
  exit 1
fi
