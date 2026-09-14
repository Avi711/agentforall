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

# ── Data disk: Docker's data-root (every tenant volume) lives on agent-forall-data, never the boot disk. ──
DATA_DEV="/dev/disk/by-id/google-agent-forall-data"
DATA_MOUNT="/mnt/docker"
if [ -e "$DATA_DEV" ]; then
  if ! blkid "$DATA_DEV" >/dev/null 2>&1; then
    # Only a never-bootstrapped VM may format; afterwards a blank data disk is a fault, not a fresh start.
    if [ -f "$BOOTSTRAP_SENTINEL" ]; then
      echo "error: data disk $DATA_DEV has no filesystem after bootstrap; refusing to format it"
      exit 1
    fi
    mkfs.ext4 -m 0 -E lazy_itable_init=0,lazy_journal_init=0,discard "$DATA_DEV"
  fi
  mkdir -p "$DATA_MOUNT"
  DATA_UUID=$(blkid -s UUID -o value "$DATA_DEV")
  if ! grep -q " $DATA_MOUNT " /etc/fstab; then
    echo "UUID=$DATA_UUID $DATA_MOUNT ext4 discard,defaults,nofail 0 2" >> /etc/fstab
  fi
  mountpoint -q "$DATA_MOUNT" || mount "$DATA_MOUNT"
  mkdir -p /etc/docker /etc/systemd/system/docker.service.d
  # A late or missing mount must stop Docker, not start it on an empty boot-disk directory.
  cat > /etc/systemd/system/docker.service.d/data-root.conf <<UNITEOF
[Unit]
RequiresMountsFor=$DATA_MOUNT
UNITEOF
  DAEMON_JSON='{
  "data-root": "/mnt/docker",
  "firewall-backend": "iptables"
}'
  if [ ! -f /etc/docker/daemon.json ] || [ "$(cat /etc/docker/daemon.json)" != "$DAEMON_JSON" ]; then
    printf '%s\n' "$DAEMON_JSON" > /etc/docker/daemon.json
  fi
  systemctl daemon-reload
else
  echo "error: data disk $DATA_DEV is not attached; refusing to run Docker off the boot disk"
  exit 1
fi

# ── Metadata guard: only the orchestrator (fixed IP on its own bridge, default route via gw_priority) may reach
# 169.254.169.254, which is the VM's service account and also its DNS (:53 stays open); 172.16/24 is outside Docker's pool. ──
FRONTEND_BRIDGE=af-front
FRONTEND_SUBNET=172.16.0.0/24
ORCHESTRATOR_FRONTEND_IP=172.16.0.10
cat > /usr/local/sbin/agent-forall-metadata-guard <<GUARDEOF
#!/bin/bash
set -euo pipefail
iptables-restore --noflush <<'RULES'
*filter
:DOCKER-USER - [0:0]
-A DOCKER-USER -i $FRONTEND_BRIDGE -s $ORCHESTRATOR_FRONTEND_IP -d 169.254.169.254 -j RETURN
-A DOCKER-USER -p udp --dport 53 -d 169.254.169.254 -j RETURN
-A DOCKER-USER -p tcp --dport 53 -d 169.254.169.254 -j RETURN
-A DOCKER-USER -d 169.254.169.254 -j DROP
-A DOCKER-USER -j RETURN
COMMIT
RULES
GUARDEOF
chmod 755 /usr/local/sbin/agent-forall-metadata-guard
cat > /etc/systemd/system/agent-forall-metadata-guard.service <<'UNITEOF'
[Unit]
Description=Block Docker containers from the GCE metadata server
DefaultDependencies=no
After=network-pre.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/agent-forall-metadata-guard
UNITEOF
# Requires, not Before: a failing guard must keep Docker down rather than start it with the hole open.
cat > /etc/systemd/system/docker.service.d/metadata-guard.conf <<'UNITEOF'
[Unit]
Requires=agent-forall-metadata-guard.service
After=agent-forall-metadata-guard.service

[Service]
ExecStartPost=/usr/sbin/iptables -C FORWARD -j DOCKER-USER
UNITEOF
systemctl daemon-reload
systemctl start agent-forall-metadata-guard.service

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
for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
docker info >/dev/null 2>&1 || { echo "error: Docker did not come up within 120s (is $DATA_MOUNT mounted?)"; exit 1; }
echo "Docker ready."
# Owned by the orchestrator, shared by every bot: kept outside compose so a stack change can never recreate it.
docker network inspect tenant-net >/dev/null 2>&1 || docker network create tenant-net

if ! command -v cron >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y cron
fi
systemctl enable --now cron

# Best effort: an apt lock held by unattended-upgrades at boot must not abort the platform start.
if ! systemctl is-enabled --quiet google-cloud-ops-agent 2>/dev/null; then
  { curl -fsS -o /tmp/add-google-cloud-ops-agent-repo.sh https://dl.google.com/cloudagents/add-google-cloud-ops-agent-repo.sh \
      && bash /tmp/add-google-cloud-ops-agent-repo.sh --also-install; } \
    || echo "warn: ops agent install failed; VM metrics stay degraded until the next boot"
  rm -f /tmp/add-google-cloud-ops-agent-repo.sh
fi

cat > /usr/local/sbin/agent-forall-docker-housekeeping <<'HOUSEKEEPINGEOF'
#!/bin/bash
set -euo pipefail

DISK_USED=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "$DISK_USED" -ge 75 ]; then
  logger -p daemon.warning "agent-forall disk usage warning: root filesystem $${DISK_USED}% used"
fi

docker image prune -af >/dev/null
docker builder prune -af >/dev/null
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
FRONTEND_BRIDGE=$FRONTEND_BRIDGE
FRONTEND_SUBNET=$FRONTEND_SUBNET
ORCHESTRATOR_FRONTEND_IP=$ORCHESTRATOR_FRONTEND_IP
COMPOSEENV
chmod 600 .env

# ── Fetch shared secrets from Secret Manager (idempotent — runs every boot). ──
# Secrets must be populated out-of-band: gcloud secrets versions add <name> --data-file=-
DATABASE_URL=$(gcloud secrets versions access latest --secret=database-url --project=${project_id})
ENCRYPTION_KEY=$(gcloud secrets versions access latest --secret=encryption-key --project=${project_id})
DASHBOARD_SERVICE_TOKEN=$(gcloud secrets versions access latest --secret=dashboard-service-token --project=${project_id})
DEFAULT_PROVIDER_API_KEY=$(gcloud secrets versions access latest --secret=default-provider-api-key --project=${project_id})
LITELLM_MASTER_KEY=$(gcloud secrets versions access latest --secret=litellm-master-key --project=${project_id})
COMPOSIO_API_KEY=$(gcloud secrets versions access latest --secret=composio-api-key --project=${project_id})
LITELLM_GATEWAY_URL="${litellm_gateway_url}"
DEFAULT_PROVIDER_BASE_URL="$LITELLM_GATEWAY_URL/v1"

# ── First-boot-only work (write env files, cron install) ──
if [ ! -f "$BOOTSTRAP_SENTINEL" ]; then
  echo "First boot detected — running one-time bootstrap."

  cat > .env.runtime <<RUNTIMEEOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
TRUST_PROXY=$FRONTEND_SUBNET
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
LITELLM_DEFAULT_BUDGET_CENTS=200
LITELLM_DEFAULT_BUDGET_DURATION=
INTEGRATIONS_PROVIDER=composio
COMPOSIO_API_KEY=$COMPOSIO_API_KEY
DASHBOARD_ORIGIN=https://agentforall.co.il
RUNTIMEEOF
  chmod 600 .env.runtime

  touch "$BOOTSTRAP_SENTINEL"
  echo "Bootstrap complete."
else
  echo "Bootstrap sentinel found — re-syncing secrets from Secret Manager."

  # Values go through awk's ENVIRON, not a sed pattern or -v: a URL with &, | or \\ must land byte for byte.
  set_runtime_env() {
    local key="$1"
    local value="$2"
    if grep -q "^$key=" .env.runtime; then
      RUNTIME_KEY="$key" RUNTIME_VALUE="$value" awk 'BEGIN { FS = "=" } $1 == ENVIRON["RUNTIME_KEY"] { print ENVIRON["RUNTIME_KEY"] "=" ENVIRON["RUNTIME_VALUE"]; next } { print }' .env.runtime > .env.runtime.tmp
      mv .env.runtime.tmp .env.runtime
    else
      echo "$key=$value" >> .env.runtime
    fi
  }

  # Secrets re-synced on every boot in case they were rotated.
  set_runtime_env DATABASE_URL "$DATABASE_URL"
  set_runtime_env ENCRYPTION_KEY "$ENCRYPTION_KEY"
  set_runtime_env SERVICE_TOKENS "$DASHBOARD_SERVICE_TOKEN"
  set_runtime_env DEFAULT_PROVIDER_API_KEY "$DEFAULT_PROVIDER_API_KEY"
  set_runtime_env DEFAULT_PROVIDER_NAME litellm
  set_runtime_env DEFAULT_PROVIDER_MODEL gemini-agentforall
  set_runtime_env DEFAULT_PROVIDER_ID litellm
  set_runtime_env AGENT_RUNTIME_KIND "$AGENT_RUNTIME_KIND"
  set_runtime_env AGENT_RUNTIME_IMAGE "$AGENT_RUNTIME_IMAGE"
  set_runtime_env HERMES_RUNTIME_IMAGE "$HERMES_RUNTIME_IMAGE"
  set_runtime_env PAIRING_IMAGE "$PAIRING_IMAGE"
  set_runtime_env DEFAULT_PROVIDER_BASE_URL "$DEFAULT_PROVIDER_BASE_URL"
  set_runtime_env DEFAULT_PROVIDER_INPUT text,image
  set_runtime_env DEFAULT_PROVIDER_MEDIA image,audio,video,pdf
  set_runtime_env LITELLM_MASTER_KEY "$LITELLM_MASTER_KEY"
  set_runtime_env LITELLM_DEFAULT_BUDGET_CENTS 200
  set_runtime_env LITELLM_DEFAULT_BUDGET_DURATION ""
  set_runtime_env INTEGRATIONS_PROVIDER composio
  set_runtime_env COMPOSIO_API_KEY "$COMPOSIO_API_KEY"
  set_runtime_env DASHBOARD_ORIGIN https://agentforall.co.il

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
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
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
      frontend:
        ipv4_address: $${ORCHESTRATOR_FRONTEND_IP}
        gw_priority: 100
      tenant-net: {}
      control-net: {}
    deploy:
      resources:
        limits:
          memory: 1g
          cpus: "1.0"
    # Cloud Logging feeds the alert policies; Docker's dual logging keeps `docker logs` working locally.
    logging:
      driver: gcplogs
      options:
        gcp-project: ${project_id}
        gcp-meta-name: orchestrator
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
    # Orchestrator-only network: a tenant container must never be able to reach the Docker API.
    networks:
      - control-net
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
    driver_opts:
      com.docker.network.bridge.name: $${FRONTEND_BRIDGE}
    ipam:
      config:
        - subnet: $${FRONTEND_SUBNET}
  tenant-net:
    external: true
  control-net:
    driver: bridge
    internal: true
COMPOSEEOF

# ── Caddyfile ──
if [ -n "$DOMAIN" ]; then
  cat > Caddyfile <<CADDYEOF
$DOMAIN {
  # The MCP relay is for tenant containers on tenant-net only; never expose it publicly.
  @mcp path /api/v1/mcp/*
  respond @mcp 404
  @wacloud path /api/v1/whatsapp-cloud/*
  respond @wacloud 404

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
  # The MCP relay is for tenant containers on tenant-net only; never expose it publicly.
  @mcp path /api/v1/mcp/*
  respond @mcp 404
  @wacloud path /api/v1/whatsapp-cloud/*
  respond @wacloud 404

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

STARTED=0
for i in $(seq 1 $MAX_RETRIES); do
  if docker compose up -d --no-recreate; then
    STARTED=1
    break
  fi
  echo "Start attempt $i/$MAX_RETRIES failed, retrying in 10s..."
  sleep 10
done
if [ "$STARTED" -ne 1 ]; then
  echo "error: agent-forall platform did not start after $MAX_RETRIES attempts."
  exit 1
fi

echo "agent-forall platform started."
