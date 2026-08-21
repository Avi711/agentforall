# Build context MUST be the monorepo root, e.g.:
#   docker build -f apps/whatsapp-pairing/Dockerfile -t ghcr.io/agent-forall/whatsapp-pairing:latest .

FROM node:22.11-bookworm-slim AS builder
WORKDIR /repo

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/whatsapp-pairing/package.json apps/whatsapp-pairing/tsconfig.json apps/whatsapp-pairing/
COPY apps/whatsapp-pairing/src apps/whatsapp-pairing/src

RUN npm ci --ignore-scripts \
 && npm run build --workspace=apps/whatsapp-pairing

FROM node:22.11-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 1001 pairing \
 && useradd -m -u 1001 -g pairing -s /bin/bash pairing

COPY --from=builder /repo/package.json /repo/package-lock.json ./
COPY --from=builder /repo/apps/whatsapp-pairing/package.json apps/whatsapp-pairing/

RUN npm ci --omit=dev --ignore-scripts --workspace=apps/whatsapp-pairing --include-workspace-root

COPY --from=builder /repo/apps/whatsapp-pairing/dist apps/whatsapp-pairing/dist

USER pairing
WORKDIR /app/apps/whatsapp-pairing

VOLUME ["/data/session"]
EXPOSE 18790

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
