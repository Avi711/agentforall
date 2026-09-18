# Security & Production-Hardening TODO

Status: beta-grade. Each item below moves the bar toward L7 production.
Priority order = roughly the order to ship.

---

## Done

### S-0. Docker socket proxy reachable from tenants — fixed 2026-09-13
`docker-socket-proxy` sat on `tenant-net` with `POST=1` and no auth; a tenant container could list and create containers (verified from inside a bot). Now on `control-net` (`internal: true`) shared only with the orchestrator; `infra/startup.sh` compose + prod applied, tenant curl to the proxy fails.

### S-13. Tenant containers could reach the GCE metadata server — fixed 2026-09-14
Verified from inside a bot: `169.254.169.254` answered with the VM service account's `cloud-platform` scope, so a prompt-injected bot could mint that account's token and read every secret it can (database URL, encryption key). Fix: `agent-forall-metadata-guard.service` (in `infra/startup.sh`; `docker.service` *requires* it, so a failing guard keeps Docker down) loads `DOCKER-USER` atomically: allow only the orchestrator (fixed `172.16.0.10` on the named bridge `af-front`, default route via `gw_priority`) plus DNS on port 53, drop every other container packet to `169.254.169.254`. The orchestrator needs the VM identity for GCS backups; Caddy is excluded. The frontend subnet `172.16.0.0/24` sits outside Docker's default pool so a fresh VM cannot collide; startup asserts Docker wired `DOCKER-USER` into `FORWARD`. Changing the frontend subnet or bridge later needs `compose stop/rm caddy orchestrator; docker network rm agent-forall_frontend; compose up -d`. Never `ufw enable` on this host (it flushes user chains). `docker.service` also runs `ExecStartPost=iptables -C FORWARD -j DOCKER-USER`, so Docker fails rather than start unguarded, and `daemon.json` pins `firewall-backend: iptables` (the nftables backend has no `DOCKER-USER` jump); `tenant-net` is `external` (created by startup.sh) so no compose change can recreate it; Caddy drops all caps but `NET_BIND_SERVICE`. Applied live and verified: bot → timeout, Caddy → blocked, orchestrator → 200, bot DNS ok. Rollout cost ~10 min of API downtime (compose recreated networks; see handoff), bots unaffected. Remaining: per-role service accounts so the VM identity itself carries fewer secrets (Phase 2), and a decision on rotating `database-url` / `dashboard-service-token` (no evidence of abuse; rotation of `encryption-key` needs a re-encrypt tool).

## Easy (1-2 days each)

### S-14. Caddy on tenant-net also serves the public site to bots — FIXED 2026-09-16 (step 6: public site 404s private sources; ops use the frontend IP)
- **Risk:** since 2026-09-14 Caddy sits on `tenant-net` (alias `orchestrator.internal`); a bot can send Host `api.agentforall.co.il` to it and reach `/api/v1/*` — the same authenticated surface `orchestrator:3000` exposes to bots today, so no regression yet.
- **Fix:** before the orchestrator leaves `tenant-net`: `@private remote_ip private_ranges` → `respond @private 404` on the public site (check the VM's own ops curls first: they arrive as the VM's private IP).
- **Files:** `infra/startup/control-plane.sh` (Caddyfile).

### S-17. The control-plane VM keeps a full-power Docker socket proxy it has no use for (opened 2026-09-17, step 8)
The orchestrator still requires a local Docker host, so VM `orchestrator` runs the socket proxy (EXEC/POST/DELETE) although no bot ever runs there; a compromised orchestrator process is root on the VM that holds the CA key and every secret. Only the `draining` host row keeps bots off it. Fix: make the local host optional in `main.ts`, then drop the proxy and the runtime image env from `startup/control-plane.sh`. Related: S-7 (single-orchestrator advisory lock) should land before the old VM is retired, because the `stack_enabled` gate acts only when a startup script runs.

### S-15. Bots can reach each other's gateway on tenant-net (found 2026-09-15, step 4 review) — FIXED 2026-09-17: closed on workers 2026-09-16 (`enable_icc=false` + INPUT drop on `af-tenant`); no bot runs beside the orchestrator since the cutover to its own VM, and the control plane is off `tenant-net`
- **Risk:** `tenant-net` is a plain bridge with inter-container communication on; any bot can open `http://openclaw-<other>:18789` and needs only that bot's bearer token. Pre-existing, not new to Phase 2.
- **Fix:** create `tenant-net` with `com.docker.network.bridge.enable_icc=false` once the orchestrator probes bots by the host's VPC IP (step 4b); the orchestrator and Caddy keep reaching bots because they are not subject to ICC on that bridge only if they sit on another network — verify on the second VM first.
- **Files:** `infra/startup/worker.sh`, `infra/startup/guard-worker.rules` (workers); `apps/orchestrator/src/services/docker-container-runtime.ts` (`ensureNetworkExists`, the orchestrator VM).

### S-16. Worker registration binds no address to the identity — FIXED 2026-09-16 (addresses are configuration, `WORKER_ADDRESSES`; a registration naming another address is refused)
- **Risk:** a listed worker's identity token lets that VM register any private IPv4 as its address; the orchestrator then dials Docker there with its client cert. A compromised worker A could point its record at worker B and have A's rows managed on B. Bounded to already-trusted workers.
- **Fix (step 6):** derive the address from the GCE API by instance id instead of the request body, or check that the dialed server cert carries the host id.
- **Files:** `apps/orchestrator/src/services/host-registrar.ts`, `apps/orchestrator/src/routes/hosts.ts`, `apps/orchestrator/src/services/remote-host.ts`.

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

### S-8b. Failed-auth requests are never rate limited (found 2026-09-13 review)
- **Risk:** `server.ts` registers the auth hook before rate-limit on purpose (the limiter keys on the authenticated user), so a rejected bearer throws before any limiter runs. Token brute force from `tenant-net` or the internet is unthrottled. `trustProxy: true` also lets a tenant hitting `orchestrator:3000` directly spoof `X-Forwarded-For`.
- **Fix:** a second, pre-auth limiter keyed on `socket.remoteAddress` with a low budget for 401s; keep the per-user limiter as is. Since 2026-09-14 the relay limiter is keyed on the bot id in the URL (needed once every bot arrives via Caddy), so an unauthenticated peer can mint buckets with random ids, one bearer lookup each: the pre-auth limiter must cover the relay paths too.
- **Files:** `apps/orchestrator/src/server.ts`, `plugins/auth.ts`.

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
