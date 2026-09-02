ARG OPENCLAW_VERSION=2026.8.2
# The -browser variant ships Chromium and Playwright. The digest pins the image; the tag beside it
# is documentation, so bump ARG, tag and digest together.
FROM ghcr.io/openclaw/openclaw:${OPENCLAW_VERSION}-browser@sha256:e164a318801fad2d49dc19b99adadfa629fa5f9ffb43673e73661c1d3f9cc7de
ARG OPENCLAW_VERSION

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
 && rm -rf /var/lib/apt/lists/* \
 # .cache is root-owned upstream (every CLI call after the first fails without it); /opt/agentforall
 # must exist before the COPY below, which creates missing parents as root.
 && chown node:node /home/node/.cache \
 && mkdir -p /opt/agentforall && chown node:node /opt/agentforall

USER node

# WhatsApp is an installed plugin, pinned to the core version; doctor prewarms the state dir so a
# fresh tenant volume seeds from a migrated layout.
RUN openclaw plugins install "@openclaw/whatsapp@${OPENCLAW_VERSION}" --pin --accept-capabilities \
 && openclaw doctor --fix --non-interactive 2>&1 | tail -20

# After the prewarm on purpose: these plugins have no dependencies, so editing them must not redo it.
COPY --chown=node:node packages/openclaw-plugin-credit /opt/agentforall/src/agentforall-credit
COPY --chown=node:node packages/openclaw-plugin-media /opt/agentforall/src/agentforall-media
# The sources stay for rollout-plugin.sh; the tarballs stay because the install records their path
# as its source. --force confirms a non-registry source and overwrites an existing install; --accept-
# capabilities is the non-interactive consent. One command per loop body, not an && chain: errexit
# does not abort on a non-final member of a list.
RUN set -e; mkdir -p /opt/agentforall/plugins; for p in agentforall-credit agentforall-media; do \
      TARBALL="$(npm pack "/opt/agentforall/src/$p" --pack-destination /opt/agentforall/plugins --silent)"; \
      openclaw plugins install "npm-pack:/opt/agentforall/plugins/$TARBALL" --force --accept-capabilities; \
    done
