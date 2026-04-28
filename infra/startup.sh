#!/bin/bash
#
# GCE startup script — idempotent. This runs on first boot AND every reboot
# (GCE re-executes startup scripts). First-time-only work is gated behind a
# sentinel file so we don't rotate secrets or stomp on the running stack.
#
# Outputs are streamed to /var/log/agent-forall-startup.log for post-mortem.
#
set -euo pipefail
exec > >(tee -a /var/log/agent-forall-startup.log) 2>&1

DEPLOY_DIR="/home/deploy/agent-forall"
BOOTSTRAP_SENTINEL="/var/lib/agent-forall/bootstrap.done"
DOMAIN="${domain}"

# Image refs — orchestrator + pairing live in GAR (auth via VM service account).
# OpenClaw browser image stays on GHCR public so we don't need creds for it.
GAR_HOST="${region}-docker.pkg.dev"
GAR_REPO="$GAR_HOST/${project_id}/agent-forall"
ORCHESTRATOR_IMAGE="$GAR_REPO/orchestrator:latest"
PAIRING_IMAGE="$GAR_REPO/whatsapp-pairing:latest"
OPENCLAW_IMAGE="ghcr.io/avi711/openclaw-browser:latest"

mkdir -p /var/lib/agent-forall

# ── Install Docker Engine + Compose plugin (first boot only) ──
if ! command -v docker >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg lsb-release cron

  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  UBUNTU_CODENAME=$(lsb_release -cs)
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $${UBUNTU_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
  systemctl enable --now cron
fi

echo "Waiting for Docker..."
until docker info >/dev/null 2>&1; do sleep 2; done
echo "Docker ready."

# Deploy user directory (created by Terraform; ensure ownership for cron logs).
id -u deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
mkdir -p "$DEPLOY_DIR"
chown -R deploy:deploy /home/deploy
cd "$DEPLOY_DIR"

# ── Fetch shared secrets from Secret Manager (idempotent — runs every boot). ──
# Secrets must be populated out-of-band: gcloud secrets versions add <name> --data-file=-
DATABASE_URL=$(gcloud secrets versions access latest --secret=database-url --project=${project_id})
ENCRYPTION_KEY=$(gcloud secrets versions access latest --secret=encryption-key --project=${project_id})
DASHBOARD_SERVICE_TOKEN=$(gcloud secrets versions access latest --secret=dashboard-service-token --project=${project_id})
DEFAULT_PROVIDER_API_KEY=$(gcloud secrets versions access latest --secret=default-provider-api-key --project=${project_id})

# ── First-boot-only work (write env files, cron install) ──
if [ ! -f "$BOOTSTRAP_SENTINEL" ]; then
  echo "First boot detected — running one-time bootstrap."

  cat > .env.runtime <<RUNTIMEEOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
TRUST_PROXY=true
DATABASE_URL=$DATABASE_URL
ENCRYPTION_KEY=$ENCRYPTION_KEY
API_KEYS={}
SERVICE_TOKENS=$DASHBOARD_SERVICE_TOKEN
OPENCLAW_IMAGE=$OPENCLAW_IMAGE
PAIRING_IMAGE=$PAIRING_IMAGE
DOCKER_HOST=docker-socket-proxy
DOCKER_PORT=2375
DOCKER_NETWORK=tenant-net
PORT_RANGE_START=19000
PORT_RANGE_END=19999
HEALTH_POLL_INTERVAL_MS=15000
RECONCILE_INTERVAL_MS=60000
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
MAX_INSTANCES_PER_USER=1
SHUTDOWN_TIMEOUT_MS=10000
RECONCILE_ON_STARTUP=true
MAX_PROVISION_RETRIES=3
PAIRING_PORT=18790
PAIRING_IDLE_TIMEOUT_MS=600000
PAIRING_REQUEST_TIMEOUT_MS=5000
PAIRING_STALE_THRESHOLD_MS=900000
PAIRING_LOG_LEVEL=info
ORCHESTRATOR_INTERNAL_URL=http://orchestrator:3000
DEFAULT_PROVIDER_NAME=anthropic
DEFAULT_PROVIDER_API_KEY=$DEFAULT_PROVIDER_API_KEY
DEFAULT_PROVIDER_MODEL=claude-opus-4-7
RUNTIMEEOF
  chmod 600 .env.runtime

  touch "$BOOTSTRAP_SENTINEL"
  echo "Bootstrap complete."
else
  echo "Bootstrap sentinel found — re-syncing secrets from Secret Manager."
  # Sync secrets on every boot in case they were rotated. Atomic write so a
  # mid-boot crash never leaves a partial file.
  TMP_RUNTIME=$(mktemp)
  sed -e "s|^DATABASE_URL=.*|DATABASE_URL=$DATABASE_URL|" \
      -e "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$ENCRYPTION_KEY|" \
      -e "s|^SERVICE_TOKENS=.*|SERVICE_TOKENS=$DASHBOARD_SERVICE_TOKEN|" \
      -e "s|^DEFAULT_PROVIDER_API_KEY=.*|DEFAULT_PROVIDER_API_KEY=$DEFAULT_PROVIDER_API_KEY|" \
      .env.runtime > "$TMP_RUNTIME"
  mv "$TMP_RUNTIME" .env.runtime
  chmod 600 .env.runtime
fi

# ── Write docker-compose (reconciled every boot, safe because containers won't
# recreate unless configuration actually changed). ──
cat > docker-compose.yml <<'COMPOSEEOF'
services:
  caddy:
    image: caddy:2.8-alpine
    container_name: agent-forall-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      orchestrator:
        condition: service_healthy
    networks:
      - frontend
    deploy:
      resources:
        limits:
          memory: 256m
          cpus: "0.25"
    logging:
      driver: json-file
      options:
        max-size: "20m"
        max-file: "3"

  orchestrator:
    image: $${ORCHESTRATOR_IMAGE}
    container_name: orchestrator
    restart: unless-stopped
    expose:
      - "3000"
    env_file:
      - .env.runtime
    depends_on:
      docker-socket-proxy:
        condition: service_started
    networks:
      - frontend
      - tenant-net
    deploy:
      resources:
        limits:
          memory: 1g
          cpus: "1.0"
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:3000/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s

  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:0.3
    container_name: agent-forall-docker-proxy
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      CONTAINERS: 1
      NETWORKS: 1
      IMAGES: 1
      VOLUMES: 1
      POST: 1
      DELETE: 1
      PING: 1
      LOG_LEVEL: warning
    networks:
      - tenant-net
    deploy:
      resources:
        limits:
          memory: 128m
          cpus: "0.25"
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  caddy_data:
  caddy_config:

networks:
  frontend:
    driver: bridge
  tenant-net:
    driver: bridge
    name: tenant-net
COMPOSEEOF

# ── Caddyfile ──
if [ -n "$DOMAIN" ]; then
  cat > Caddyfile <<CADDYEOF
$DOMAIN {
  reverse_proxy orchestrator:3000

  request_body {
    max_size 1MB
  }

  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
    -Server
  }

  encode gzip zstd
}
CADDYEOF
else
  cat > Caddyfile <<'CADDYEOF'
:80 {
  reverse_proxy orchestrator:3000

  request_body {
    max_size 1MB
  }

  header {
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "strict-origin-when-cross-origin"
    -Server
  }
}
CADDYEOF
fi

# ── Configure docker to auth GAR via VM service account (idempotent). ──
if ! grep -q "$GAR_HOST" /root/.docker/config.json 2>/dev/null; then
  gcloud auth configure-docker "$GAR_HOST" --quiet
fi

# ── Warm the image cache. Non-fatal: may already be cached. ──
docker pull "$OPENCLAW_IMAGE" 2>/dev/null || echo "warn: could not pull $OPENCLAW_IMAGE"
docker pull "$PAIRING_IMAGE" 2>/dev/null || echo "warn: could not pull $PAIRING_IMAGE"
docker pull "$ORCHESTRATOR_IMAGE" 2>/dev/null || echo "warn: could not pull $ORCHESTRATOR_IMAGE"

# ── Pull and start with retry. `--no-recreate` on up preserves running containers. ──
# Compose reads $ORCHESTRATOR_IMAGE from the env (no .env file needed).
export ORCHESTRATOR_IMAGE
MAX_RETRIES=5
for i in $(seq 1 $MAX_RETRIES); do
  if docker compose pull --ignore-pull-failures 2>/dev/null; then
    break
  fi
  echo "Pull attempt $i/$MAX_RETRIES failed, retrying in 10s..."
  sleep 10
done

for i in $(seq 1 $MAX_RETRIES); do
  if docker compose up -d --no-recreate; then
    break
  fi
  echo "Start attempt $i/$MAX_RETRIES failed, retrying in 10s..."
  sleep 10
done

echo "agent-forall platform started."
