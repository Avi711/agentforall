#!/usr/bin/env bash
# Rolls one of our OpenClaw plugins out to tenants created before the image carried it: an image
# upgrade does not refresh plugins, they live in the tenant's state volume.
# Runs on the VM. Requires the orchestrator that renders the plugin entry to be deployed first.
# Safe to rerun; a tenant that already has everything just gets one more restart.
# Usage: bash rollout-plugin.sh <image-ref> --plugin <name> --sentinel <file-in-plugin-dir>
#          [--verify-env VAR] [--verify-hooks] [--only <container-id-or-name>] [--dry-run]
# Credit: bash rollout-plugin.sh IMG --plugin agentforall-credit --sentinel budget.js --verify-env AGENTFORALL_CREDIT_API_KEY --verify-hooks --require-provider litellm
# Media:  bash rollout-plugin.sh IMG --plugin agentforall-media --sentinel provider.js --verify-env AGENTFORALL_MEDIA_API_KEY
set -euo pipefail

IMG="$1"; shift
PLUGIN=""
SENTINEL=""
VERIFY_ENV=""
VERIFY_HOOKS=0
REQUIRE_PROVIDER=""
ONLY=""
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --plugin) PLUGIN="$2"; shift 2 ;;
    --sentinel) SENTINEL="$2"; shift 2 ;;
    --verify-env) VERIFY_ENV="$2"; shift 2 ;;
    --verify-hooks) VERIFY_HOOKS=1; shift ;;
    --require-provider) REQUIRE_PROVIDER="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$PLUGIN" ] || { echo "--plugin is required" >&2; exit 2; }
[ -n "$SENTINEL" ] || { echo "--sentinel is required: a file that must exist in the staged plugin" >&2; exit 2; }

API="https://api.agentforall.co.il"
ENV_FILE="/home/deploy/agent-forall/.env.runtime"
TOKEN="$(sudo grep '^SERVICE_TOKENS=' "$ENV_FILE" | cut -d= -f2- | cut -d, -f1 | tr -d '"' )"
[ -n "$TOKEN" ] || { echo "no SERVICE_TOKENS in $ENV_FILE" >&2; exit 1; }

STAGE="$HOME/$PLUGIN-rollout-$(date +%s)"
mkdir -p "$STAGE"
sudo docker pull "$IMG" >/dev/null 2>&1
CID="$(sudo docker create "$IMG")"
# The copy fails on an image that predates the plugin; the container must not outlive it.
trap 'sudo docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
sudo docker cp "$CID:/opt/$PLUGIN" "$STAGE/"
sudo docker rm "$CID" >/dev/null
trap - EXIT
[ -f "$STAGE/$PLUGIN/$SENTINEL" ] || { echo "staged $PLUGIN is missing $SENTINEL: wrong image?" >&2; exit 1; }

LISTING="$(curl -sf -H "Authorization: Bearer $TOKEN" "$API/api/v1/admin/instances")" \
  || { echo "admin listing failed: token rejected or api down" >&2; exit 1; }
# id \t userId \t containerId \t status \t provider \t baseUrl ("-" when direct) \t
# displayName as a JSON string (ASCII-escaped, so it survives the shell byte-for-byte).
LIST="$(printf '%s' "$LISTING" | python3 -c '
import sys, json
for row in json.load(sys.stdin)["data"]:
    i = row["instance"]
    if i.get("runtimeKind") != "openclaw" or not i.get("containerId"):
        continue
    p = i["config"]["provider"]
    print("\t".join([i["id"], i["userId"], i["containerId"], i["status"],
                     p["name"], p.get("baseUrl") or "-", json.dumps(i["config"]["displayName"])]))
')"

started_at() { sudo docker inspect --format '{{.State.StartedAt}}' "$1"; }

ok=(); failed=(); skipped=()
while IFS=$'\t' read -r ID USER_ID CONTAINER STATUS PROVIDER BASE_URL NAME_JSON; do
  [ -n "$ID" ] || continue
  NAME="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]))' "$NAME_JSON")"
  CNAME="$(sudo docker inspect --format '{{.Name}}' "$CONTAINER" 2>/dev/null | sed 's#^/##')"
  LABEL="${CNAME:-$CONTAINER} ($NAME)"
  if [ -n "$ONLY" ] && [ "$ONLY" != "$CONTAINER" ] && [ "$ONLY" != "$CNAME" ]; then continue; fi
  # Our plugins talk to a gateway, which is exactly what the orchestrator keys on when it renders
  # them: a provider with a baseUrl. Credit needs LiteLLM itself, hence --require-provider.
  if [ "$BASE_URL" = "-" ]; then
    echo "=== skipped $LABEL: direct provider $PROVIDER, no gateway ==="; skipped+=("${CNAME:-$CONTAINER}"); continue
  fi
  if [ -n "$REQUIRE_PROVIDER" ] && [ "$PROVIDER" != "$REQUIRE_PROVIDER" ]; then
    echo "=== skipped $LABEL: provider=$PROVIDER, needs $REQUIRE_PROVIDER ==="
    skipped+=("${CNAME:-$CONTAINER}"); continue
  fi
  # The DB status can lag; the container's own state decides whether an exec can reach it.
  if [ "$(sudo docker inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null)" != "true" ]; then
    echo "=== skipped $LABEL: container not running, db status=$STATUS ==="
    skipped+=("${CNAME:-$CONTAINER}"); continue
  fi
  echo "=== $LABEL, db status=$STATUS ==="
  if [ "$DRY_RUN" = 1 ]; then echo "  would install + restart"; continue; fi

  # `if ( set -e ... )` runs the subshell in a context where errexit is ignored — every check
  # inside would pass whatever it found. Run it outside the condition and read its status.
  set +e
  (
    set -euo pipefail
    BEFORE="$(started_at "$CONTAINER")"
    DEST="/tmp/$PLUGIN-$(date +%s)"
    sudo docker cp "$STAGE/$PLUGIN" "$CONTAINER:$DEST"
    TARBALL="$(sudo docker exec "$CONTAINER" npm pack "$DEST" --pack-destination /tmp --silent)"
    # A same-version copy makes install refuse, and uninstall strips the entry's hooks — the
    # restart below re-renders them.
    sudo docker exec "$CONTAINER" openclaw plugins uninstall "$PLUGIN" --force >/dev/null 2>&1 || true
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
    sudo docker logs --since "$AFTER" "$CONTAINER" 2>&1 | grep "http server listening" | tail -1 | grep -qF -- "$PLUGIN"
    sudo docker exec "$CONTAINER" python3 -c '
import json, sys
plugin, want_hooks = sys.argv[1], sys.argv[2] == "1"
e = json.load(open("/home/node/.openclaw/openclaw.json"))["plugins"]["entries"][plugin]
ok = bool(e.get("enabled"))
if want_hooks:
    ok = ok and bool(e.get("hooks", {}).get("allowConversationAccess"))
sys.exit(0 if ok else 1)' "$PLUGIN" "$VERIFY_HOOKS"
    if [ -n "$VERIFY_ENV" ]; then
      sudo docker exec "$CONTAINER" grep -q "^$VERIFY_ENV=" /home/node/.openclaw/.env
    fi
    echo "  ok: $PLUGIN loaded, entry enabled${VERIFY_ENV:+, $VERIFY_ENV present}"
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
