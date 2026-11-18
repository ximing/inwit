#!/bin/sh
set -eu
export PG_HOST=127.0.0.1 PG_PORT=55439 PG_DATABASE=inwit_pdf_local PG_USER=inwit_local PG_PASSWORD=local-only PG_SSL=false NODE_ENV=test
export PGOPTIONS='-c search_path=inwit_pdf_reading,public'
export QDRANT_URL=http://127.0.0.1:1 QDRANT_API_KEY=local-only MEILI_HOST=http://127.0.0.1:1 MEILI_API_KEY=local-only DASHSCOPE_API_KEY=local-only
export ATTACHMENT_S3_ENDPOINT=http://127.0.0.1:55440 ATTACHMENT_S3_REGION=local ATTACHMENT_S3_BUCKET=local-only ATTACHMENT_S3_ACCESS_KEY_ID=local-only ATTACHMENT_S3_SECRET_ACCESS_KEY=local-only ATTACHMENT_S3_FORCE_PATH_STYLE=true ATTACHMENT_S3_IS_PUBLIC=false
pnpm --filter @inwit/server exec tsx scripts/pdf-local-reader.ts
