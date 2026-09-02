#!/usr/bin/env bash
# Rebuilds tenant containers on the orchestrator's currently configured runtime image. A container
# keeps the image it was created with, so tenants drift apart as AGENT_RUNTIME_IMAGE moves on;
# this brings them back to one image. The state volume (/home/node/.openclaw: config, credentials,
# workspace) is not touched — recreate reattaches it by name.
# Runs on the VM. Safe to rerun; a tenant already on the target image is skipped unless --force.
# The orchestrator's recreate migrates the volume before the new container boots (doctor, WhatsApp
# plugin pinned to the core version, config patch); a tarball of the volume is taken here first, as
# the rollback of last resort next to the disk snapshot. Our own plugins live in the volume too and
# are NOT refreshed by a recreate: run rollout-plugin.sh for each afterwards when they changed.
# Stopped tenants are skipped; they are rebuilt on the current image by their next start.
# Stops at the first failed tenant unless --keep-going.
# Usage: bash recreate-tenants.sh --image <ref-or-digest> [--only <container|name|display-name>]
#          [--force] [--keep-going] [--dry-run]
set -euo pipefail

IMAGE=""
ONLY=""
FORCE=0
KEEP_GOING=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --keep-going) KEEP_GOING=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$IMAGE" ] || { echo "--image is required: the ref tenants must end up on" >&2; exit 2; }

API="https://api.agentforall.co.il"
ENV_FILE="/home/deploy/agent-forall/.env.runtime"
BACKUP_DIR="/home/deploy/backups"
SNAPSHOT_IMAGE="alpine:3.22"
MIN_FREE_KB=$((5 * 1024 * 1024))
STAMP="$(date +%Y%m%d-%H%M%S)"
TOKEN="$(sudo grep '^SERVICE_TOKENS=' "$ENV_FILE" | cut -d= -f2- | cut -d, -f1 | tr -d '"' || true)"
[ -n "$TOKEN" ] || { echo "no SERVICE_TOKENS in $ENV_FILE" >&2; exit 1; }

# The orchestrator creates from its own AGENT_RUNTIME_IMAGE, so a mismatch here would silently
# rebuild tenants onto something other than what was asked for.
PINNED="$(sudo grep '^AGENT_RUNTIME_IMAGE=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' || true)"
[ "$PINNED" = "$IMAGE" ] || { echo "AGENT_RUNTIME_IMAGE is $PINNED, not $IMAGE" >&2; exit 1; }
TARGET_ID="$(sudo docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || true)"
[ -n "$TARGET_ID" ] || { echo "$IMAGE is not pulled on this host" >&2; exit 1; }
CORE_VERSION="$(sudo docker run --rm "$IMAGE" openclaw --version 2>/dev/null | awk '{ print $2 }' || true)"
[ -n "$CORE_VERSION" ] || { echo "cannot read the core version from $IMAGE" >&2; exit 1; }

# The snapshots hold WhatsApp credentials and the gateway token: operator-only.
sudo install -d -m 700 "$BACKUP_DIR"
sudo docker pull -q "$SNAPSHOT_IMAGE" >/dev/null

admin_listing() {
  curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/v1/admin/instances"
}
row_status() {
  admin_listing | python3 -c '
import json, sys
rows = [r["instance"] for r in json.load(sys.stdin)["data"] if r["instance"]["id"] == sys.argv[1]]
print(rows[0]["status"] if rows else "missing")' "$1"
}

LISTING="$(admin_listing)" || { echo "admin listing failed: token rejected or api down" >&2; exit 1; }
LIST="$(printf '%s' "$LISTING" | python3 -c '
import sys, json
for row in json.load(sys.stdin)["data"]:
    i = row["instance"]
    if i.get("runtimeKind") != "openclaw":
        continue
    has_wa = any(c.get("type") == "whatsapp" for c in (i["config"].get("channels") or []))
    print("\t".join([i["id"], i["userId"], i.get("containerId") or "-", i["status"],
                     json.dumps(i["config"]["displayName"]), "1" if has_wa else "0"]))
')"

ok=(); failed=(); skipped=(); matched=0
while IFS=$'\t' read -r ID USER_ID CONTAINER STATUS NAME_JSON HAS_WA; do
  [ -n "$ID" ] || continue
  NAME="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]))' "$NAME_JSON")"
  CNAME=""
  if [ "$CONTAINER" != "-" ]; then
    CNAME="$(sudo docker inspect --format '{{.Name}}' "$CONTAINER" 2>/dev/null | sed 's#^/##' || true)"
  fi
  # The orchestrator names containers openclaw-<12 hex>; a stale row id must not hide the tenant.
  CNAME="${CNAME:-openclaw-${ID:0:12}}"
  LABEL="$CNAME ($NAME)"
  if [ -n "$ONLY" ] && [ "$ONLY" != "$CONTAINER" ] && [ "$ONLY" != "$CNAME" ] && [ "$ONLY" != "$NAME" ]; then
    continue
  fi
  matched=$((matched + 1))
  if [ "$CONTAINER" = "-" ]; then
    echo "=== skipped $LABEL: no container on record, status=$STATUS ==="; skipped+=("$CNAME"); continue
  fi
  # recreate only accepts a live instance; a stopped one gets the new image on its next start.
  case "$STATUS" in
    running|degraded|unhealthy|error) ;;
    *) echo "=== skipped $LABEL: status=$STATUS ==="; skipped+=("$CNAME"); continue ;;
  esac
  CURRENT="$(sudo docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
  if [ "$FORCE" = 0 ] && [ "$CURRENT" = "$TARGET_ID" ]; then
    echo "=== skipped $LABEL: already on the target image ==="; skipped+=("$CNAME"); continue
  fi
  echo "=== $LABEL, status=$STATUS, ${CURRENT:0:19} -> ${TARGET_ID:0:19} ==="
  if [ "$DRY_RUN" = 1 ]; then echo "  would recreate"; continue; fi

  set +e
  (
    set -euo pipefail
    # The snapshot lands on the disk that holds every tenant volume; never fill it.
    AVAIL_KB="$(df --output=avail -k "$BACKUP_DIR" | tail -1)"
    [ "$AVAIL_KB" -ge "$MIN_FREE_KB" ] || { echo "  under 5 GiB free on the disk" >&2; exit 1; }
    # Live snapshot of the volume as it was under the old image; consistent enough for a rollback
    # to that image, whose stores are JSON files.
    VOLUME="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/node/.openclaw"}}{{.Name}}{{end}}{{end}}' "$CONTAINER")"
    [ -n "$VOLUME" ] || { echo "  no state volume mounted" >&2; exit 1; }
    SNAPSHOT="$VOLUME-pre-$STAMP.tar.gz"
    sudo docker run --rm -v "$VOLUME:/st:ro" -v "$BACKUP_DIR:/out" "$SNAPSHOT_IMAGE" \
      tar -czf "/out/$SNAPSHOT" -C /st .
    sudo chmod 600 "$BACKUP_DIR/$SNAPSHOT"
    echo "  volume snapshot: $BACKUP_DIR/$SNAPSHOT"

    # Worst case server-side: doctor 15 min + plugin install 5 min + 2 min health wait.
    RESP="$(mktemp)"
    CODE="$(curl -sS -m 1500 -X POST "$API/api/v1/instances/$ID/recreate" \
      -H "Authorization: Bearer $TOKEN" -H "x-act-as-user: $USER_ID" -o "$RESP" -w '%{http_code}' || true)"
    case "$CODE" in
      2*) rm -f "$RESP" ;;
      *) echo "  recreate returned ${CODE:-no response}: $(head -c 300 "$RESP")" >&2; rm -f "$RESP"; exit 1 ;;
    esac

    # The container id changes, so every check below has to resolve it again by name.
    NEW=""
    for _ in $(seq 1 30); do
      NEW="$(sudo docker ps -q --filter "name=^/${CNAME}$")"
      [ -n "$NEW" ] && break
      sleep 4
    done
    [ -n "$NEW" ] || { echo "  no container came back" >&2; exit 1; }
    [ "$(sudo docker inspect --format '{{.Image}}' "$NEW")" = "$TARGET_ID" ] \
      || { echo "  came back on the wrong image" >&2; exit 1; }

    for _ in $(seq 1 45); do
      [ "$(sudo docker inspect --format '{{.State.Health.Status}}' "$NEW")" = "healthy" ] && break
      sleep 4
    done
    [ "$(sudo docker inspect --format '{{.State.Health.Status}}' "$NEW")" = "healthy" ] \
      || { echo "  never became healthy" >&2; exit 1; }

    # The tenant's own config must survive the swap: OpenClaw restores its last-good over an
    # externally written file, so a missing orchestrator-owned key means the patch was reverted.
    # Doctor keeps plugin entries on its own, so the heartbeat is the key that proves the patch.
    for key in '"agentforall-credit"' '"agentforall"' '"heartbeat"'; do
      sudo docker exec "$NEW" grep -q "$key" /home/node/.openclaw/openclaw.json \
        || { echo "  config lost $key" >&2; exit 1; }
    done
    # An entry is not a loaded plugin: one installed from a path that no longer exists stays in
    # the config and silently fails to load. The boot line names what actually loaded; a channel
    # plugin is loaded only when its channel is configured.
    for p in $([ "$HAS_WA" = 1 ] && echo whatsapp) agentforall-credit agentforall-media; do
      sudo docker logs "$NEW" 2>&1 | grep "http server listening" | tail -1 | grep -qF -- "$p" \
        || { echo "  plugin $p did not load; run rollout-plugin.sh" >&2; exit 1; }
    done
    # The WhatsApp plugin lives in the volume, channel or not, and must match the core.
    sudo docker exec "$NEW" openclaw plugins list --json 2>/dev/null | python3 -c '
import json, sys
want = sys.argv[1]
found = [p for p in json.load(sys.stdin).get("plugins", []) if p.get("id") == "whatsapp"]
got = found[0].get("version") if found else None
if got != want:
    print("  whatsapp plugin is %s, core is %s" % (got, want))
    sys.exit(1)' "$CORE_VERSION" || exit 1
    # The gateway's own startup state, independent of channel links.
    sudo docker exec "$NEW" curl -fsS http://127.0.0.1:18789/startupz >/dev/null \
      || { echo "  /startupz not 200" >&2; exit 1; }
    # Migration state is proven by the boot (/startupz) and a valid config. Doctor's findings are the
    # tenant's own policy audit (open DMs, unreachable MCP servers, plaintext tokens): shown, not
    # fatal; doctor may exit non-zero on warnings alone, hence the || true on its exit code only.
    sudo docker exec "$NEW" openclaw config validate >/dev/null 2>&1 \
      || { echo "  config does not validate" >&2; exit 1; }
    (sudo docker exec "$NEW" openclaw doctor --json 2>/dev/null || true) | python3 -c '
import json, sys
try:
    findings = json.loads(sys.stdin.read()).get("findings", [])
except ValueError:
    print("  doctor produced no report")
    sys.exit(1)
for f in findings:
    print("  doctor [%s]: %s" % (f.get("severity") or f.get("level"), str(f.get("message"))[:120]))'
    sudo docker exec "$NEW" grep -q 'agentforall:begin' /home/node/.openclaw/workspace/AGENTS.md \
      || { echo "  workspace guidance missing" >&2; exit 1; }
    # The container is up; the row must agree, or the dashboard shows a healthy bot as off.
    ROW="$(row_status "$ID")"
    case "$ROW" in
      running|degraded|unhealthy) ;;
      *) echo "  db status is $ROW after a healthy recreate" >&2; exit 1 ;;
    esac
    echo "  ok: on the target image, healthy, migrated, config intact, whatsapp plugin $CORE_VERSION"
  )
  RC=$?
  set -e
  if [ "$RC" -eq 0 ]; then
    ok+=("$CNAME")
  else
    failed+=("$CNAME"); echo "  FAILED (rc=$RC)"
    if [ "$KEEP_GOING" = 0 ]; then echo "stopping at the first failure (--keep-going to continue)"; break; fi
  fi
done <<< "$LIST"

if [ -n "$ONLY" ] && [ "$matched" -eq 0 ]; then
  echo "--only '$ONLY' matched no tenant" >&2; exit 1
fi
echo
echo "ok (${#ok[@]}): ${ok[*]:-}"
echo "skipped (${#skipped[@]}): ${skipped[*]:-}"
echo "failed (${#failed[@]}): ${failed[*]:-}"
[ "${#failed[@]}" -eq 0 ]
