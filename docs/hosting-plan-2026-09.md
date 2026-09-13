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
2. **Reboot-safe VM — metadata DONE 2026-09-13, reboot pending.** Script moved to `metadata["startup-script"]` (in place, no ForceNew), state re-imported, data disk + alerts + IAM now in Terraform, plan empty. Script now owns the data-disk mount and Docker data-root (`RequiresMountsFor`), fails loudly instead of starting on the boot disk. Verified byte-identical from the VM's metadata server; data-disk block exercised on the live VM. A clone test was dropped: a clone would boot against the prod database and WhatsApp sessions. Remaining: switch `PAIRING_IMAGE` on the VM to the pinned GAR digest, then one deliberate reboot in a quiet window (~3 min of bot downtime) with the checklist in handoff issue 3.
3. **Alerts — DONE 2026-09-13** (`infra/monitoring.tf`). Email channel (`alert_email` in tfvars), uptime check on `/health` every 60 s + "API unreachable" policy, VM memory > 85 % for 5 min, the two disk policies wired, and a log-based policy on the orchestrator's "auto restart budget exhausted" / "most bots failed liveness at once" lines. Orchestrator logs ship via Docker's `gcplogs` driver (`docker logs` still works locally); info-level lines are excluded from ingestion. Telegram delivery later needs a webhook relay.
4. **Restore test — DONE 2026-09-13.** Disk from the day's snapshot attached read-only to a credential-less scratch VM: 17 tenant volumes present, `openclaw-agent.sqlite` and `state/openclaw.sqlite` open with `integrity_check` ok (copy the `-wal`/`-shm` files alongside before opening). Scratch VM and disk deleted afterwards.
5. **Memory.** `DEFAULT_RESOURCE_LIMITS.memoryMb` 4096 → 3072 (route max stays 4096 for per-bot override). Alert on bot RSS > 2.5 GB. Chromium tab cleanup job (handoff issue 4).

6. **Health monitor at scale (before Phase 2).** Today every poll writes every bot's row (`updateHealth`) and inspects every container. At 1,000 bots that is ~70 DB writes/s of no new information. Write only on change, refresh `last_seen_at` once a minute, inspect Docker only after a failed probe. Poll interval stays 15 s.

## 2. Multi-host (≈2 weeks, before a campaign that can bring hundreds)

Design: one orchestrator VM (e2-small) + identical worker VMs, no public IP, egress via Cloud NAT. Workers run `docker-socket-proxy` + bots only. Orchestrator reaches each worker's proxy over the VPC through an mTLS terminator on `:2376`; VPC firewall allows source tag `orchestrator` only. Private Cloud DNS zone: `orchestrator.internal`, `worker-N.internal`. Terraform `worker_count` creates VM, DNS record, firewall membership, mTLS cert (private CA in Secret Manager, fetched by `startup.sh`).

Code, in order, each shippable alone:
1. `ContainerRuntime` becomes an interface; Docker class implements it. `inspect()` → `ContainerState`, `listManagedContainers()` → `ManagedContainer[]`. 5 call sites + test fakes.
2. Orchestrator gets its stable address: bot configs' `http://orchestrator:3000` → `https://orchestrator.internal`. Roll into existing bots via the config-apply path while still on one VM.
3. `hosts` table (id, address, capacity_mb, status). Repository scoping changes from "my host" to "hosts I manage". Runtime registry: one Docker client per host, chosen by `instance.host_id`.
4. Placement: least free-RAM-committed host on create. Probes and exec go to the bot's host (gateway port bound to the worker's private IP). `(host_id, gateway_port)` uniqueness already exists.
5. `move` operation: stop → stream volume → start on target → liveness → flip `host_id`. Idle-aware (no active session, no cron due). Reuses backup export/import.
6. `startup.sh` role `worker`; Terraform `worker_count`, NAT, DNS, firewall, CA.

Verify each step on a second VM in the same project before touching the current one. Existing VM becomes `worker-1`; orchestrator moves to its own VM last.

## Later

- ~100 bots or credits gone: 1-year CUD (~$5/bot) or Hetzner AX workers (~€1/bot), control plane unchanged.
- GKE only with an engineer who has run it, or >500 bots.

## Not doing

GKE, Agent Sandbox (Failed pods not recreated), Autopilot (~$19/bot), Fly (unreplicated volumes), Cloud Run (no persistent disk, 60-min request cap), per-bot public DNS or Caddy on workers.
