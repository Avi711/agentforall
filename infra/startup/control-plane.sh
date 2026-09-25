
# ── Control plane only: orchestrator, Caddy and the local Docker proxy. No bot ever runs on this VM. ──
DEPLOY_DIR="/home/deploy/agent-forall"
DOMAIN="${domain}"
ORCHESTRATOR_IMAGE="${orchestrator_image}"
CADDY_IMAGE="${caddy_image}"
DOCKER_PROXY_IMAGE="${docker_proxy_image}"
FRONTEND_BRIDGE="${frontend_bridge}"
FRONTEND_SUBNET="${frontend_subnet}"
ORCHESTRATOR_FRONTEND_IP="${orchestrator_frontend_ip}"
CA_DIR=/var/lib/agent-forall/ca
CP_DIR=/var/lib/agent-forall/control-plane

printf '%s\n' "$ORCHESTRATOR_IMAGE" "$CADDY_IMAGE" "$DOCKER_PROXY_IMAGE" > "$PINNED_IMAGES"
pull_pinned_images

# Ops helper: the admin API through the frontend IP with the service token (the public site refuses private sources).
cat > /usr/local/sbin/agent-forall-admin <<'ADMINEOF'
#!/bin/bash
# Usage: agent-forall-admin <method> <path> [json]
set -euo pipefail
TOKEN=$(grep ^SERVICE_TOKENS= /home/deploy/agent-forall/.env.runtime | cut -d= -f2- | cut -d, -f1)
curl -sS -X "$1" -H "Authorization: Bearer $TOKEN" $${3:+-H "Content-Type: application/json" --data "$3"} \
  -w "\nhttp %%{http_code} in %%{time_total}s\n" "http://${orchestrator_frontend_ip}:3000$2"
ADMINEOF
chmod 0755 /usr/local/sbin/agent-forall-admin

mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

cat > .env <<COMPOSEENV
ORCHESTRATOR_IMAGE=$ORCHESTRATOR_IMAGE
CADDY_IMAGE=$CADDY_IMAGE
DOCKER_PROXY_IMAGE=$DOCKER_PROXY_IMAGE
FRONTEND_BRIDGE=$FRONTEND_BRIDGE
FRONTEND_SUBNET=$FRONTEND_SUBNET
ORCHESTRATOR_FRONTEND_IP=$ORCHESTRATOR_FRONTEND_IP
COMPOSEENV
chmod 600 .env

# ── Secrets (every boot). Populated out-of-band: gcloud secrets versions add <name> --data-file=- ──
DATABASE_URL=$(gcloud secrets versions access latest --secret=database-url --project=${project_id})
ENCRYPTION_KEY=$(gcloud secrets versions access latest --secret=encryption-key --project=${project_id})
DASHBOARD_SERVICE_TOKEN=$(gcloud secrets versions access latest --secret=dashboard-service-token --project=${project_id})
DEFAULT_PROVIDER_API_KEY=$(gcloud secrets versions access latest --secret=default-provider-api-key --project=${project_id})
LITELLM_MASTER_KEY=$(gcloud secrets versions access latest --secret=litellm-master-key --project=${project_id})
COMPOSIO_API_KEY=$(gcloud secrets versions access latest --secret=composio-api-key --project=${project_id})
TELEGRAM_MANAGER_BOT_TOKEN=$(gcloud secrets versions access latest --secret=telegram-manager-bot-token --project=${project_id})
install -d -m 0755 "$CA_DIR"
fetch_secret caddy-internal-ca-cert "$CA_DIR/root.crt" 0644
fetch_secret caddy-internal-ca-key "$CA_DIR/root.key" 0600
# Client identity for workers' Docker endpoints, read by the orchestrator process (uid 1001 in its image).
install -d -m 0750 -o 1001 -g 1001 "$CP_DIR"
fetch_secret control-plane-ca-cert "$CP_DIR/ca.crt" 0644 1001:1001
fetch_secret orchestrator-client-cert "$CP_DIR/client.crt" 0644 1001:1001
fetch_secret orchestrator-client-key "$CP_DIR/client.key" 0600 1001:1001

# ── Orchestrator env: one render, every boot. Nothing here is ever edited by hand. ──
(umask 077; cat > .env.runtime.tmp <<RUNTIMEEOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
TRUST_PROXY=$FRONTEND_SUBNET
ORCHESTRATOR_HOST_ID=orchestrator
DATABASE_URL=$DATABASE_URL
ENCRYPTION_KEY=$ENCRYPTION_KEY
API_KEYS={}
SERVICE_TOKENS=$DASHBOARD_SERVICE_TOKEN
AGENT_RUNTIME_KIND=openclaw
AGENT_RUNTIME_IMAGE=${agent_runtime_image}
HERMES_RUNTIME_IMAGE=${hermes_runtime_image}
PAIRING_IMAGE=${pairing_image}
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
PAIRING_STALE_THRESHOLD_MS=3600000
PAIRING_LOG_LEVEL=info
ORCHESTRATOR_INTERNAL_URL=https://orchestrator.internal
TENANT_CA_CERT_PATH=$CA_DIR/root.crt
WORKER_INSTANCE_IDS=${worker_instance_ids}
WORKER_ADDRESSES=${worker_addresses}
CONTROL_PLANE_CA_PATH=/control-plane/ca.crt
ORCHESTRATOR_CLIENT_CERT_PATH=/control-plane/client.crt
ORCHESTRATOR_CLIENT_KEY_PATH=/control-plane/client.key
SIDECAR_PORT_RANGE_START=${sidecar_port_range_start}
MOVES_BUCKET=agent-forall-moves
MOVE_SOURCE_RETENTION_MS=${move_source_retention_ms}
PLACEMENT_OVERCOMMIT=2
DEFAULT_PROVIDER_NAME=litellm
DEFAULT_PROVIDER_ID=litellm
DEFAULT_PROVIDER_API_KEY=$DEFAULT_PROVIDER_API_KEY
DEFAULT_PROVIDER_MODEL=gemini-agentforall
DEFAULT_PROVIDER_BASE_URL=${litellm_gateway_url}/v1
DEFAULT_PROVIDER_INPUT=text,image
DEFAULT_PROVIDER_MEDIA=image,audio,video,pdf
LITELLM_MASTER_KEY=$LITELLM_MASTER_KEY
LITELLM_DEFAULT_BUDGET_CENTS=200
LITELLM_DEFAULT_BUDGET_DURATION=
INTEGRATIONS_PROVIDER=composio
COMPOSIO_API_KEY=$COMPOSIO_API_KEY
TELEGRAM_MANAGER_BOT_TOKEN=$TELEGRAM_MANAGER_BOT_TOKEN
DASHBOARD_ORIGIN=https://agentforall.co.il
RUNTIMEEOF
)
mv .env.runtime.tmp .env.runtime

cat > docker-compose.yml <<'COMPOSEEOF'
services:
  caddy:
    image: $${CADDY_IMAGE}
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
    volumes:
      - /var/lib/agent-forall/control-plane:/control-plane:ro
    depends_on:
      docker-socket-proxy:
        condition: service_started
    networks:
      frontend:
        ipv4_address: $${ORCHESTRATOR_FRONTEND_IP}
        gw_priority: 100
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
    image: $${DOCKER_PROXY_IMAGE}
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
  control-net:
    driver: bridge
    internal: true
COMPOSEEOF

# The internal site signs with the CA root seeded from Secret Manager, the one every bot already trusts.
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

$DOMAIN {
  # A private source (a bot, a worker) has the internal site; the public one is for the internet. Ops on the VM use the frontend IP.
  @private remote_ip private_ranges
  respond @private 404
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

touch "$BOOTSTRAP_SENTINEL"

# A rerun is the deploy: compose recreates a service only when its image or environment changed.
for attempt in 1 2 3 4 5; do
  docker compose pull -q && break
  echo "pull attempt $attempt failed, retrying in 10s"
  sleep 10
done
docker compose up -d
# Compose does not see a rotated certificate or CA file: the services that read them start over.
if [ "$SECRET_CHANGED" = "1" ]; then
  docker compose up -d --force-recreate orchestrator caddy
fi
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile \
  || echo "warn: caddy reload failed; the old config stays until the next start"
echo "control plane started."
