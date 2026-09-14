# Hosting and reliability plan (2026-09-13)

Decision: stay on GCE VMs + Docker, one orchestrator, N worker VMs. No GKE.
Grounds: single-copy stateful pods recover in ~15 min on GKE (10 min NotReady before node repair, pod stuck until node recreated) vs ~3 min GCE auto-restart; GKE node upgrades drain nodes on Google's schedule, GCE live-migrates; ~25% more per bot. Independent review 2026-09-13 reached the same verdict.
Sources: docs.cloud.google.com/kubernetes-engine/docs/how-to/node-auto-repair, kubernetes.io/docs/tasks/run-application/force-delete-stateful-set-pod, docs.cloud.google.com/compute/docs/instances/host-maintenance-overview, ona.com/stories/we-are-leaving-kubernetes.

## Verified state (prod, 2026-09-13)

- VM `agent-forall` e2-highmem-4: `automaticRestart=true`, `onHostMaintenance=MIGRATE`, up 134 days. 17 bots, 12/32 GB used.
- Snapshots: `agent-forall-daily-snapshot` 03:00, 14 days, attached to boot and `agent-forall-data` (80 GB). Never restore-tested.
- Alerts: disk 75%/85% policies exist with **0 notification channels**. No uptime check, no memory alert.
- Health monitor: GET `/healthz` every 15 s (1–5 ms on all bots). Marks degraded/unhealthy, never restarts.
- `docker-socket-proxy` is on `tenant-net` with `POST=1`, no auth. A tenant container reached `/containers/json` (verified). **Critical.**
- Startup-script drift: deployed metadata lacks two secret fetches; reboot unsafe (handoff issue 3).
- Orchestrator is host-scoped: `ORCHESTRATOR_HOST_ID=agent-forall-vm`, repository filters every read by `host_id`, one Docker client from `DOCKER_HOST`.
- Bots are never reached from the internet. Caddy fronts only `api.agentforall.co.il` → orchestrator. WhatsApp (Baileys), Telegram (long-poll) and the Cloud API relay are all outbound from the bot.

## 0. Isolate the Docker proxy — DONE 2026-09-13

`infra/startup.sh` compose: `control-net` (`internal: true`), proxy on it only, orchestrator on `frontend` + `tenant-net` + `control-net`. Dev `docker-compose.yml` already had the proxy on its own network. Prod: compose file replaced (backup `docker-compose.yml.bak-20260913-controlnet`), `docker compose up -d` recreated proxy + orchestrator (~15 s API blip, bots untouched). Verified: tenant curl to proxy fails, API 200, reconciliation clean, no health changes. Recorded as S-0 in `docs/security-todo.md`.

## 1. Reliability on the current VM (≈1 week)

1. **Auto-restart hung bots — DONE 2026-09-13** (orchestrator `509f9106`). `services/auto-restarter.ts` observes one liveness report per health poll: 4 consecutive "down" samples (settled, running container whose `/healthz` failed; booting, missing or Docker-unreachable containers are never "down") → `InstanceManager.restartBySystem`, which re-checks inside the lock (running, not booting, current image, still no answer), skips creds re-injection and never parks the bot in `error`. 10 min cooldown, 3 per hour, then one `instance.auto_restart_exhausted` event + error log (alert on it in item 3). Suspended while >50% of the fleet fails at once. Events in the existing `instance_events` table. 3 independent reviews; 422 tests.
2. **Reboot-safe VM — DONE 2026-09-13 (reboot exercised 22:45 UTC: bots back at +95 s, script clean, all checks passed).** Script moved to `metadata["startup-script"]` (in place, no ForceNew), state re-imported, data disk + alerts + IAM now in Terraform, plan empty. Script now owns the data-disk mount and Docker data-root (`RequiresMountsFor`), fails loudly instead of starting on the boot disk. Verified byte-identical from the VM's metadata server; data-disk block exercised on the live VM. A clone test was dropped: a clone would boot against the prod database and WhatsApp sessions. Follow-up: the script pre-pulls the Hermes image before `compose up`, which delayed the "platform started" marker by ~3 min (services were already up via restart policies).
3. **Alerts — DONE 2026-09-13** (`infra/monitoring.tf`). Email channel (`alert_email` in tfvars), uptime check on `/health` every 60 s + "API unreachable" policy, VM memory > 85 % for 5 min, the two disk policies wired, and a log-based policy on the orchestrator's "auto restart budget exhausted" / "most bots failed liveness at once" lines. Orchestrator logs ship via Docker's `gcplogs` driver (`docker logs` still works locally); info-level lines are excluded from ingestion. Telegram delivery later needs a webhook relay.
4. **Restore test — DONE 2026-09-13.** Disk from the day's snapshot attached read-only to a credential-less scratch VM: 17 tenant volumes present, `openclaw-agent.sqlite` and `state/openclaw.sqlite` open with `integrity_check` ok (copy the `-wal`/`-shm` files alongside before opening). Scratch VM and disk deleted afterwards.
5. **Memory — cap + watch DONE 2026-09-14** (orchestrator `559836e4`). `DEFAULT_RESOURCE_LIMITS.memoryMb` 4096 → 3072 for new bots (existing rows keep their stored limit; API max stays 4096). `services/memory-watch.ts` samples every bot's usage every 5 min (`docker stats` formula) and logs `bot memory high` once at 80 % of its limit; the "orchestrator needs attention" alert matches it. **Chromium tab cleanup: deferred** — closing tabs a bot may be using is a customer-visible risk; needs an idle signal (no active session, no cron due) before any CDP-driven close. Design separately (handoff issue 4).

6. **Health monitor at scale — DONE 2026-09-14** (orchestrator `d2484033`). A healthy `running` row is written only when `last_seen_at` is older than 60 s (or on any status/failure change); Docker is consulted once a minute per healthy bot (repairing a lagging container id) and otherwise only to classify a failed probe. The reconciler resolves containers by name before marking a row `error`. Poll interval stays 15 s. At 1,000 bots: ~17 writes/s → ~1/s-equivalent per minute tick instead of ~70/s.

Final audit 2026-09-14 (orchestrator `1c3509d8`): blocked restarts (other image, no container) spend budget and log `instance.auto_restart_blocked` so the exhausted alert still fires; cooldown no longer depends on the budget window; reconciler skips rows under an operation lock; `startup.sh` refuses to format the data disk once bootstrapped. Two independent reviews, 450 tests.

## 2. Multi-host (≈3 weeks, before a campaign that can bring hundreds)

Design: one orchestrator VM (e2-small, reserved internal IP) + identical worker VMs in a dedicated VPC (no `default-allow-internal`), no public IPs, egress via Cloud NAT. Workers run `docker-socket-proxy` + bots. Orchestrator → worker: Docker's own remote protocol over mTLS on `:2376` (dockerode, zero new RPC code) plus the bots' gateway ports bound to the worker's private IP; one firewall rule, tag `orchestrator` → tag `worker`, ports 2376 + 19000-19999. Bots → orchestrator: `https://orchestrator.internal` (private Cloud DNS; Caddy internal CA with root + key seeded from Secret Manager; root mounted read-only into bots and sidecars with `NODE_EXTRA_CA_CERTS`). Control-plane certs come from a separate CA (orchestrator client cert `clientAuth`, per-worker server cert with IP SAN), never Caddy's. Two service accounts: `worker` (GAR pull, logs, metrics, its own TLS secret) and `orchestrator` (the rest); `startup.sh` takes a role.

Reviewed 2026-09-14 by three independent reviewers (design, security, SRE). Rejected with reasons: dial-out worker agent (the orchestrator needs inbound TCP to bots anyway; custom RPC with head-of-line blocking), Nomad (cannot copy files into a task, Raft quorum to run, disconnect semantics fight single-copy stateful jobs), Google CAS (no gain over Caddy's CA for an internal endpoint), automatic worker reset (split-brain: the orchestrator may be the partitioned side), GKE (single-copy recovery still ~15 min in 2026). Found live and fixed the same day: S-13, bots could reach the metadata server.

Non-negotiable before any bot is flipped to the new address:
- Relay URLs derived from `ORCHESTRATOR_INTERNAL_URL` at render time; the per-bot stored copies removed by a one-shot migration (0014). DONE 2026-09-15, slice 2.
- Caddy internal site is an allowlist of the three relay paths; the public site also 404s `/internal/*` and `/api/v1/admin/*`; relay rate limits keyed on instance id (not socket address); `TRUST_PROXY` = frontend CIDR; the orchestrator leaves `tenant-net` once Caddy is the only path.
- Per-host circuit breaker: a host whose Docker is unreachable is skipped by the health monitor and reconciler (no failure increments, one log line per transition); reconciler catches per row; startup reconcile logs instead of exiting; `/health` = process + DB only.
- Worker reset stays manual (alert + one command) until a quorum rule (never when >50 % of workers are missing) and an orchestrator-independent signal (Ops Agent uptime) exist. Workers start tenant containers only when the orchestrator re-adopts them (`RestartPolicy: no` on workers + boot hook), so a reset can never yield two live WhatsApp sessions.
- `move` is its own operation: a one-off container tars the whole volume, including `whatsapp-session`, straight to a CMEK moves bucket; mirror on the target; same row and identity; port re-allocated per host; `host_id` flipped once; source volume kept 24 h; object deleted after the target verifies. The user backup export is not a move (it strips the session and streams through the orchestrator).
- Recreate path first: a failure returns the row to `stopped` when a bootable container remains; `error` rows keep their port; recreate does not re-inject pairing-time WhatsApp creds over a live session. Roll with `infra/ops/recreate-tenants.sh` (snapshot + plugin assertion per bot).
- Host scoping: `hosts` table with FK from instances, per-host port allocation, per-user limit counted across hosts, placement = measured usage + committed × explicit overcommit, hard reserve, refuse above 90 %.
- Cloud NAT: dynamic port allocation, 512-8192 ports per VM, ≥2 NAT IPs, alerts on dropped and allocation-failed packets. Default is 64 ports per VM, which drops traffic silently at ~25 bots.
- Alerts keyed on `labels.role`, not one instance id; per-host `expected` vs `running` and reachability as log metrics; `caddy` and `docker-socket-proxy` images mirrored to GAR by digest (Docker Hub limits are per NAT IP).
- Orchestrator VM rebuild: Caddy CA and every key the orchestrator reads come from Secret Manager (23 keys in `.env.runtime` are set only by hand today, including the Telegram manager token); `/home/deploy/backups` synced to a bucket first.

Code, in order, each shippable alone:
1. **DONE 2026-09-14.** `ContainerRuntime` is the interface (`services/container-runtime.ts`, domain types only); `DockerContainerRuntime` + `createDockerClient` live in `services/docker-container-runtime.ts`. `inspect()` is private, its 3 callers use `containerState()`; `listManagedContainers`/`putArchiveBuffer` deleted (no callers). Pure refactor, 450 tests, orchestrator `1dfc406a` in prod.
2. **Slice 1 DONE 2026-09-14** (orchestrator `3f5118c4`): recreate-path fixes, instance-keyed relay rate limits, `TRUST_PROXY` = frontend CIDR; two review rounds, 469 tests. **Slice 2 DONE 2026-09-15** (orchestrator `f8ff32b1`, migration 0014): relay URLs derived at render time from `ORCHESTRATOR_INTERNAL_URL`, nothing per bot stores them. Stable address: `ORCHESTRATOR_INTERNAL_URL` → `https://orchestrator.internal` (reserved IP, private DNS, Caddy internal site as allowlist, CA seeded from Secret Manager). Relay URLs derived at render time, stored copies migrated away. Root CA mount + `NODE_EXTRA_CA_CERTS` in create/createSidecar. Recreate-path fixes, instance-keyed rate limits and `TRUST_PROXY` land first; then the rolling recreate in a quiet window, gated per bot on the plugin-load line. Follow-ups the first slice surfaced: the dashboard has no `stopped` state and no start action (a stopped bot renders as active; today only ops start bots, via the API); `whatsapp_creds` ciphertext is written at pairing and never read again (only its presence is), so it can become a boolean column.
3. `hosts` table + identity-token registration (`aud` + instance id ∈ Terraform set, `iat` < 5 min) + per-host circuit breaker + host-scoped queries and ports.
4. Remote runtime: one `DockerContainerRuntime` per host over mTLS; probes and RPC dial the worker's private IP; pairing sidecar port published on the VPC IP; per-host probe concurrency.
5. `move` as above, rehearsed on קוקי30 before any customer bot.
6. Terraform: dedicated VPC, NAT sizing, worker role + service account, control-plane CA, `worker_count`, label-keyed alerts and per-host log metrics. Workers boot from a prebuilt image (Docker, ops agent, runtime images baked in), so `startup.sh` for a worker is configuration only and a boot takes seconds, not four minutes. The nightly image cleanup is baked in too, deleting every unused image (Docker never does this itself; on 2026-09-14 the boot disk hit 75 % with 25 GB of superseded digests kept by a 7-day filter, since removed). containerd's root goes on the data disk in that image: Docker 29 stores image layers in containerd, so `data-root` alone leaves them on the boot disk. Disk alerts per filesystem.

Verify each step on a second VM in the same project before touching the current one. Existing VM becomes `worker-1`; orchestrator moves to its own VM last.

## Later

- ~100 bots or credits gone: 1-year CUD (~$5/bot) or Hetzner AX workers (~€1/bot), control plane unchanged.
- GKE only with an engineer who has run it, or >500 bots.

## Not doing

GKE, Agent Sandbox (Failed pods not recreated), Autopilot (~$19/bot), Fly (unreplicated volumes), Cloud Run (no persistent disk, 60-min request cap), per-bot public DNS or Caddy on workers.
