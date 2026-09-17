# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

# Lockfile lists every workspace package.json. Keep the COPY lists in sync with
# pnpm-workspace.yaml or `pnpm install --frozen-lockfile` fails.
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/dto/package.json packages/dto/
COPY packages/markdown/package.json packages/markdown/
COPY packages/doc-schema/package.json packages/doc-schema/
COPY packages/brand/package.json packages/brand/
COPY packages/doc-engine/package.json packages/doc-engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter=@inwit/web...

FROM deps AS build
COPY packages/dto packages/dto
COPY packages/doc-schema packages/doc-schema
COPY apps/web apps/web
RUN pnpm --filter @inwit/doc-schema build \
 && pnpm --filter @inwit/dto build \
 && pnpm --filter @inwit/web build

FROM nginx:1.27-alpine AS runtime
COPY apps/web/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
