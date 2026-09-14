#!/usr/bin/env bash
# T5 retrieval self-test: index → search → delete against live Qdrant / Meili / DashScope.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$ROOT/apps/server"

cd "$SERVER_DIR"
exec pnpm exec tsx src/retrieval/self-test.ts "$@"
