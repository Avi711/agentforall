
# ── Worker: bots only. The orchestrator drives this VM's Docker over mTLS; nothing here is composed. ──
HOST_ID="${host_id}"
CA_DIR=/var/lib/agent-forall/ca
CP_DIR=/var/lib/agent-forall/control-plane
REGISTER_URL="${orchestrator_internal_url}/internal/hosts/register"
ADDRESS=$(curl -sf -H "Metadata-Flavor: Google" http://169.254.169.254/computeMetadata/v1/instance/network-interfaces/0/ip)

# Bots trust the orchestrator's internal site through this root (bound into every container); the key never leaves the orchestrator.
install -d -m 0755 "$CA_DIR"
fetch_secret caddy-internal-ca-cert "$CA_DIR/root.crt" 0644

# Control plane: dockerd verifies the orchestrator's client cert against this CA and presents its own cert (CN = host id, IP SAN).
# Only these three files matter to dockerd; the tenant CA above must not trigger a restart.
SECRET_CHANGED=0
install -d -m 0700 "$CP_DIR"
fetch_secret control-plane-ca-cert "$CP_DIR/ca.crt" 0644
fetch_secret "$HOST_ID-server-cert" "$CP_DIR/server.crt" 0644
fetch_secret "$HOST_ID-server-key" "$CP_DIR/server.key" 0600

# daemon.json carries the listener; the unit's own -H must go, or dockerd refuses both.
cat > /etc/systemd/system/docker.service.d/hosts.conf <<'UNITEOF'
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd --containerd=/run/containerd/containerd.sock
UNITEOF
systemctl daemon-reload
if [ "$DOCKER_CONFIG_CHANGED" = 1 ] || [ "$SECRET_CHANGED" = 1 ] || ! ss -ltn "sport = :2376" | grep -q 2376; then
  echo "docker config or certificates changed, or :2376 is not listening; restarting dockerd (live-restore keeps bots up)"
  systemctl restart docker
  for _ in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || { echo "error: Docker did not come back after the restart"; exit 1; }
fi

# One bridge with a fixed name so the guard can match it; bots never talk to each other or to this host.
docker network inspect tenant-net >/dev/null 2>&1 \
  || docker network create --opt com.docker.network.bridge.name=${tenant_bridge} --opt com.docker.network.bridge.enable_icc=false tenant-net

printf '%s\n' "${agent_runtime_image}" "${hermes_runtime_image}" "${pairing_image}" > "$PINNED_IMAGES"
pull_pinned_images

# Registration: a fresh identity token per attempt (the orchestrator rejects one older than 5 min), the token in a tmpfs file, never argv.
cat > /usr/local/sbin/agent-forall-register <<REGISTEREOF
#!/bin/bash
set -euo pipefail
AUDIENCE="$REGISTER_URL"
TOKEN_FILE=\$(mktemp -p /run/agent-forall)
trap 'rm -f "\$TOKEN_FILE"' EXIT
printf 'Authorization: Bearer %s' "\$(curl -sf -H 'Metadata-Flavor: Google' \\
  "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/identity?audience=\$AUDIENCE&format=full")" > "\$TOKEN_FILE"
MEMORY_MB=\$(( \$(awk '/MemTotal/ { print \$2 }' /proc/meminfo) / 1024 ))
curl -sfS --cacert $CA_DIR/root.crt -H @"\$TOKEN_FILE" -H 'Content-Type: application/json' \\
  --data "{\"address\":\"$ADDRESS\",\"memoryMb\":\$MEMORY_MB}" -o /dev/null "\$AUDIENCE"
echo "registered $HOST_ID at $ADDRESS"
REGISTEREOF
chmod 0755 /usr/local/sbin/agent-forall-register
cat > /etc/systemd/system/agent-forall-register.service <<'UNITEOF'
[Unit]
Description=Register this worker with the orchestrator
After=network-online.target docker.service
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=oneshot
RuntimeDirectory=agent-forall
RuntimeDirectoryMode=0700
ExecStart=/usr/local/sbin/agent-forall-register
Restart=on-failure
RestartSec=30
UNITEOF
systemctl daemon-reload
systemctl restart agent-forall-register.service --no-block

touch "$BOOTSTRAP_SENTINEL"
echo "agent-forall worker $HOST_ID ready at $ADDRESS."
