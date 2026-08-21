# Security & Production-Hardening TODO

Status: beta-grade. Each item below moves the bar toward L7 production.
Priority order = roughly the order to ship.

---

## Easy (1-2 days each)

### S-1. Per-tenant rate limit on pair endpoints
- **Risk:** one user spamming `POST /api/v1/instances/:id/pair` can exhaust the
  `PORT_RANGE_START..PORT_RANGE_END` pool and DoS new pairings.
- **Fix:** Fastify `@fastify/rate-limit` per-userId bucket on `/pair`,
  `/pair/code`, `/pair/qr`. Reuse existing limiter config.
- **Files:** `apps/orchestrator/src/server.ts`, `apps/orchestrator/src/routes/pair.ts`.

### S-2. Logout sidecar on bot delete
- **Risk:** removing a bot kills the container with `docker rm -f` but doesn't
  call `sock.logout()` — WhatsApp keeps the entry in the user's "linked
  devices" list until they remove it manually.
- **Fix:** spawn a one-shot pairing sidecar in `LOGOUT_MODE=1`, inject creds via
  `putArchive` to its tmpfs, wait for exit, then proceed with main-container
  removal. Best-effort: if logout fails, still delete.
- **Files:** `apps/whatsapp-pairing/src/server.ts`,
  `apps/orchestrator/src/services/pairing-manager.ts`,
  `apps/orchestrator/src/services/instance-manager.ts` (`destroy()`).

### S-3. Pin sidecar + main image by digest
- **Risk:** `agent-forall/whatsapp-pairing:dev` and
  `ghcr.io/openclaw/openclaw:latest` are mutable tags — supply-chain risk.
  CI/CD or compromised registry can swap the image silently.
- **Fix:** pin both to `image@sha256:<digest>`. CI step builds, pushes,
  reads digest, writes to `apps/orchestrator/.env.example`. Optional: cosign
  signing.
- **Files:** `apps/orchestrator/.env.example`, `infra/startup.sh`, CI config.

### S-4. Per-pair token via Docker secret, not env
- **Risk:** anyone with `docker inspect` on the host (e.g. another container
  with the docker socket mounted) can read all sidecars' `PAIRING_AUTH_TOKEN`
  via env. Not a today-bug because only the orchestrator has the socket, but
  defense in depth.
- **Fix:** mount the token as a tmpfs file, sidecar reads from
  `/run/secrets/pair-token` instead of `process.env.PAIRING_AUTH_TOKEN`.
- **Files:** `apps/orchestrator/src/services/container-runtime.ts`
  (createSidecar), `apps/whatsapp-pairing/src/config.ts`.

---

## Medium (3-7 days each)

### S-5. Zero-on-use plaintext-creds buffers
- **Risk:** orchestrator holds plaintext WhatsApp creds in JS heap during
  `completePairing()` → `injectCredsIntoMain()`. A crash dump or memory inspector
  can recover them.
- **Fix:** wrap the plaintext buffer in a `secureBuffer` API that overwrites
  the underlying memory after use (`buffer.fill(0)` + null reference). Also
  audit all decrypt sites — no `let creds = decrypt(...)` left dangling in a
  closure.
- **Files:** `apps/orchestrator/src/services/crypto.ts`,
  `apps/orchestrator/src/services/pairing-manager.ts`,
  `apps/orchestrator/src/services/instance-manager.ts`.

### S-6. Audit trail on creds access
- **Risk:** no record of who decrypted which user's creds when. Forensics + GDPR
  request handling will fail.
- **Fix:** every `getDecryptedWhatsappCreds()` and config decrypt emits an
  `instance_events` row of type `creds.decrypted` with `actor` (user id, system,
  reconciler) and `reason` (provision-start, pair-complete, manual-export).
- **Files:** `apps/orchestrator/src/storage/instance-repository.ts`,
  `apps/orchestrator/src/services/event-log.ts`.

### S-7. Distributed locks for reconciler
- **Risk:** only safe with a single orchestrator instance. Two replicas would
  race on `resumeProvisioning()` and double-create containers. Today: 1
  replica, but blocks horizontal scaling.
- **Fix:** wrap each reconciler step in a Postgres `pg_try_advisory_lock(<row
  id>)`. Skip if held. No new deps.
- **Files:** `apps/orchestrator/src/services/reconciler.ts`,
  `apps/orchestrator/src/storage/instance-repository.ts`.

### S-8. WhatsApp disconnect detection
- **Risk:** when the user removes the linked device on their phone, the bot
  silently fails. UI still shows "מחובר ופעיל". Bad user experience and bad
  metric — we can't even alert.
- **Fix:** OpenClaw posts a `whatsapp.disconnected` webhook to the orchestrator
  on Baileys `loggedOut`, OR the orchestrator polls the OpenClaw gateway's
  `/status` endpoint every 30s. Either updates `pairing_status='expired'` and
  the UI flips to "לא מחובר".
- **Files:** new route in `apps/orchestrator/src/routes/`, possibly OpenClaw
  config tweak. Requires upstream OpenClaw support OR a polling worker.

### S-8a. Replace Docker-exec health probe with Gateway RPC
- **Risk:** the current production mitigation for S-8 runs OpenClaw channel
  diagnostics through Docker `exec`, which requires `EXEC: 1` on
  `docker-socket-proxy` and increases orchestrator container privileges.
- **Fix:** call OpenClaw Gateway WS/RPC health directly (`health` with
  `probe:true`, equivalent to `openclaw health --json --verbose` /
  `openclaw status --deep`). Parse WhatsApp per-channel status from JSON,
  update `pairing_status='expired'` on disconnected/logged-out states, then
  remove `EXEC: 1` from `docker-socket-proxy`.
- **Files:** `apps/orchestrator/src/services/health-monitor.ts`,
  `apps/orchestrator/src/services/container-runtime.ts`, `infra/startup.sh`.

---

## Hard (1-3 weeks each)

### S-9. Per-tenant Docker networks
- **Risk:** all containers share one bridge `agent-forall-net`. A compromised
  tenant container can probe peers' hostnames + ports. The bearer-token wall is
  the only gate; if a token leaks, lateral movement is trivial.
- **Fix:** one Docker bridge network per tenant. `network-<userId>`. Provision
  creates the network, destroy removes it. Sidecar + main container join only
  that network.
- **Complications:** reconciler must track network lifecycles. ContainerRuntime
  signature grows (`networkName: string` arg). Network names limited to ~63
  chars.
- **Files:** `apps/orchestrator/src/services/container-runtime.ts` (new
  `ensureTenantNetwork`, `removeTenantNetwork`),
  `apps/orchestrator/src/services/instance-manager.ts`,
  `apps/orchestrator/src/services/pairing-manager.ts`.

### S-10. mTLS between orchestrator and sidecar
- **Risk:** bearer token over plain HTTP on the Docker bridge. A compromised
  tenant could in theory MITM if they get on the bridge.
- **Fix:** small internal CA (e.g. `node-forge` based mint). Per-pair cert
  minted at sidecar start, expires at idle timeout. Sidecar requires client
  cert. Orchestrator presents cert. Same TLS pinning both ways.
- **Files:** `apps/orchestrator/src/services/pairing-manager.ts` (cert mint +
  pass via Docker secret), `apps/whatsapp-pairing/src/server.ts` (https +
  client cert verify).

### S-11. KMS-backed envelope encryption
- **Risk:** `ENCRYPTION_KEY` is a single env var. Lose it → all WhatsApp
  sessions are bricked. Leak it → all sessions decryptable.
- **Fix:** GCP KMS (or AWS KMS) holds a KEK. Each row gets a per-row DEK,
  encrypted by the KEK and stored alongside the ciphertext. Key rotation =
  re-encrypt-on-read. Audit log on every KMS Decrypt call.
- **Files:** `apps/orchestrator/src/services/crypto.ts` (rewrite to KMS API),
  Terraform / IaC for the KEK + service-account permissions, migration to
  re-wrap existing rows.

---

## Very hard / deferred (months)

### S-12. gVisor or Firecracker (kernel-level isolation)
- **Risk:** Docker shares the host kernel. Any kernel CVE → tenant escape.
- **Fix:** replace `runc` with `runsc` (gVisor) or move to Firecracker microVMs.
- **Reality:** most multi-tenant SaaS skip this and lean on layered defenses
  (CapDrop, no-new-privileges, per-tenant networks, KMS, mTLS). Worth
  considering only when handling truly adversarial workloads.

---

## Notes

- **Today's threat model:** vetted Israeli beta users, single VM, single
  orchestrator instance. The architecture is *shaped* correctly (broker pattern,
  layered isolation, encrypt-at-rest, atomic transitions). The gaps above are
  hardening, not bugs.
- **Realistic L7-prod path:** ship S-1..S-8 (~2-3 weeks). That passes a real
  security review for B2B SaaS handling personal WhatsApp data. Then S-9, S-11
  before adversarial multi-tenancy. Skip S-12 until there's a reason.
- **Don't build everything at once.** Each item is independent; ship in PRs.
