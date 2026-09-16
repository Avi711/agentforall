
# ── Orchestrator: control plane, Caddy, Docker proxy and the bots that still live beside them. ──
DEPLOY_DIR="/home/deploy/agent-forall"
DOMAIN="${domain}"
ORCHESTRATOR_IMAGE="${orchestrator_image}"
PAIRING_IMAGE="${pairing_image}"
AGENT_RUNTIME_KIND="openclaw"
AGENT_RUNTIME_IMAGE="${agent_runtime_image}"
HERMES_RUNTIME_IMAGE="${hermes_runtime_image}"
FRONTEND_BRIDGE="${frontend_bridge}"
FRONTEND_SUBNET="${frontend_subnet}"
ORCHESTRATOR_FRONTEND_IP="${orchestrator_frontend_ip}"
CA_DIR=/var/lib/agent-forall/ca
CP_DIR=/var/lib/agent-forall/control-plane
INSTANCE_ID=$(curl -sf -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/instance/id)
SELF_IP=$(curl -sf -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/ip)
# This VM is a host too: it heads both lists, Terraform supplies the workers.
WORKER_IDS="${worker_instance_ids}"
WORKER_IPS="${worker_addresses}"
WORKER_INSTANCE_IDS="agent-forall-vm=$INSTANCE_ID$${WORKER_IDS:+,$WORKER_IDS}"
WORKER_ADDRESSES="agent-forall-vm=$SELF_IP$${WORKER_IPS:+,$WORKER_IPS}"

# Owned by the orchestrator, shared by every bot here: kept outside compose so a stack change can never recreate it.
docker network inspect tenant-net >/dev/null 2>&1 || docker network create tenant-net

printf '%s\n' "$AGENT_RUNTIME_IMAGE" "$HERMES_RUNTIME_IMAGE" "$PAIRING_IMAGE" "$ORCHESTRATOR_IMAGE" > "$PINNED_IMAGES"
pull_pinned_images

# Ops helper: the admin API through the frontend IP with the service token (the public site refuses private sources).
cat > /usr/local/sbin/agent-forall-admin <<'ADMINEOF'
#!/bin/bash
# Usage: agent-forall-admin <method> <path> [json]
set -euo pipefail
TOKEN=$(grep ^SERVICE_TOKENS= /home/deploy/agent-forall/.env.runtime | cut -d= -f2 | cut -d, -f1)
curl -sS -X "$1" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" $${3:+--data "$3"} \
  -w "\nhttp %%{http_code} in %%{time_total}s\n" "http://${orchestrator_frontend_ip}:3000$2"
ADMINEOF
chmod 0755 /usr/local/sbin/agent-forall-admin

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
install -d -m 0755 "$CA_DIR"
fetch_secret caddy-internal-ca-cert "$CA_DIR/root.crt" 0644
fetch_secret caddy-internal-ca-key "$CA_DIR/root.key" 0600
# Client identity for workers' Docker endpoints, read by the orchestrator process (uid 1001 in its image).
install -d -m 0750 -o 1001 -g 1001 "$CP_DIR"
fetch_secret control-plane-ca-cert "$CP_DIR/ca.crt" 0644 1001:1001
fetch_secret orchestrator-client-cert "$CP_DIR/client.crt" 0644 1001:1001
fetch_secret orchestrator-client-key "$CP_DIR/client.key" 0600 1001:1001
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
PORT_RANGE_START=${port_range_start}
PORT_RANGE_END=${port_range_end}
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
ORCHESTRATOR_INTERNAL_URL=https://orchestrator.internal
TENANT_CA_CERT_PATH=$CA_DIR/root.crt
WORKER_INSTANCE_IDS=$WORKER_INSTANCE_IDS
WORKER_ADDRESSES=$WORKER_ADDRESSES
CONTROL_PLANE_CA_PATH=/control-plane/ca.crt
ORCHESTRATOR_CLIENT_CERT_PATH=/control-plane/client.crt
ORCHESTRATOR_CLIENT_KEY_PATH=/control-plane/client.key
SIDECAR_PORT_RANGE_START=${sidecar_port_range_start}
MOVES_BUCKET=agent-forall-moves
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
  set_runtime_env TENANT_CA_CERT_PATH "$CA_DIR/root.crt"
  set_runtime_env WORKER_INSTANCE_IDS "$WORKER_INSTANCE_IDS"
  set_runtime_env WORKER_ADDRESSES "$WORKER_ADDRESSES"
  set_runtime_env CONTROL_PLANE_CA_PATH /control-plane/ca.crt
  set_runtime_env ORCHESTRATOR_CLIENT_CERT_PATH /control-plane/client.crt
  set_runtime_env ORCHESTRATOR_CLIENT_KEY_PATH /control-plane/client.key
  set_runtime_env PORT_RANGE_START ${port_range_start}
  set_runtime_env PORT_RANGE_END ${port_range_end}
  set_runtime_env SIDECAR_PORT_RANGE_START ${sidecar_port_range_start}
  set_runtime_env MOVES_BUCKET agent-forall-moves
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
      - /var/lib/agent-forall/ca:/ca:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      orchestrator:
        condition: service_healthy
    cap_drop: [ALL]
    cap_add: [NET_BIND_SERVICE]
    networks:
      frontend:
      tenant-net:
        aliases: [orchestrator.internal]
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
    volumes:
      - /var/lib/agent-forall/control-plane:/control-plane:ro
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
# Bots and pairing sidecars reach the orchestrator through the internal site only: the relay paths,
# over TLS from our own CA (root seeded from Secret Manager so every host signs with the same root).
cat > Caddyfile <<CADDYEOF
{
  skip_install_trust
  pki {
    ca agentforall {
      name "agent-forall internal"
      root {
        format pem_file
        cert /ca/root.crt
        key /ca/root.key
      }
    }
  }
}

https://orchestrator.internal {
  tls {
    issuer internal {
      ca agentforall
    }
  }
  # Caddy answers on the public IP too: the internal site exists only for private sources.
  # A bot on a worker arrives with the worker's address too; the token check refuses it, this keeps the path off the internet.
  @register {
    path /internal/hosts/register
    not remote_ip ${vpc_cidr}
  }
  handle @register {
    respond 404
  }
  @relay {
    path /api/v1/mcp/* /api/v1/whatsapp-cloud/* /internal/*
    remote_ip private_ranges
  }
  handle @relay {
    reverse_proxy $ORCHESTRATOR_FRONTEND_IP:3000
  }
  handle {
    respond 404
  }
}
CADDYEOF

if [ -n "$DOMAIN" ]; then
  cat >> Caddyfile <<CADDYEOF

$DOMAIN {
  # A private source (a bot, a worker) has the internal site; the public one is for the internet. Ops on the VM use the frontend IP.
  @private remote_ip private_ranges
  respond @private 404
  # Relay and sidecar paths are for containers on the internal site only; never expose them publicly.
  @mcp path /api/v1/mcp/*
  respond @mcp 404
  @wacloud path /api/v1/whatsapp-cloud/*
  respond @wacloud 404
  @internal path /internal/*
  respond @internal 404

  reverse_proxy $ORCHESTRATOR_FRONTEND_IP:3000

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
  cat >> Caddyfile <<CADDYEOF

:80 {
  @mcp path /api/v1/mcp/*
  respond @mcp 404
  @wacloud path /api/v1/whatsapp-cloud/*
  respond @wacloud 404
  @internal path /internal/*
  respond @internal 404

  reverse_proxy $ORCHESTRATOR_FRONTEND_IP:3000

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
# `up --no-recreate` leaves a running Caddy on its old config; a reload with an unchanged file is a no-op.
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile \
  || echo "warn: caddy reload failed; the old config stays until the next start"

echo "agent-forall platform started."
