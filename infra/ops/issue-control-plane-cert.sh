#!/usr/bin/env bash
# Control-plane PKI for orchestrator → worker Docker over mTLS, issued offline into Secret Manager.
#   ca                      one-time: CA cert + key (the key is read back only by this script, never by a VM)
#   client                  the orchestrator's client certificate (EKU clientAuth only)
#   server <host-id> <ip>   a worker's server certificate: CN = host id, SAN = its reserved IP (EKU serverAuth only)
# dockerd checks no CRL: to revoke anything, issue a new CA and every certificate under it.
# Usage: issue-control-plane-cert.sh --project <id> (ca | client | server <host-id> <ip>)
set -euo pipefail

PROJECT=""
CA_DAYS=3650
LEAF_DAYS=730
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    *) break ;;
  esac
done
[ -n "$PROJECT" ] || { echo "usage: $0 --project <id> (ca | client | server <host-id> <ip>)" >&2; exit 2; }
COMMAND="${1:-}"

# Git Bash: openssl is a native binary (needs a Windows work path) and would take "/CN=..." for a path.
native() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
ossl() { MSYS_NO_PATHCONV=1 openssl "$@"; }
WORK=$(native "$(mktemp -d)")
trap 'rm -rf "$WORK"' EXIT
chmod 700 "$WORK"

secret_exists() { gcloud secrets describe "$1" --project="$PROJECT" >/dev/null 2>&1; }

# A secret is created once; a later issue adds a version, so rotation keeps the same IAM binding.
put_secret() {
  local name="$1" file="$2"
  if secret_exists "$name"; then
    gcloud secrets versions add "$name" --project="$PROJECT" --data-file="$file" >/dev/null
  else
    gcloud secrets create "$name" --project="$PROJECT" --replication-policy=automatic --data-file="$file" >/dev/null
  fi
  echo "secret $name written"
}

fetch_ca() {
  gcloud secrets versions access latest --secret=control-plane-ca-cert --project="$PROJECT" > "$WORK/ca.crt"
  gcloud secrets versions access latest --secret=control-plane-ca-key --project="$PROJECT" > "$WORK/ca.key"
}

issue_leaf() {
  local name="$1" subject="$2" extfile="$3"
  ossl ecparam -name prime256v1 -genkey -noout -out "$WORK/$name.key"
  ossl req -new -key "$WORK/$name.key" -subj "$subject" -out "$WORK/$name.csr"
  ossl x509 -req -in "$WORK/$name.csr" -CA "$WORK/ca.crt" -CAkey "$WORK/ca.key" -CAcreateserial \
    -days "$LEAF_DAYS" -sha256 -extfile "$extfile" -out "$WORK/$name.crt"
  put_secret "$name-cert" "$WORK/$name.crt"
  put_secret "$name-key" "$WORK/$name.key"
}

case "$COMMAND" in
  ca)
    if secret_exists control-plane-ca-cert; then
      echo "control-plane-ca-cert exists; a new CA invalidates every certificate, delete the secrets first if that is intended" >&2
      exit 1
    fi
    ossl ecparam -name prime256v1 -genkey -noout -out "$WORK/ca.key"
    cat > "$WORK/ca.cnf" <<EOF
[req]
distinguished_name = dn
[dn]
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
EOF
    ossl req -new -x509 -key "$WORK/ca.key" -subj "/CN=agent-forall control plane" -days "$CA_DAYS" -sha256 \
      -extensions v3_ca -config "$WORK/ca.cnf" -out "$WORK/ca.crt"
    put_secret control-plane-ca-cert "$WORK/ca.crt"
    put_secret control-plane-ca-key "$WORK/ca.key"
    ;;
  client)
    fetch_ca
    printf 'basicConstraints = CA:FALSE\nkeyUsage = critical, digitalSignature\nextendedKeyUsage = clientAuth\n' > "$WORK/client.ext"
    issue_leaf orchestrator-client "/CN=orchestrator" "$WORK/client.ext"
    ;;
  server)
    HOST_ID="${2:-}"; IP="${3:-}"
    [ -n "$HOST_ID" ] && [ -n "$IP" ] || { echo "usage: $0 --project <id> server <host-id> <ip>" >&2; exit 2; }
    fetch_ca
    printf 'basicConstraints = CA:FALSE\nkeyUsage = critical, digitalSignature\nextendedKeyUsage = serverAuth\nsubjectAltName = IP:%s\n' "$IP" > "$WORK/server.ext"
    issue_leaf "$HOST_ID-server" "/CN=$HOST_ID" "$WORK/server.ext"
    ;;
  *)
    echo "usage: $0 --project <id> (ca | client | server <host-id> <ip>)" >&2
    exit 2
    ;;
esac
