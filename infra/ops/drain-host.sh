#!/usr/bin/env bash
# Moves bots off one host, one at a time, through the orchestrator's move API. Run with sudo on the control-plane VM.
# Nothing is rehearsed: the move checks room, size, pairing and retained volumes itself before it stops the bot,
# and the API's dryRun stops and exports the bot for real. A bot must come back the way it left (running and
# healthy with a heartbeat from after the move, or stopped); the run stops at the first one that does not.
# Usage: sudo bash drain-host.sh --from <hostId> --to <hostId> [--only <instanceId>] [--limit N] [--list]
set -euo pipefail
# String comparison of ISO timestamps must be byte-wise.
export LC_ALL=C

FROM=""
TO=""
ONLY=""
LIMIT=0
LIST_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --from|--to|--only|--limit)
      [ $# -ge 2 ] || { echo "$1 needs a value" >&2; exit 2; }
      case "$1" in --from) FROM="$2" ;; --to) TO="$2" ;; --only) ONLY="$2" ;; --limit) LIMIT="$2" ;; esac
      shift 2 ;;
    --list) LIST_ONLY=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$FROM" ] && [ -n "$TO" ] || { echo "--from and --to are required" >&2; exit 2; }
[ "$FROM" != "$TO" ] || { echo "--from and --to are the same host" >&2; exit 2; }
[[ "$LIMIT" =~ ^[0-9]+$ ]] || { echo "--limit takes a number" >&2; exit 2; }

SETTLE_TIMEOUT_S=300
POLL_S=10

# agent-forall-admin prints the body, then a line "http <code> in <seconds>s".
api() {
  local out
  out=$(agent-forall-admin "$@")
  CODE=$(printf '%s\n' "$out" | sed -n 's/^http \([0-9]*\) in .*/\1/p' | tail -1)
  BODY=$(printf '%s\n' "$out" | sed '/^http [0-9]* in /d')
}

# Sets ROWS to "<id> <status> <hostId> <healthFailures> <lastSeenAt|->" per live bot; false when the API does not answer.
fleet() {
  api GET /api/v1/admin/instances || return 1
  [ "$CODE" = "200" ] || return 1
  ROWS=$(printf '%s' "$BODY" | python3 -c '
import json, sys
for row in json.load(sys.stdin)["data"]:
    i = row["instance"]
    print(i["id"], i["status"], i["hostId"], i["healthFailures"], i.get("lastSeenAt") or "-")
')
}

fleet || { echo "admin list failed (http ${CODE:-none})" >&2; exit 1; }
mapfile -t BOTS < <(awk -v from="$FROM" -v only="$ONLY" '$3 == from && (only == "" || $1 == only) { print $1, $2 }' <<<"$ROWS")
[ "${#BOTS[@]}" -gt 0 ] || { echo "no bots on $FROM${ONLY:+ matching $ONLY}"; exit 0; }
echo "${#BOTS[@]} bot(s) on $FROM"

# Every bot is judged before any moves: one in a bad state must not surface halfway through the run.
for entry in "${BOTS[@]}"; do
  case "${entry##* }" in
    running|degraded|unhealthy|stopped) ;;
    *) echo "${entry%% *} is ${entry##* }: not a state to move from; fix it first" >&2; exit 1 ;;
  esac
  [ "$LIST_ONLY" = "1" ] && echo "$entry"
done
[ "$LIST_ONLY" = "1" ] && exit 0

moved=0
for entry in "${BOTS[@]}"; do
  id="${entry%% *}"
  before="${entry##* }"
  expect="running"
  [ "$before" = "stopped" ] && expect="stopped"

  echo "$id ($before): moving to $TO"
  api POST "/api/v1/admin/instances/$id/move" "{\"targetHostId\":\"$TO\"}"
  [ "$CODE" = "204" ] || { echo "$id: move failed (http $CODE): $BODY" >&2; exit 1; }
  # Taken after the move returns: only a heartbeat written on the target counts.
  started=$(date -u +%Y-%m-%dT%H:%M:%S)

  waited=0
  while :; do
    if fleet; then
      read -r status host failures seen <<<"$(awk -v id="$id" '$1 == id { print $2, $3, $4, $5 }' <<<"$ROWS")"
      if [ "$host" = "$TO" ] && [ "$status" = "$expect" ]; then
        [ "$expect" = "stopped" ] && break
        if [ "$failures" = "0" ] && [ "$seen" != "-" ] && [[ "$seen" > "$started" ]]; then break; fi
      fi
      last="status=$status host=$host failures=$failures seen=$seen"
    else
      last="the admin API did not answer (http ${CODE:-none})"
    fi
    if [ "$waited" -ge "$SETTLE_TIMEOUT_S" ]; then
      echo "$id: not settled on $TO after ${SETTLE_TIMEOUT_S}s: $last" >&2
      exit 1
    fi
    sleep "$POLL_S"
    waited=$((waited + POLL_S))
  done
  echo "$id: $status on $TO"

  moved=$((moved + 1))
  if [ "$LIMIT" -gt 0 ] && [ "$moved" -ge "$LIMIT" ]; then
    echo "limit of $LIMIT reached"
    break
  fi
done
echo "done: $moved moved"
