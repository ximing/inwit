#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
export NODE_ENV=test PG_HOST=127.0.0.1 PG_PORT=55439 PG_DATABASE=inwit_pdf_local PG_USER=inwit_local PG_PASSWORD=local-only PG_SSL=false
export WEB_ORIGIN=http://127.0.0.1:5192
export JWT_SECRET=stream-validation-local-only-000000000000 COOKIE_SECRET=stream-validation-local-only-000000000000 LLM_KEY_ENCRYPTION_KEY=1111111111111111111111111111111111111111111111111111111111111111
export QDRANT_URL=http://127.0.0.1:63339 QDRANT_API_KEY=local-only MEILI_HOST=http://127.0.0.1:7709 MEILI_API_KEY=local-only DASHSCOPE_BASE_URL=http://127.0.0.1:8889 DASHSCOPE_API_KEY=local-only
export ATTACHMENT_S3_ENDPOINT=http://127.0.0.1:9009 ATTACHMENT_S3_REGION=local ATTACHMENT_S3_BUCKET=local ATTACHMENT_S3_ACCESS_KEY_ID=local-only ATTACHMENT_S3_SECRET_ACCESS_KEY=local-only LOG_LEVEL=error
node apps/server/node_modules/vitest/vitest.mjs run --config scripts/pdf-translation-streaming-validation/vitest.config.ts scripts/pdf-translation-streaming-validation/independent.test.ts "$@"
