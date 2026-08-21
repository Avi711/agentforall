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
