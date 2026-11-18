#!/bin/sh
set -eu
# Local-only test configuration. The Vitest global setup creates/drops an isolated schema.
export PG_HOST=127.0.0.1 PG_PORT=55439 PG_DATABASE=inwit_pdf_local PG_USER=inwit_local PG_PASSWORD=local-only PG_SSL=false NODE_ENV=test
export QDRANT_URL=http://127.0.0.1:1 QDRANT_API_KEY=local-only MEILI_HOST=http://127.0.0.1:1 MEILI_API_KEY=local-only DASHSCOPE_API_KEY=local-only
export S3_ENDPOINT=http://127.0.0.1:1 S3_ACCESS_KEY_ID=local-only S3_SECRET_ACCESS_KEY=local-only S3_BUCKET=local-only
export PDF_TRANSLATION_BROWSER_TEST=1
pnpm --filter @inwit/server exec vitest run src/documents/translation/browser-harness.test.ts
