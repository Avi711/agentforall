#!/bin/bash
#
# GCE startup script — idempotent. This runs on first boot AND every reboot
# (GCE re-executes startup scripts). First-time-only work is gated behind a
# sentinel file so we don't rotate secrets or stomp on the running stack.
# Rendered per VM role: this part first, then startup/<role>.sh.
#
# Outputs are streamed to /var/log/agent-forall-startup.log for post-mortem.
#
set -euo pipefail
exec > >(tee -a /var/log/agent-forall-startup.log) 2>&1

BOOTSTRAP_SENTINEL="/var/lib/agent-forall/bootstrap.done"
GAR_HOST="${region}-docker.pkg.dev"
PINNED_IMAGES=/etc/agent-forall/pinned-images

mkdir -p /var/lib/agent-forall /etc/agent-forall

# ── Data disk: Docker's data-root (every tenant volume) lives on the VM's data disk, never the boot disk. ──
DATA_DEV="/dev/disk/by-id/google-${data_disk_name}"
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
  # Declared in Terraform per role; the role script decides whether a change restarts Docker.
  DAEMON_JSON='${daemon_json}'
  DOCKER_CONFIG_CHANGED=0
  if [ ! -f /etc/docker/daemon.json ] || [ "$(cat /etc/docker/daemon.json)" != "$DAEMON_JSON" ]; then
    printf '%s\n' "$DAEMON_JSON" > /etc/docker/daemon.json
    DOCKER_CONFIG_CHANGED=1
  fi
  systemctl daemon-reload
else
  echo "error: data disk $DATA_DEV is not attached; refusing to run Docker off the boot disk"
  exit 1
fi

# ── Container firewall: rules per role (see startup/guard-*.rules); 169.254.169.254 is the VM's service account and DNS. ──
cat > /etc/agent-forall/metadata-guard.rules <<'RULESEOF'
${guard_rules}
RULESEOF
cat > /usr/local/sbin/agent-forall-metadata-guard <<'GUARDEOF'
#!/bin/bash
set -euo pipefail
RULES=/etc/agent-forall/metadata-guard.rules
# Chains the file declares are ours and rebuilt from it; --noflush leaves Docker's alone. Jumps are re-inserted, not appended.
sed -n 's/^:\([^ ]*\) .*/\1/p' "$RULES" | while read -r chain; do iptables -N "$chain" 2>/dev/null || iptables -F "$chain"; done
sed -n 's/^-I INPUT //p' "$RULES" | while read -r spec; do while iptables -D INPUT $spec 2>/dev/null; do :; done; done
iptables-restore --noflush < "$RULES"
GUARDEOF
chmod 755 /usr/local/sbin/agent-forall-metadata-guard
cat > /etc/systemd/system/agent-forall-metadata-guard.service <<'UNITEOF'
[Unit]
Description=Firewall between Docker containers and the VM (metadata server, host ports)
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

# ── Docker Engine + Compose plugin (first boot of an unbaked VM only; the worker image has them). ──
if ! command -v docker >/dev/null 2>&1; then
${install_docker}
fi

echo "Waiting for Docker..."
for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
docker info >/dev/null 2>&1 || { echo "error: Docker did not come up within 120s (is $DATA_MOUNT mounted?)"; exit 1; }
echo "Docker ready."

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

# ── Configure docker to auth GAR via VM service account (idempotent). ──
if ! grep -q "$GAR_HOST" /root/.docker/config.json 2>/dev/null; then
  gcloud auth configure-docker "$GAR_HOST" --quiet
fi

# Secret Manager → file, written only on change (0600 while in flight); SECRET_CHANGED=1 tells the role script.
fetch_secret() {
  local name="$1" dest="$2" mode="$3" owner="$${4:-root:root}"
  (umask 077; gcloud secrets versions access latest --secret="$name" --project=${project_id} > "$dest.tmp")
  if cmp -s "$dest.tmp" "$dest" 2>/dev/null; then
    rm -f "$dest.tmp"
    return
  fi
  chown "$owner" "$dest.tmp" && chmod "$mode" "$dest.tmp" && mv "$dest.tmp" "$dest"
  SECRET_CHANGED=1
}
SECRET_CHANGED=0

# The daemon cannot pull private images (the API carries no credential), so the host keeps its pinned set warm.
pull_pinned_images() {
  xargs -r -n1 docker pull -q < "$PINNED_IMAGES" >/dev/null || echo "warn: a pinned image could not be pulled"
}

cat > /usr/local/sbin/agent-forall-docker-housekeeping <<'HOUSEKEEPINGEOF'
#!/bin/bash
set -euo pipefail

for fs in / /mnt/docker; do
  DISK_USED=$(df --output=pcent "$fs" | tail -1 | tr -dc '0-9')
  if [ "$DISK_USED" -ge 75 ]; then
    logger -p daemon.warning "agent-forall disk usage warning: $fs $${DISK_USED}% used"
  fi
done

# Remove every image that is neither pinned nor behind a container; a pinned image is never re-downloaded.
KEEP=$( { docker ps -aq | xargs -r docker inspect --format '{{.Image}}'; xargs -r -n1 docker image inspect --format '{{.Id}}' < /etc/agent-forall/pinned-images 2>/dev/null; } | sort -u)
docker image ls -q --no-trunc | sort -u | grep -vxF -f <(printf '%s\n' "$${KEEP:-none}") | xargs -r docker rmi -f >/dev/null
docker image prune -f >/dev/null
docker builder prune -af >/dev/null
xargs -r -n1 docker pull -q < /etc/agent-forall/pinned-images >/dev/null
HOUSEKEEPINGEOF
chmod 0755 /usr/local/sbin/agent-forall-docker-housekeeping

cat > /etc/cron.d/agent-forall-docker-housekeeping <<'CRONEOF'
17 3 * * * root /usr/local/sbin/agent-forall-docker-housekeeping >> /var/log/agent-forall-docker-housekeeping.log 2>&1
CRONEOF
chmod 0644 /etc/cron.d/agent-forall-docker-housekeeping
