#!/usr/bin/env bash
# Rebuilds tenant containers on the orchestrator's currently configured runtime image. A container
# keeps the image it was created with, so tenants drift apart as AGENT_RUNTIME_IMAGE moves on;
# this brings them back to one image. The state volume (/home/node/.openclaw: config, credentials,
# workspace) is not touched — recreate reattaches it by name.
# Runs on the VM. Safe to rerun; a tenant already on the target image is skipped unless --force.
# The orchestrator's recreate migrates the volume before the new container boots (doctor, WhatsApp
# plugin update, config patch); a tarball of the volume is taken here first, as the rollback of
# last resort next to the disk snapshot. Our own plugins live in the volume too and are NOT
# refreshed by a recreate: run rollout-plugin.sh for each afterwards when they changed.
# Stopped tenants are skipped; they are rebuilt on the current image by their next start.
# Usage: bash recreate-tenants.sh --image <ref-or-digest> [--only <container-or-name>] [--force] [--dry-run]
set -euo pipefail

IMAGE=""
ONLY=""
FORCE=0
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$IMAGE" ] || { echo "--image is required: the ref tenants must end up on" >&2; exit 2; }

API="https://api.agentforall.co.il"
ENV_FILE="/home/deploy/agent-forall/.env.runtime"
BACKUP_DIR="/home/deploy/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
TOKEN="$(sudo grep '^SERVICE_TOKENS=' "$ENV_FILE" | cut -d= -f2- | cut -d, -f1 | tr -d '"')"
[ -n "$TOKEN" ] || { echo "no SERVICE_TOKENS in $ENV_FILE" >&2; exit 1; }

# The orchestrator creates from its own AGENT_RUNTIME_IMAGE, so a mismatch here would silently
# rebuild tenants onto something other than what was asked for.
PINNED="$(sudo grep '^AGENT_RUNTIME_IMAGE=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
[ "$PINNED" = "$IMAGE" ] || { echo "AGENT_RUNTIME_IMAGE is $PINNED, not $IMAGE" >&2; exit 1; }
TARGET_ID="$(sudo docker image inspect --format '{{.Id}}' "$IMAGE")"

LISTING="$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/v1/admin/instances")" \
  || { echo "admin listing failed: token rejected or api down" >&2; exit 1; }
LIST="$(printf '%s' "$LISTING" | python3 -c '
import sys, json
for row in json.load(sys.stdin)["data"]:
    i = row["instance"]
    if i.get("runtimeKind") != "openclaw" or not i.get("containerId"):
        continue
    has_wa = any(c.get("type") == "whatsapp" for c in (i["config"].get("channels") or []))
    print("\t".join([i["id"], i["userId"], i["containerId"], i["status"],
                     json.dumps(i["config"]["displayName"]), "1" if has_wa else "0"]))
')"

ok=(); failed=(); skipped=()
while IFS=$'\t' read -r ID USER_ID CONTAINER STATUS NAME_JSON HAS_WA; do
  [ -n "$ID" ] || continue
  NAME="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]))' "$NAME_JSON")"
  CNAME="$(sudo docker inspect --format '{{.Name}}' "$CONTAINER" 2>/dev/null | sed 's#^/##')"
  LABEL="${CNAME:-$CONTAINER} ($NAME)"
  if [ -n "$ONLY" ] && [ "$ONLY" != "$CONTAINER" ] && [ "$ONLY" != "$CNAME" ]; then continue; fi
  # recreate only accepts a live instance; a stopped one gets the new image on its next start.
  case "$STATUS" in
    running|degraded|unhealthy|error) ;;
    *) echo "=== skipped $LABEL: status=$STATUS ==="; skipped+=("${CNAME:-$CONTAINER}"); continue ;;
  esac
  CURRENT="$(sudo docker inspect --format '{{.Image}}' "$CONTAINER" 2>/dev/null || true)"
  if [ "$FORCE" = 0 ] && [ "$CURRENT" = "$TARGET_ID" ]; then
    echo "=== skipped $LABEL: already on the target image ==="; skipped+=("${CNAME:-$CONTAINER}"); continue
  fi
  echo "=== $LABEL, status=$STATUS, ${CURRENT:0:19} -> ${TARGET_ID:0:19} ==="
  if [ "$DRY_RUN" = 1 ]; then echo "  would recreate"; continue; fi

  set +e
  (
    set -euo pipefail
    # Live snapshot of the volume as it was under the old image; consistent enough for a rollback
    # to that image, whose stores are JSON files.
    VOLUME="$(sudo docker inspect --format '{{range .Mounts}}{{if eq .Destination "/home/node/.openclaw"}}{{.Name}}{{end}}{{end}}' "$CONTAINER")"
    [ -n "$VOLUME" ] || { echo "  no state volume mounted" >&2; exit 1; }
    sudo mkdir -p "$BACKUP_DIR"
    sudo docker run --rm -v "$VOLUME:/st:ro" -v "$BACKUP_DIR:/out" alpine \
      tar -czf "/out/$VOLUME-pre-$STAMP.tar.gz" -C /st .
    echo "  volume snapshot: $BACKUP_DIR/$VOLUME-pre-$STAMP.tar.gz"

    # Worst case server-side: doctor 15 min + plugin update 5 min + 2 min health wait.
    curl -sf -m 1500 -X POST "$API/api/v1/instances/$ID/recreate" \
      -H "Authorization: Bearer $TOKEN" -H "x-act-as-user: $USER_ID" -o /dev/null

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
    # externally written file, so a missing entry means the rendered config was reverted.
    sudo docker exec "$NEW" grep -q '"agentforall-credit"' /home/node/.openclaw/openclaw.json \
      || { echo "  config lost its plugin entries" >&2; exit 1; }
    sudo docker exec "$NEW" grep -q '"agentforall"' /home/node/.openclaw/openclaw.json \
      || { echo "  config has no MCP relay entry" >&2; exit 1; }
    # An entry is not a loaded plugin: one installed from a path that no longer exists stays in
    # the config and silently fails to load. The boot line names what actually loaded; a channel
    # plugin is loaded only when its channel is configured.
    for p in $([ "$HAS_WA" = 1 ] && echo whatsapp) agentforall-credit agentforall-media; do
      sudo docker logs "$NEW" 2>&1 | grep "http server listening" | tail -1 | grep -qF -- "$p" \
        || { echo "  plugin $p did not load; run rollout-plugin.sh" >&2; exit 1; }
    done
    # The gateway's own startup state, independent of channel links.
    sudo docker exec "$NEW" curl -fsS http://127.0.0.1:18789/startupz >/dev/null \
      || { echo "  /startupz not 200" >&2; exit 1; }
    # Migration state is proven by the boot (/startupz) and a valid config. Doctor's findings are the
    # tenant's own policy audit (open DMs, unreachable MCP servers, plaintext tokens): shown, not fatal.
    sudo docker exec "$NEW" openclaw config validate >/dev/null 2>&1 \
      || { echo "  config does not validate" >&2; exit 1; }
    (sudo docker exec "$NEW" openclaw doctor --json 2>/dev/null || true) | python3 -c '
import json, sys
for f in json.load(sys.stdin).get("findings", []):
    print("  doctor [%s]: %s" % (f.get("severity") or f.get("level"), str(f.get("message"))[:120]))' || true
    sudo docker exec "$NEW" grep -q 'agentforall:begin' /home/node/.openclaw/workspace/AGENTS.md \
      || { echo "  workspace guidance missing" >&2; exit 1; }
    echo "  ok: on the target image, healthy, migrated, config intact"
  )
  RC=$?
  set -e
  if [ "$RC" -eq 0 ]; then ok+=("$CNAME"); else failed+=("$CNAME"); echo "  FAILED (rc=$RC)"; fi
done <<< "$LIST"

echo
echo "ok (${#ok[@]}): ${ok[*]:-}"
echo "skipped (${#skipped[@]}): ${skipped[*]:-}"
echo "failed (${#failed[@]}): ${failed[*]:-}"
[ "${#failed[@]}" -eq 0 ]
