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

# Image refs — all three images live in GAR (auth via VM service account).
GAR_HOST="${region}-docker.pkg.dev"
GAR_REPO="$GAR_HOST/${project_id}/agent-forall"
ORCHESTRATOR_IMAGE="${orchestrator_image}"
PAIRING_IMAGE="${pairing_image}"
AGENT_RUNTIME_KIND="openclaw"
AGENT_RUNTIME_IMAGE="${agent_runtime_image}"
HERMES_RUNTIME_IMAGE="${hermes_runtime_image}"

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

if ! command -v cron >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y cron
fi
systemctl enable --now cron

if ! systemctl is-active --quiet google-cloud-ops-agent; then
  curl -fsS -o /tmp/add-google-cloud-ops-agent-repo.sh https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh
  bash /tmp/add-google-cloud-ops-agent-repo.sh --also-install
  rm -f /tmp/add-google-cloud-ops-agent-repo.sh
fi

cat > /usr/local/sbin/agent-forall-docker-housekeeping <<'HOUSEKEEPINGEOF'
#!/bin/bash
set -euo pipefail

DISK_USED=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "$DISK_USED" -ge 75 ]; then
  logger -p daemon.warning "agent-forall disk usage warning: root filesystem $${DISK_USED}% used"
fi

docker image prune -af --filter "until=168h" >/dev/null
docker builder prune -af --filter "until=168h" >/dev/null
HOUSEKEEPINGEOF
chmod 0755 /usr/local/sbin/agent-forall-docker-housekeeping

cat > /etc/cron.d/agent-forall-docker-housekeeping <<'CRONEOF'
17 3 * * * root /usr/local/sbin/agent-forall-docker-housekeeping >> /var/log/agent-forall-docker-housekeeping.log 2>&1
CRONEOF
chmod 0644 /etc/cron.d/agent-forall-docker-housekeeping

# Deploy user directory (created by Terraform; ensure ownership for cron logs).
id -u deploy >/dev/null 2>&1 || useradd -m -s /bin/bash deploy
mkdir -p "$DEPLOY_DIR"
chown -R deploy:deploy /home/deploy
cd "$DEPLOY_DIR"

cat > .env <<COMPOSEENV
ORCHESTRATOR_IMAGE=$ORCHESTRATOR_IMAGE
COMPOSEENV
chmod 600 .env

# ── Fetch shared secrets from Secret Manager (idempotent — runs every boot). ──
# Secrets must be populated out-of-band: gcloud secrets versions add <name> --data-file=-
DATABASE_URL=$(gcloud secrets versions access latest --secret=database-url --project=${project_id})
ENCRYPTION_KEY=$(gcloud secrets versions access latest --secret=encryption-key --project=${project_id})
DASHBOARD_SERVICE_TOKEN=$(gcloud secrets versions access latest --secret=dashboard-service-token --project=${project_id})
DEFAULT_PROVIDER_API_KEY=$(gcloud secrets versions access latest --secret=default-provider-api-key --project=${project_id})
LITELLM_MASTER_KEY=$(gcloud secrets versions access latest --secret=litellm-master-key --project=${project_id})
LITELLM_GATEWAY_URL="${litellm_gateway_url}"
DEFAULT_PROVIDER_BASE_URL="$LITELLM_GATEWAY_URL/v1"

# ── First-boot-only work (write env files, cron install) ──
if [ ! -f "$BOOTSTRAP_SENTINEL" ]; then
  echo "First boot detected — running one-time bootstrap."

  cat > .env.runtime <<RUNTIMEEOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
TRUST_PROXY=true
ORCHESTRATOR_HOST_ID=agent-forall-vm
DATABASE_URL=$DATABASE_URL
ENCRYPTION_KEY=$ENCRYPTION_KEY
API_KEYS={}
SERVICE_TOKENS=$DASHBOARD_SERVICE_TOKEN
AGENT_RUNTIME_KIND=$AGENT_RUNTIME_KIND
AGENT_RUNTIME_IMAGE=$AGENT_RUNTIME_IMAGE
HERMES_RUNTIME_IMAGE=$HERMES_RUNTIME_IMAGE
PAIRING_IMAGE=$PAIRING_IMAGE
PULL_IMAGES_ON_STARTUP=false
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
BACKUP_IMPORT_BUCKET=agent-forall-backup-imports
BACKUP_IMPORT_UPLOAD_ORIGIN=https://agentforall.co.il
BACKUP_IMPORT_TTL_SECONDS=3600
SHUTDOWN_TIMEOUT_MS=10000
RECONCILE_ON_STARTUP=true
MAX_PROVISION_RETRIES=3
PAIRING_PORT=18790
PAIRING_IDLE_TIMEOUT_MS=600000
PAIRING_REQUEST_TIMEOUT_MS=5000
PAIRING_STALE_THRESHOLD_MS=900000
PAIRING_LOG_LEVEL=info
ORCHESTRATOR_INTERNAL_URL=http://orchestrator:3000
DEFAULT_PROVIDER_NAME=litellm
DEFAULT_PROVIDER_ID=litellm
DEFAULT_PROVIDER_API_KEY=$DEFAULT_PROVIDER_API_KEY
DEFAULT_PROVIDER_MODEL=gemini-agentforall
DEFAULT_PROVIDER_BASE_URL=$DEFAULT_PROVIDER_BASE_URL
DEFAULT_PROVIDER_INPUT=text,image
DEFAULT_PROVIDER_MEDIA=image,audio,video,pdf
LITELLM_MASTER_KEY=$LITELLM_MASTER_KEY
LITELLM_DEFAULT_BUDGET_CENTS=5000
LITELLM_DEFAULT_BUDGET_DURATION=30d
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
      -e "s|^DEFAULT_PROVIDER_NAME=.*|DEFAULT_PROVIDER_NAME=litellm|" \
      -e "s|^DEFAULT_PROVIDER_API_KEY=.*|DEFAULT_PROVIDER_API_KEY=$DEFAULT_PROVIDER_API_KEY|" \
      -e "s|^DEFAULT_PROVIDER_MODEL=.*|DEFAULT_PROVIDER_MODEL=gemini-agentforall|" \
      -e "s|^LITELLM_MASTER_KEY=.*|LITELLM_MASTER_KEY=$LITELLM_MASTER_KEY|" \
      .env.runtime > "$TMP_RUNTIME"
  mv "$TMP_RUNTIME" .env.runtime

  set_runtime_env() {
    local key="$1"
    local value="$2"
    if grep -q "^$key=" .env.runtime; then
      sed -i "s|^$key=.*|$key=$value|" .env.runtime
    else
      echo "$key=$value" >> .env.runtime
    fi
  }

  set_runtime_env DEFAULT_PROVIDER_ID litellm
  set_runtime_env AGENT_RUNTIME_KIND "$AGENT_RUNTIME_KIND"
  set_runtime_env AGENT_RUNTIME_IMAGE "$AGENT_RUNTIME_IMAGE"
  set_runtime_env HERMES_RUNTIME_IMAGE "$HERMES_RUNTIME_IMAGE"
  set_runtime_env PAIRING_IMAGE "$PAIRING_IMAGE"
  set_runtime_env DEFAULT_PROVIDER_BASE_URL "$DEFAULT_PROVIDER_BASE_URL"
  set_runtime_env DEFAULT_PROVIDER_INPUT text,image
  set_runtime_env DEFAULT_PROVIDER_MEDIA image,audio,video,pdf
  set_runtime_env LITELLM_MASTER_KEY "$LITELLM_MASTER_KEY"
  set_runtime_env LITELLM_DEFAULT_BUDGET_CENTS 5000
  set_runtime_env LITELLM_DEFAULT_BUDGET_DURATION 30d

  # Self-heal: ensure host id is present on VMs bootstrapped before this var existed.
  if ! grep -q '^ORCHESTRATOR_HOST_ID=' .env.runtime; then
    echo "ORCHESTRATOR_HOST_ID=agent-forall-vm" >> .env.runtime
  fi
  if ! grep -q '^BACKUP_IMPORT_BUCKET=' .env.runtime; then
    echo "BACKUP_IMPORT_BUCKET=agent-forall-backup-imports" >> .env.runtime
  fi
  if ! grep -q '^BACKUP_IMPORT_UPLOAD_ORIGIN=' .env.runtime; then
    echo "BACKUP_IMPORT_UPLOAD_ORIGIN=https://agentforall.co.il" >> .env.runtime
  fi
  if ! grep -q '^BACKUP_IMPORT_TTL_SECONDS=' .env.runtime; then
    echo "BACKUP_IMPORT_TTL_SECONDS=3600" >> .env.runtime
  fi
  if ! grep -q '^PULL_IMAGES_ON_STARTUP=' .env.runtime; then
    echo "PULL_IMAGES_ON_STARTUP=false" >> .env.runtime
  fi

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
      EXEC: 1
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
docker pull "$AGENT_RUNTIME_IMAGE" 2>/dev/null || echo "warn: could not pull $AGENT_RUNTIME_IMAGE"
docker pull "$HERMES_RUNTIME_IMAGE" 2>/dev/null || echo "warn: could not pull $HERMES_RUNTIME_IMAGE"
docker pull "$PAIRING_IMAGE" 2>/dev/null || echo "warn: could not pull $PAIRING_IMAGE"
docker pull "$ORCHESTRATOR_IMAGE" 2>/dev/null || echo "warn: could not pull $ORCHESTRATOR_IMAGE"

# ── Pull and start with retry. `--no-recreate` on up preserves running containers. ──
# Compose reads ORCHESTRATOR_IMAGE from both the exported env and generated .env.
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
