#!/usr/bin/env bash
# T14 smoke: seed an old card, POST a ~300-word digest doc, assert verbatim anchors + agent links.
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

PORT="${SMOKE_PORT:-3024}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"

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

echo "== T14 smoke @ $BASE_URL =="

if ! curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
  echo "starting server on :$PORT ..."
  (cd "$SERVER_DIR" && exec env PORT="$PORT" pnpm exec tsx src/index.ts) >/tmp/inwit-t14-server.log 2>&1 &
  STARTED_SERVER_PID=$!
  for _ in $(seq 1 60); do
    if curl -sf "$BASE_URL/health" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$STARTED_SERVER_PID" 2>/dev/null; then
      echo "server exited before becoming healthy:"
      tail -80 /tmp/inwit-t14-server.log || true
      exit 1
    fi
    sleep 0.25
  done
  curl -sf "$BASE_URL/health" >/dev/null
fi

if [[ "${SKIP_WORKER:-}" == "1" ]]; then
  echo "SKIP_WORKER=1, using the already-running worker"
else
  echo "starting worker..."
  (cd "$SERVER_DIR" && exec env WORKER_POLL_MS=200 pnpm exec tsx src/worker.ts) >/tmp/inwit-t14-worker.log 2>&1 &
  STARTED_WORKER_PID=$!
  sleep 0.8
  if ! kill -0 "$STARTED_WORKER_PID" 2>/dev/null; then
    echo "worker exited immediately:"
    tail -80 /tmp/inwit-t14-worker.log || true
    exit 1
  fi
fi

STAMP="$(date +%s)"
EMAIL="t14-smoke-${STAMP}@inwit.local"
PASSWORD="smoke-t14-pass"

echo "-- POST /api/auth/register"
REG=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/register" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$REG"
USER_ID=$(printf '%s' "$REG" | json_field user.id || true)
check "register returns user.id" "$([[ -n "$USER_ID" ]] && echo 1 || echo 0)"

SEED='反向传播是训练神经网络时把误差从输出层传回各层、按链式法则求梯度并更新权重的算法。没有反向传播，深层网络几乎无法用梯度下降学习。常见实现会在计算图上自动求导。'
SEED_BODY=$(SEED="$SEED" node -e 'console.log(JSON.stringify({contentMd: process.env.SEED}))')

echo "-- POST seed document (反向传播)"
SEED_CREATED=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
  -H 'content-type: application/json' \
  -d "$SEED_BODY")
SEED_ID=$(printf '%s' "$SEED_CREATED" | json_field id || true)
check "seed document id" "$([[ -n "$SEED_ID" ]] && echo 1 || echo 0)"
SEED_DETAIL=$(poll_doc "$SEED_ID")
SEED_STATUS=$(printf '%s' "$SEED_DETAIL" | json_field status || true)
check "seed document digested" "$([[ "$SEED_STATUS" == "digested" ]] && echo 1 || echo 0)"

DOC='# 梯度消失

训练很深的神经网络时，反向传播要把误差信号一层层传回去。若每层的局部导数都小于 1，连乘之后靠前的层几乎收不到梯度，参数几乎不再更新。这就是梯度消失。

靠前的层梯度会指数衰减，参数几乎不再更新。sigmoid 在两端饱和，导数接近 0，会把这个问题放大。ReLU、残差连接、BatchNorm 和更谨慎的初始化，是常见的缓解办法。

梯度消失和梯度爆炸是一对方向相反的数值病：一个把梯度压没，一个把梯度撑爆。两者都来自反向传播里的连乘，只是乘子小于 1 还是大于 1。理解梯度消失，要先记住反向传播是在算链式法则。

没有稳定的梯度，深层网络只是一堆几乎冻住的权重。残差把一条捷径留给梯度，让它不必穿过每一层非线性。这也是为什么 ResNet 能把网络堆得很深，而纯 sigmoid 多层感知机很快就学不动。'

DOC_BODY=$(DOC="$DOC" node -e 'console.log(JSON.stringify({contentMd: process.env.DOC}))')
DOC_CHARS=$(DOC="$DOC" node -e 'process.stdout.write(String([...(process.env.DOC||"")].length))')
echo "target document chars=$DOC_CHARS"
check "target document is at least 300 chars" "$([[ "$DOC_CHARS" -ge 300 ]] && echo 1 || echo 0)"

echo "-- POST target document (梯度消失)"
CREATED=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
  -H 'content-type: application/json' \
  -d "$DOC_BODY")
echo "$CREATED"
DOC_ID=$(printf '%s' "$CREATED" | json_field id || true)
check "target document id" "$([[ -n "$DOC_ID" ]] && echo 1 || echo 0)"

DETAIL=$(poll_doc "$DOC_ID")
echo "$DETAIL"
DETAIL_STATUS=$(printf '%s' "$DETAIL" | json_field status || true)
check "target document digested" "$([[ "$DETAIL_STATUS" == "digested" ]] && echo 1 || echo 0)"

EVAL=$(printf '%s' "$DETAIL" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const cards=Array.isArray(j.cards)?j.cards:[];
  const content=String(j.contentMd||"");
  const withAnchor=cards.filter((c)=>typeof c.anchorText==="string" && c.anchorText.trim().length>0);
  const verbatim=withAnchor.filter((c)=>content.includes(c.anchorText));
  process.stdout.write(JSON.stringify({
    cardCount: cards.length,
    ids: cards.map((c)=>c.id).filter(Boolean),
    anchorN: withAnchor.length,
    verbatimN: verbatim.length,
    linkHint: j.linkHint||"",
    firstAnchor: (withAnchor[0]&&withAnchor[0].anchorText)||"",
  }));
')
echo "eval=$EVAL"
CARD_COUNT=$(printf '%s' "$EVAL" | json_field cardCount || true)
ANCHOR_N=$(printf '%s' "$EVAL" | json_field anchorN || true)
VERBATIM_N=$(printf '%s' "$EVAL" | json_field verbatimN || true)
CARD_ID=$(printf '%s' "$EVAL" | node -e 'const j=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write((j.ids&&j.ids[0])||"");')
check "cards >= 2" "$([[ "${CARD_COUNT:-0}" -ge 2 ]] && echo 1 || echo 0)"
check "every card has non-empty anchor_text" "$([[ "${ANCHOR_N:-0}" -ge 1 && "${ANCHOR_N}" == "${CARD_COUNT}" ]] && echo 1 || echo 0)"
check "anchor_text is a verbatim substring of the document" "$([[ "${VERBATIM_N:-0}" -ge 1 && "${VERBATIM_N}" == "${CARD_COUNT}" ]] && echo 1 || echo 0)"

echo "-- GET /api/cards/:id/links"
LINKS=$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" "$BASE_URL/api/cards/${CARD_ID}/links")
echo "$LINKS"
LINK_EVAL=$(printf '%s' "$LINKS" | node -e '
  const j=JSON.parse(require("fs").readFileSync(0,"utf8"));
  const all=[...(j.outgoing||[]),...(j.incoming||[])];
  const agent=all.filter((l)=>l.origin==="agent");
  const types=new Set(agent.map((l)=>l.type));
  const reasons=agent.filter((l)=>typeof l.reason==="string" && l.reason.trim().length>0).length;
  process.stdout.write(JSON.stringify({
    total: all.length,
    agent: agent.length,
    hasType: types.size>0?1:0,
    reasons,
  }));
')
echo "links=$LINK_EVAL"
AGENT_N=$(printf '%s' "$LINK_EVAL" | json_field agent || true)
check "agent card_links exist (seeded old card present)" "$([[ "${AGENT_N:-0}" -ge 1 ]] && echo 1 || echo 0)"

echo
echo "passed=$PASS failed=$FAIL"
if [[ "$FAIL" -ne 0 ]]; then
  echo "-- worker log (tail)"
  tail -120 /tmp/inwit-t14-worker.log || true
  echo "-- server log (tail)"
  tail -40 /tmp/inwit-t14-server.log || true
  exit 1
fi
