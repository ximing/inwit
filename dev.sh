#!/usr/bin/env bash
# Start local dev: build workspace packages + migrate + API :3020 + worker + web :5190
# Usage:
#   ./dev.sh          start（先停掉已有 dev 进程，再全新启动）
#   ./dev.sh stop     停止 dev 进程
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

PID_FILE="${TMPDIR:-/tmp}/inwit-dev.pids"
LOG_DIR="${TMPDIR:-/tmp}/inwit-dev-logs"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少命令：$1" >&2
    exit 1
  }
}

port_in_use() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
  else
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1
  fi
}

healthy() {
  curl --noproxy '*' -fsS -o /dev/null --max-time 2 "$1" 2>/dev/null
}

stop_dev() {
  if [[ -f "$PID_FILE" ]]; then
    while read -r pid; do
      [[ -z "$pid" ]] && continue
      kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  echo "已停止 API / worker / Web"
}

# 按命令行特征找出本仓库的 dev 进程（pnpm 父进程 + tsx/vite/esbuild 子进程），
# 不依赖 pid 文件，能清掉之前任何方式启动的残留进程
find_dev_pids() {
  pgrep -f \
    "pnpm --filter @inwit/(server dev|server worker|web dev)|$ROOT/apps/(server|web).*(tsx|vite)|$ROOT/node_modules/.*tsx.*src/(index|worker)\.ts|$ROOT/node_modules/.*esbuild.*--service" \
    2>/dev/null || true
}

kill_existing() {
  stop_dev
  local pids
  pids="$(find_dev_pids)"
  if [[ -n "$pids" ]]; then
    echo "停止已有 dev 进程：$(echo "$pids" | tr '\n' ' ')"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    for _ in $(seq 1 10); do
      pids="$(find_dev_pids)"
      [[ -z "$pids" ]] && break
      sleep 0.5
    done
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids 2>/dev/null || true
    fi
  fi
  # 兜底：仍占用端口的进程直接结束
  local port listeners
  for port in 3020 5190; do
    if port_in_use "$port"; then
      listeners="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true)"
      if [[ -n "$listeners" ]]; then
        echo "端口 $port 仍被占用，强制结束：$(echo "$listeners" | tr '\n' ' ')"
        # shellcheck disable=SC2086
        kill -9 $listeners 2>/dev/null || true
        sleep 0.5
      fi
    fi
  done
}

if [[ "${1:-}" == "stop" ]]; then
  kill_existing
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "未知参数：$1（支持 stop）" >&2
  exit 1
fi

need pnpm
need curl

if [[ ! -f apps/server/.env ]]; then
  echo "没有 apps/server/.env。请先配置真实值（数据库 / Qdrant / Meilisearch 等）。" >&2
  exit 1
fi

kill_existing

echo "构建 doc-schema + dto + markdown…"
pnpm --filter @inwit/doc-schema build
pnpm --filter @inwit/dto build
pnpm --filter @inwit/markdown build

echo "数据库迁移…"
pnpm --filter @inwit/server migrate

mkdir -p "$LOG_DIR"

start_one() {
  local name="$1"
  shift
  echo "starting ${name}"
  "$@" >"${LOG_DIR}/${name}.log" 2>&1 &
  echo $! >>"$PID_FILE"
}

if healthy http://localhost:3020/health; then
  echo "API 已在 :3020"
else
  if port_in_use 3020; then
    echo "端口 3020 已被占用且 /health 不通" >&2
    exit 1
  fi
  : >"$PID_FILE"
  start_one server pnpm --filter @inwit/server dev
  start_one worker pnpm --filter @inwit/server worker
fi

if port_in_use 5190 && healthy http://localhost:5190/; then
  echo "Web 已在 :5190"
elif port_in_use 5190; then
  echo "端口 5190 已被占用。请先停掉占用进程。" >&2
  exit 1
else
  [[ -f "$PID_FILE" ]] || : >"$PID_FILE"
  start_one web pnpm --filter @inwit/web dev
fi

api_ok=0
web_ok=0
for _ in $(seq 1 60); do
  if healthy http://localhost:3020/health; then
    api_ok=1
  fi
  if healthy http://localhost:5190/; then
    web_ok=1
  fi
  if [[ "$api_ok" == 1 && "$web_ok" == 1 ]]; then
    break
  fi
  sleep 1
done

if [[ "$api_ok" != 1 ]]; then
  echo "API 未就绪。日志：$LOG_DIR/server.log" >&2
  tail -n 40 "$LOG_DIR/server.log" 2>/dev/null || true
  exit 1
fi
if [[ "$web_ok" != 1 ]]; then
  echo "Web 未就绪。日志：$LOG_DIR/web.log" >&2
  tail -n 40 "$LOG_DIR/web.log" 2>/dev/null || true
  exit 1
fi

cat <<EOF

开发环境已就绪
  Web   http://localhost:5190（/api 代理到 :3020）
  API   http://localhost:3020/health
  日志  $LOG_DIR
  停止  $ROOT/dev.sh stop

EOF
