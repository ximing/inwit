#!/usr/bin/env bash
# T8 smoke: admin aggregation APIs against existing digest/usage rows.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pnpm --filter @inwit/server exec tsx ../../scripts/smoke-t8-check.ts
