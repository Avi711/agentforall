#!/usr/bin/env bash
# One-time rollout of the agentforall-credit plugin to tenants created before the image carried it.
# Runs on the VM. Requires the orchestrator that renders the plugin entry to be deployed first.
# Safe to rerun; a tenant that already has everything just gets one more restart.
# Usage: bash rollout-credit-plugin.sh <image-ref> [--only <container-id-or-name>] [--dry-run]
set -euo pipefail

IMG="$1"; shift
ONLY=""
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

API="https://api.agentforall.co.il"
ENV_FILE="/home/deploy/agent-forall/.env.runtime"
TOKEN="$(sudo grep '^SERVICE_TOKENS=' "$ENV_FILE" | cut -d= -f2- | cut -d, -f1 | tr -d '"' )"
[ -n "$TOKEN" ] || { echo "no SERVICE_TOKENS in $ENV_FILE" >&2; exit 1; }

STAGE="$HOME/afcredit-rollout-$(date +%s)"
mkdir -p "$STAGE"
sudo docker pull "$IMG" >/dev/null 2>&1
CID="$(sudo docker create "$IMG")"
sudo docker cp "$CID:/opt/agentforall-credit" "$STAGE/"
sudo docker rm "$CID" >/dev/null
[ -f "$STAGE/agentforall-credit/budget.js" ] || { echo "staged plugin is missing budget.js" >&2; exit 1; }

LISTING="$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/v1/admin/instances")" \
  || { echo "admin listing failed: token rejected or api down" >&2; exit 1; }
# id \t userId \t containerId \t status \t provider \t displayName as a JSON string (ASCII-escaped,
# so it survives the shell byte-for-byte) for every openclaw instance with a container.
LIST="$(printf '%s' "$LISTING" | python3 -c '
import sys, json
for row in json.load(sys.stdin)["data"]:
    i = row["instance"]
    if i.get("runtimeKind") != "openclaw" or not i.get("containerId"):
        continue
    print("\t".join([i["id"], i["userId"], i["containerId"], i["status"],
                     i["config"]["provider"]["name"], json.dumps(i["config"]["displayName"])]))
')"

started_at() { sudo docker inspect --format '{{.State.StartedAt}}' "$1"; }

ok=(); failed=(); skipped=()
while IFS=$'\t' read -r ID USER_ID CONTAINER STATUS PROVIDER NAME_JSON; do
  [ -n "$ID" ] || continue
  NAME="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]))' "$NAME_JSON")"
  CNAME="$(sudo docker inspect --format '{{.Name}}' "$CONTAINER" 2>/dev/null | sed 's#^/##')"
  LABEL="${CNAME:-$CONTAINER} ($NAME)"
  if [ -n "$ONLY" ] && [ "$ONLY" != "$CONTAINER" ] && [ "$ONLY" != "$CNAME" ]; then continue; fi
  # Only a LiteLLM key has a budget to read; on any other provider the plugin would fail open.
  if [ "$PROVIDER" != "litellm" ]; then
    echo "=== skipped $LABEL: provider=$PROVIDER ==="; skipped+=("${CNAME:-$CONTAINER}"); continue
  fi
  # The DB status can lag; the container's own state decides whether an exec can reach it.
  if [ "$(sudo docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
    echo "=== skipped $LABEL: container not running, db status=$STATUS ==="
    skipped+=("${CNAME:-$CONTAINER}"); continue
  fi
  echo "=== $LABEL, db status=$STATUS ==="
  if [ "$DRY_RUN" = 1 ]; then echo "  would install + restart"; continue; fi

  if (
    set -euo pipefail
    BEFORE="$(started_at "$CONTAINER")"
    DEST="/tmp/agentforall-credit-$(date +%s)"
    sudo docker cp "$STAGE/agentforall-credit" "$CONTAINER:$DEST"
    TARBALL="$(sudo docker exec "$CONTAINER" npm pack "$DEST" --pack-destination /tmp --silent)"
    # A same-version copy makes install refuse, and uninstall strips the entry's hooks — the
    # restart below re-renders them.
    sudo docker exec "$CONTAINER" openclaw plugins uninstall agentforall-credit --force >/dev/null 2>&1 || true
    sudo docker exec "$CONTAINER" openclaw plugins install "npm-pack:/tmp/$TARBALL" 2>&1 | grep -E "Installed plugin" >/dev/null

    # The orchestrator's restart re-renders openclaw.json (hooks entry) and .env (credit vars) and
    # then restarts unconditionally. A config PATCH renders the same files but only restarts when
    # .env changed, which a rerun no longer has.
    curl -sf -m 300 -X POST "$API/api/v1/instances/$ID/restart" \
      -H "Authorization: Bearer $TOKEN" -H "x-act-as-user: $USER_ID" -o /dev/null

    AFTER="$BEFORE"
    for _ in $(seq 1 30); do
      AFTER="$(started_at "$CONTAINER")"
      [ "$AFTER" != "$BEFORE" ] && break
      sleep 4
    done
    [ "$AFTER" != "$BEFORE" ] || { echo "  container never restarted" >&2; exit 1; }
    for _ in $(seq 1 30); do
      if sudo docker logs --since "$AFTER" "$CONTAINER" 2>&1 | grep -q "http server listening"; then break; fi
      sleep 4
    done
    # Only lines from this boot count, so a listening line from the previous life cannot pass.
    sudo docker logs --since "$AFTER" "$CONTAINER" 2>&1 | grep "http server listening" | tail -1 | grep -q "agentforall-credit"
    sudo docker exec "$CONTAINER" python3 -c '
import json, sys
e = json.load(open("/home/node/.openclaw/openclaw.json"))["plugins"]["entries"]["agentforall-credit"]
sys.exit(0 if e.get("enabled") and e.get("hooks", {}).get("allowConversationAccess") else 1)'
    sudo docker exec "$CONTAINER" grep -q '^AGENTFORALL_CREDIT_API_KEY=' /home/node/.openclaw/.env
    echo "  ok: plugin loaded, hooks on, credit env present"
  ); then ok+=("$CNAME"); else failed+=("$CNAME"); echo "  FAILED"; fi
done <<< "$LIST"

echo
echo "ok (${#ok[@]}): ${ok[*]:-}"
echo "skipped (${#skipped[@]}): ${skipped[*]:-}"
echo "failed (${#failed[@]}): ${failed[*]:-}"
[ "${#failed[@]}" -eq 0 ]
