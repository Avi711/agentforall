#!/bin/bash
set -euo pipefail

DEPLOY_DIR="/home/deploy/agent-forall"
DOMAIN="${domain}"

echo "Waiting for Docker..."
until docker info >/dev/null 2>&1; do sleep 2; done
echo "Docker ready."

if ! docker compose version >/dev/null 2>&1; then
  COMPOSE_VERSION="v2.29.1"
  mkdir -p /usr/local/lib/docker/cli-plugins
  curl -fsSL "https://github.com/docker/compose/releases/download/$${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose
  chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
fi

mkdir -p "$DEPLOY_DIR"
cd "$DEPLOY_DIR"

# ── Generate secrets on first deploy ──
if [ ! -f .env ]; then
  POSTGRES_PASSWORD=$(openssl rand -hex 24)
  ENCRYPTION_KEY=$(openssl rand -hex 32)
  FIRST_API_KEY=$(openssl rand -hex 32)

  cat > .env <<ENVEOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
ENVEOF
  chmod 600 .env

  cat > .env.runtime <<RUNTIMEEOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
TRUST_PROXY=true
DATABASE_URL=postgresql://agentforall:$POSTGRES_PASSWORD@postgres:5432/agentforall
ENCRYPTION_KEY=$ENCRYPTION_KEY
API_KEYS={"$FIRST_API_KEY":"admin"}
OPENCLAW_IMAGE=ghcr.io/openclaw/openclaw:latest
DOCKER_HOST=docker-socket-proxy
DOCKER_PORT=2375
DOCKER_NETWORK=agent-forall-net
PORT_RANGE_START=19000
PORT_RANGE_END=19999
HEALTH_POLL_INTERVAL_MS=15000
RECONCILE_INTERVAL_MS=60000
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000
MAX_INSTANCES_PER_USER=20
SHUTDOWN_TIMEOUT_MS=10000
RECONCILE_ON_STARTUP=true
MAX_PROVISION_RETRIES=3
RUNTIMEEOF
  chmod 600 .env.runtime

  echo "$FIRST_API_KEY" > "$DEPLOY_DIR/.first-api-key"
  chmod 600 "$DEPLOY_DIR/.first-api-key"
fi

# ── Write docker-compose ──
cat > docker-compose.yml <<'COMPOSEEOF'
services:
  caddy:
    image: caddy:2-alpine
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
      agent-forall:
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

  agent-forall:
    image: ghcr.io/agent-forall/agent-forall:latest
    container_name: agent-forall
    restart: unless-stopped
    expose:
      - "3000"
    env_file:
      - .env.runtime
    depends_on:
      postgres:
        condition: service_healthy
      docker-socket-proxy:
        condition: service_started
    networks:
      - frontend
      - backend
      - agent-forall-net
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

  postgres:
    image: postgres:17-alpine
    container_name: agent-forall-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: agentforall
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}"
      POSTGRES_DB: agentforall
    volumes:
      - pgdata:/var/lib/postgresql/data
    networks:
      - backend
    deploy:
      resources:
        limits:
          memory: 1g
          cpus: "0.5"
    logging:
      driver: json-file
      options:
        max-size: "50m"
        max-file: "5"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agentforall"]
      interval: 10s
      timeout: 5s
      retries: 5

  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:latest
    container_name: agent-forall-docker-proxy
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      CONTAINERS: 1
      NETWORKS: 1
      IMAGES: 1
      POST: 1
      PING: 1
      LOG_LEVEL: warning
    networks:
      - backend
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
  pgdata:
  caddy_data:
  caddy_config:

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
  agent-forall-net:
    driver: bridge
    name: agent-forall-net
COMPOSEEOF

# ── Write Caddyfile ──
if [ -n "$DOMAIN" ]; then
  cat > Caddyfile <<CADDYEOF
$DOMAIN {
  reverse_proxy agent-forall:3000
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
  }
}
CADDYEOF
else
  cat > Caddyfile <<'CADDYEOF'
:80 {
  reverse_proxy agent-forall:3000
  header {
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
  }
}
CADDYEOF
fi

# ── Database backup cron (daily pg_dump) ──
cat > /etc/cron.d/agent-forall-backup <<'CRONEOF'
0 2 * * * root docker exec agent-forall-postgres pg_dump -U agentforall agentforall | gzip > /home/deploy/agent-forall/backups/db-$(date +\%Y\%m\%d).sql.gz && find /home/deploy/agent-forall/backups -name "db-*.sql.gz" -mtime +14 -delete
CRONEOF
chmod 644 /etc/cron.d/agent-forall-backup
mkdir -p "$DEPLOY_DIR/backups"

# ── Pull and start with retry ──
MAX_RETRIES=5
for i in $(seq 1 $MAX_RETRIES); do
  if docker compose pull --ignore-pull-failures 2>/dev/null; then
    break
  fi
  echo "Pull attempt $i/$MAX_RETRIES failed, retrying in 10s..."
  sleep 10
done

for i in $(seq 1 $MAX_RETRIES); do
  if docker compose up -d; then
    break
  fi
  echo "Start attempt $i/$MAX_RETRIES failed, retrying in 10s..."
  sleep 10
done

echo "agent-forall platform started."
