# Build context MUST be the monorepo root, e.g.:
#   docker build -f apps/orchestrator/Dockerfile -t ghcr.io/agent-forall/agent-forall:latest .

FROM node:22.11-bookworm-slim AS builder
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/orchestrator/package.json apps/orchestrator/tsconfig.json apps/orchestrator/
COPY apps/orchestrator/src apps/orchestrator/src
COPY packages/db/package.json packages/db/tsconfig.json packages/db/
COPY packages/db/src packages/db/src
COPY packages/db/drizzle packages/db/drizzle

RUN npm ci --ignore-scripts \
 && npm run build --workspace=packages/db \
 && npm run build --workspace=apps/orchestrator

FROM node:22.11-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 1001 orchestrator \
 && useradd -m -u 1001 -g orchestrator -s /bin/bash orchestrator

# Copy package manifests so we can install production deps isolated to the app.
COPY --from=builder /repo/package.json /repo/package-lock.json ./
COPY --from=builder /repo/apps/orchestrator/package.json apps/orchestrator/
COPY --from=builder /repo/packages/db/package.json packages/db/

# Production dependencies only, scoped to orchestrator + its workspace deps.
RUN npm ci --omit=dev --ignore-scripts --workspace=apps/orchestrator --include-workspace-root

# Copy compiled output and migrations into their stable locations.
COPY --from=builder /repo/apps/orchestrator/dist apps/orchestrator/dist
COPY --from=builder /repo/packages/db/dist packages/db/dist
COPY --from=builder /repo/packages/db/drizzle packages/db/drizzle

USER orchestrator
WORKDIR /app/apps/orchestrator
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
