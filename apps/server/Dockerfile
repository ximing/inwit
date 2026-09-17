# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
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
RUN pnpm install --frozen-lockfile --filter=@inwit/server...

FROM deps AS build
COPY packages/dto packages/dto
COPY packages/markdown packages/markdown
COPY packages/doc-schema packages/doc-schema
COPY apps/server apps/server
RUN pnpm --filter @inwit/dto build \
 && pnpm --filter @inwit/markdown build \
 && pnpm --filter @inwit/doc-schema build \
 && pnpm --filter @inwit/server build

FROM base AS prod-deps
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
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
RUN pnpm install --frozen-lockfile --prod --filter=@inwit/server...

FROM base AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends fontconfig \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/packages/dto ./packages/dto
COPY --from=prod-deps /app/packages/markdown ./packages/markdown
COPY --from=prod-deps /app/packages/doc-schema ./packages/doc-schema
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/packages/dto/dist ./packages/dto/dist
COPY --from=build /app/packages/markdown/dist ./packages/markdown/dist
COPY --from=build /app/packages/doc-schema/dist ./packages/doc-schema/dist
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/drizzle ./apps/server/drizzle
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
WORKDIR /app/apps/server
EXPOSE 3020
CMD ["node", "dist/index.js"]
