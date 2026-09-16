#!/usr/bin/env bash
# Bakes the worker VM image: Ubuntu 24.04 + Docker + ops agent + the pinned runtime images, so a worker boots in
# seconds and never installs anything. Runs from the repo root with gcloud and terraform on PATH.
# Usage: infra/images/worker/bake.sh --project <id> --zone <zone> [--family agent-forall-worker]
set -euo pipefail

PROJECT=""
ZONE=""
FAMILY="agent-forall-worker"
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --zone) ZONE="$2"; shift 2 ;;
    --family) FAMILY="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$PROJECT" ] && [ -n "$ZONE" ] || { echo "usage: $0 --project <id> --zone <zone>" >&2; exit 2; }

HERE=$(cd "$(dirname "$0")" && pwd)
INFRA=$(cd "$HERE/../.." && pwd)
STAMP=$(date -u +%Y%m%d-%H%M)
VM="worker-bake-$STAMP"
IMAGE="$FAMILY-$STAMP"
REGION="${ZONE%-*}"
SERVICE_ACCOUNT="agent-forall-worker@$PROJECT.iam.gserviceaccount.com"
# The pinned images come from the configuration, not from outputs (those land in state only after a full apply).
PINNED=$(echo '[var.agent_runtime_image, var.hermes_runtime_image, var.pairing_image]' | terraform -chdir="$INFRA" console | tr -d '[]", \r' | sed '/^$/d')

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# gcloud is a native binary: under Git Bash it needs Windows paths.
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
{
  echo '#!/bin/bash'
  echo 'set -euo pipefail'
  echo 'exec > >(tee -a /var/log/agent-forall-bake.log) 2>&1'
  cat "$INFRA/startup/install-docker.sh"
  cat "$HERE/bake-steps.sh"
} > "$WORK/startup.sh"
printf '%s\n' $PINNED > "$WORK/pinned-images"

echo "creating $VM"
gcloud compute instances create "$VM" --project="$PROJECT" --zone="$ZONE" \
  --machine-type=e2-standard-2 --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=60GB --boot-disk-type=pd-balanced --no-address \
  --service-account="$SERVICE_ACCOUNT" --scopes=cloud-platform \
  --metadata-from-file=startup-script="$(native "$WORK/startup.sh")",pinned-images="$(native "$WORK/pinned-images")" \
  --metadata=gar-host="$REGION-docker.pkg.dev",enable-guest-attributes=TRUE --quiet >/dev/null

# The bake script powers the VM off when done and leaves a guest attribute; the serial log dies with the VM.
echo "waiting for the bake to finish (the VM stops itself)"
STATUS=""
for _ in $(seq 1 60); do
  STATUS=$(gcloud compute instances describe "$VM" --project="$PROJECT" --zone="$ZONE" --format='value(status)')
  [ "$STATUS" = "TERMINATED" ] && break
  sleep 20
done
if [ "$STATUS" != "TERMINATED" ]; then
  echo "bake did not finish in 20 minutes; inspect: gcloud compute instances get-serial-port-output $VM --zone=$ZONE" >&2
  exit 1
fi
RESULT=$(gcloud compute instances get-guest-attributes "$VM" --project="$PROJECT" --zone="$ZONE" --query-path=bake/status --format='value(value)' 2>/dev/null || true)
if [ "$RESULT" != "complete" ]; then
  echo "bake stopped without completing; start $VM and read /var/log/agent-forall-bake.log" >&2
  exit 1
fi

echo "creating image $IMAGE"
gcloud compute images create "$IMAGE" --project="$PROJECT" --source-disk="$VM" --source-disk-zone="$ZONE" --family="$FAMILY" --storage-location="$REGION" --quiet >/dev/null
gcloud compute instances delete "$VM" --project="$PROJECT" --zone="$ZONE" --quiet >/dev/null
echo "image ready: $IMAGE (set worker_image = \"$IMAGE\" in terraform.tfvars)"
