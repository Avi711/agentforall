ARG OPENCLAW_VERSION=2026.7.1
FROM ghcr.io/openclaw/openclaw:${OPENCLAW_VERSION}

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      ffmpeg \
      fonts-liberation \
      fonts-noto \
      fonts-noto-color-emoji \
      git \
      python3 \
      python3-pip \
      python3-venv \
      unzip \
 && rm -rf /var/lib/apt/lists/*

ENV PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright

RUN node /app/node_modules/playwright-core/cli.js install --with-deps chromium \
 && chown -R node:node /home/node/.cache/ms-playwright

USER node

# WhatsApp is externalized in the 2026.5 line; install it before doctor prewarm.
RUN openclaw plugins install @openclaw/whatsapp \
 && openclaw doctor --fix --non-interactive 2>&1 | tail -20

# After the prewarm on purpose: these plugins have no dependencies, so editing them must not redo it.
COPY --chown=node:node packages/openclaw-plugin-credit /opt/agentforall-credit
COPY --chown=node:node packages/openclaw-plugin-media /opt/agentforall-media
# /opt copies stay in the image: the per-tenant rollout script stages the plugin out of them.
# The packed tarball stays too — the installed plugin records that path as its source.
# One command per line, not an && chain: errexit does not abort on a non-final member of a list,
# so a failed install would otherwise leave a green build and an image missing a plugin.
RUN set -e; for p in agentforall-credit agentforall-media; do \
      TARBALL="$(npm pack "/opt/$p" --pack-destination /tmp --silent)"; \
      openclaw plugins install "npm-pack:/tmp/$TARBALL"; \
    done
