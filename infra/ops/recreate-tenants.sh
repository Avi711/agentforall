#!/usr/bin/env bash
# Rebuilds bots onto the orchestrator's runtime image, one at a time, through the admin API, on whichever host each
# lives. The orchestrator snapshots the volume, migrates it and converges our plugins; this only loops and checks.
# A bot is rebuilt when it is off the image, fails a check, or --force is given. Stopped bots are rebuilt by their next start.
# Usage: sudo bash recreate-tenants.sh --image <ref> [--only <instanceId|containerName>] [--force] [--keep-going] [--list]
set -euo pipefail
# String comparison of ISO timestamps must be byte-wise.
export LC_ALL=C

IMAGE=""
ONLY=""
FORCE=0
KEEP_GOING=0
LIST_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --image|--only)
      [ $# -ge 2 ] || { echo "$1 needs a value" >&2; exit 2; }
      if [ "$1" = "--image" ]; then IMAGE="$2"; else ONLY="$2"; fi
      shift 2 ;;
    --force) FORCE=1; shift ;;
    --keep-going) KEEP_GOING=1; shift ;;
    --list) LIST_ONLY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$IMAGE" ] || { echo "--image is required: the ref the bots must end up on" >&2; exit 2; }

SETTLE_TIMEOUT_S=300
POLL_S=10

# agent-forall-admin prints the body, then a line "http <code> in <seconds>s".
api() {
  local out
  CODE=""
  out=$(agent-forall-admin "$@")
  CODE=$(printf '%s\n' "$out" | sed -n 's/^http \([0-9]*\) in .*/\1/p' | tail -1)
  BODY=$(printf '%s\n' "$out" | sed '/^http [0-9]* in /d')
}

# Sets ROWS to "<id> <status> <containerName> <healthFailures> <lastSeenAt|-> <runtimeKind>" per live bot.
fleet() {
  api GET /api/v1/admin/instances || return 1
  [ "$CODE" = "200" ] || return 1
  ROWS=$(printf '%s' "$BODY" | python3 -c '
import json, sys
for row in json.load(sys.stdin)["data"]:
    i = row["instance"]
    print(i["id"], i["status"], i["containerName"], i["healthFailures"], i.get("lastSeenAt") or "-", i.get("runtimeKind") or "-")
')
}

# Sets V_IMAGE, V_ON_IMAGE and V_FAILED (one failed check per line) from the verify report of bot $1; false when it has none.
verify() {
  local parsed
  api GET "/api/v1/admin/instances/$1/verify" || return 1
  [ "$CODE" = "200" ] || return 1
  parsed=$(printf '%s' "$BODY" | python3 -c '
import json, sys
v = json.load(sys.stdin)
print(v["image"])
print("1" if v["onCurrentImage"] else "0")
for c in v["checks"]:
    if not c["ok"]:
        print("%s: %s" % (c["name"], c["detail"]))
')
  V_IMAGE=$(sed -n 1p <<<"$parsed")
  V_ON_IMAGE=$(sed -n 2p <<<"$parsed")
  V_FAILED=$(sed -n '3,$p' <<<"$parsed")
}

print_failed_checks() {
  [ -n "$V_FAILED" ] || return 0
  while IFS= read -r line; do echo "  check failed: $line"; done <<<"$V_FAILED"
}

fleet || { echo "admin list failed (http ${CODE:-none})" >&2; exit 1; }
mapfile -t BOTS < <(awk -v only="$ONLY" '$6 == "openclaw" && (only == "" || $1 == only || $3 == only) { print $1, $2, $3 }' <<<"$ROWS")
# A typo in --only must not read as a clean run.
[ "${#BOTS[@]}" -gt 0 ] || { echo "no openclaw bot${ONLY:+ matches $ONLY}" >&2; exit 1; }

ok=(); skipped=(); failed=()
for entry in "${BOTS[@]}"; do
  read -r id status cname <<<"$entry"
  label="$cname ($id)"
  # The same set the orchestrator's recreate accepts.
  case "$status" in
    running|degraded|unhealthy|error) ;;
    *) echo "=== skipped $label: status=$status ==="; skipped+=("$cname"); continue ;;
  esac

  if ! verify "$id"; then
    echo "=== $label: no verify report (http ${CODE:-none}): $BODY ===" >&2
    failed+=("$cname")
    if [ "$KEEP_GOING" = "1" ]; then continue; else break; fi
  fi
  # The orchestrator builds from its own configured image; a mismatch would rebuild bots onto something else than asked.
  [ "$V_IMAGE" = "$IMAGE" ] || { echo "the orchestrator's runtime image is $V_IMAGE, not $IMAGE" >&2; exit 1; }
  if [ "$V_ON_IMAGE" = "1" ] && [ -z "$V_FAILED" ] && [ "$FORCE" = "0" ]; then
    echo "=== skipped $label: on the image, every check passes ==="; skipped+=("$cname"); continue
  fi
  echo "=== $label, status=$status, on the image: $V_ON_IMAGE ==="
  print_failed_checks
  [ "$LIST_ONLY" = "1" ] && continue

  rc=0
  api POST "/api/v1/admin/instances/$id/recreate"
  if [ "$CODE" != "204" ]; then
    echo "  recreate failed (http ${CODE:-none}): $BODY" >&2; rc=1
  else
    # Taken after the call returns: only a heartbeat from the new container counts.
    started=$(date -u +%Y-%m-%dT%H:%M:%S)
    waited=0
    while :; do
      if fleet; then
        read -r now failures seen <<<"$(awk -v id="$id" '$1 == id { print $2, $4, $5 }' <<<"$ROWS")"
        if [ "$now" = "running" ] && [ "$failures" = "0" ] && [ "$seen" != "-" ] && [[ "$seen" > "$started" ]]; then break; fi
        last="status=$now failures=$failures seen=$seen"
      else
        last="the admin API did not answer (http ${CODE:-none})"
      fi
      if [ "$waited" -ge "$SETTLE_TIMEOUT_S" ]; then echo "  not healthy after ${SETTLE_TIMEOUT_S}s: $last" >&2; rc=1; break; fi
      sleep "$POLL_S"
      waited=$((waited + POLL_S))
    done
  fi
  if [ "$rc" = "0" ]; then
    if ! verify "$id"; then
      echo "  no verify report after the rebuild (http ${CODE:-none}): $BODY" >&2; rc=1
    else
      [ "$V_ON_IMAGE" = "1" ] || { echo "  came back off the image" >&2; rc=1; }
      [ -z "$V_FAILED" ] || { print_failed_checks >&2; rc=1; }
    fi
  fi

  if [ "$rc" = "0" ]; then
    echo "  ok: on the image, healthy, every check passes"; ok+=("$cname")
  else
    failed+=("$cname")
    if [ "$KEEP_GOING" = "0" ]; then echo "stopping at the first failure (--keep-going to continue)"; break; fi
  fi
done

[ "$LIST_ONLY" = "1" ] && exit 0
echo
echo "ok (${#ok[@]}): ${ok[*]:-}"
echo "skipped (${#skipped[@]}): ${skipped[*]:-}"
echo "failed (${#failed[@]}): ${failed[*]:-}"
[ "${#failed[@]}" -eq 0 ]
