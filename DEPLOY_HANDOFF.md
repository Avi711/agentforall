# Deployment handoff — agent-forall production rollout

**Purpose:** session-to-session continuity. Reads top-to-bottom as a complete state-of-the-world. Don't add session-by-session timelines — fold material into the live sections below.

**Last updated:** 2026-09-02

## Pending: OpenClaw 2026.8.2 upgrade (branch `feat/openclaw-2026.8.2`, not deployed)

Committed 2026-09-02 (`724773e`, `a67713f`); images pushed and pinned in `infra/variables.tf`:
`openclaw-browser@sha256:f0e4aec97e55e0a3afd852ef72994cfe4ed3157ff4a90554de0a66b3940c31ca` (tag `2026.8.2`,
already pulled on the VM) and `orchestrator@sha256:e72e591d36339707c0007634544bf4d1ecfde7959a45d990a6ffefbc198ce0e8`.
VM rehearsal on a clone of the 3.2 GB tenant volume: doctor 1m37s, plugin update 24s. Plan, deviations
and rollout procedure in `docs/openclaw-2026.8.2-upgrade.md` (§5 status, §6b rehearsal, §7 window). Must land as one window
before 2026-09-18: orchestrator deploy + `AGENT_RUNTIME_IMAGE` flip + `recreate-tenants.sh` for every
live tenant, because a 2026.8-shaped config is refused by a 2026.7 gateway and the orchestrator now
refuses config changes on a running container from another image (409 `RUNTIME_IMAGE_MISMATCH`).

## Production image policy

### Tenant runtime images (2026-08-29)

All 11 tenants run `openclaw-browser@sha256:a81764a4…`, the pinned `AGENT_RUNTIME_IMAGE`. They had drifted across three builds (9 on a 5-week-old one) because a container keeps the image it was created with. `infra/ops/recreate-tenants.sh` rebuilds them from the pinned ref, reattaching the state volume by name.

**A recreate is never complete on its own.** A plugin installed by `rollout-plugin.sh` records the tarball path it came from, which lived in the old container's `/tmp`; the new container has a fresh `/tmp`, so the plugin stops loading while the container still reports **healthy**. Always follow a recreate with `rollout-plugin.sh --plugin agentforall-media …` and confirm the `http server listening` line names it. Plugins baked into the image install into `/home/node/.openclaw`, which Docker seeds only into an *empty* volume — that is why new bots need no rollout and existing ones do.

OpenClaw also guards its config: an externally replaced `openclaw.json` without its metadata is saved as `openclaw.json.clobbered.<ts>` and reverted to `last-good` (`missing-meta-vs-last-good`). One tenant (`354e4d9e`) had silently lost its media entry that way hours before this pass, despite the earlier rollout reporting success.

Disk after consolidating and pruning: 51% → 28% of 48 GB, one openclaw image on the VM. Rollback images remain in Artifact Registry (`6eb75c5c…` tagged `2026.7.1`, `d99dec8d…`).

- Production must not deploy `:latest` or `:main`. Use a GAR digest or git-SHA tag for app images and a tested digest for third-party runtime images.
- Current orchestrator image: `…orchestrator@sha256:d4f10dd1869760f8ef61d838ff60849f356a608a023cff36ef5f0c0bfb2c5c09` (deployed 2026-08-29, commit `e9846d4`: the integrations catalog is off the dashboard's critical path). The catalog cache holds a day-long list, refreshes behind a served answer, backs off 5 minutes after a failed attempt and is warmed at boot — `warmCatalog()` in `main.ts`. The cache holds only a list worth serving and the last attempt is tracked separately, so an empty answer at boot cannot take a day-long lease and a provider that is down is asked once per backoff instead of once per read. The dashboard no longer calls the catalog at all: the showcase row is `SHOWCASE_APPS` in `apps/web/src/lib/integrations/catalog.he.ts` with local logos under `apps/web/public/apps/`. Supersedes `8ef17ddd…`.
- Previous orchestrator image `…orchestrator@sha256:8ef17dddf277a6ee6085aff78d90ee45f01c37d0bda776a36370217b954be92a` (deployed 2026-08-29, commit `30d7b83`: renders the media plugin's entry, its `AGENTFORALL_MEDIA_*` env and its auth-only provider block). Supersedes `bf4777ab…`. **The VM's `/home/deploy/agent-forall/.env` had drifted to `d4b0cc5c…` while `bf4777ab…` was actually running, so a plain `docker compose up` would have rolled the orchestrator back; the file now matches what runs.** Supersedes `ba1c7d66…`, which the rest of this bullet describes. Config writes never replace a tenant's `openclaw.json` any more: `generateRuntimePatchedOpenclawFiles` sets only the paths the dashboard renders (`OWNED_PATHS` / `CHANNEL_OWNED_PATHS` in `agent-runtime/openclaw/config.ts`) onto the live file read straight off the container (`ContainerRuntime.readFile`, works on stopped containers too — before this, every start/restart/restore silently reset tenant config to pristine, which deleted the `groups` OpenClaw writes). Telegram group defaults (`groupPolicy: "open"`, `groups: {"*": {requireMention: true}}` — groups are blocked until listed) are delivered per missing key, so bots linked before the default get it and an owner who set `groupPolicy: "disabled"` keeps it. Managed-bot usernames are `<latin-name>_<8 hex>_bot` (Hebrew names keep `agentforall_`). Renders the `agentforall-credit` plugin entry (`hooks.allowConversationAccess`, `timeoutMs: 3000`) and `AGENTFORALL_CREDIT_BASE_URL/_API_KEY` for LiteLLM bots. Rollback chain: `36829306…` (2026-08-25, never-overwrite + group defaults + usernames, no credit plugin) → `af9f1790…` → `c3b08d00…`.
- Previous orchestrator image `c3b08d00…` (deployed 2026-08-21 late, commits `e5288fc`..`80fbd16`): deleting an `error` instance cleans up straight to `destroyed` (passing through `destroying` re-claimed a released gateway port → unique violation); `GET /instances/:id` carries `provisioningStage` + `provisioningHistory` (from the `provision.*` event log, no schema change) — the web creation panel builds its step timeline from those server timestamps. Web: English admin panel (runtime kind, model, error visibility), creation flow waits for `running` then offers Telegram/WhatsApp (dedicated-number confirm), milestone-anchored progress ring. Smoke-tested end-to-end 2026-08-21 21:35 (create → 4 steps with real durations → ready → connect step → delete).
- Previous orchestrator image `5e2444264022…` (deployed 2026-08-21, commits `afbabae`+`b4bea0b`). Config writes no longer `docker restart` OpenClaw containers — the gateway hot-reloads `openclaw.json` (hybrid mode; channel changes make it restart itself in-process, ~2s). The remaining restarts (user restart, WhatsApp disconnect) wait for Docker's start-up window first (`waitForHealthy`, ≤120s): restarting mid-first-boot leaves OpenClaw's startup-migration lock (5-min lease) behind and crash-loops the container — that was the 2026-08-21 19:06 incident. `running` now means the gateway passed its health check (~20s after create). Backup restore happens before the first start (one boot). `GET /api/v1/admin/instances` (service-scope auth: service token, no act-as) feeds the web admin panel. Smoke-tested: create→running 20s, live channel add with RestartCount=0, delete.
- Web admin (`/admin`) is gated by `ADMIN_EMAILS` (Vercel env, Production+Preview: `agentforall.il@gmail.com`); the old `ADMIN_PASSWORD` is unused and can be deleted from Vercel.
- Previous orchestrator image `42fa765c…` (deployed 2026-08-21, commits `c66fbce`+`89672d6`: owner identity — `GET/PATCH /:id/owner` writes both `session.identityLinks` and `commands.ownerAllowFrom`, `sync` read back from the live `openclaw.json`; access (`/whatsapp/access`) is who-may-write only; lock-scoped `InstanceManager.updateChannels` for every channel writer; `disconnectWhatsapp` refuses unless the auth dir wipe succeeded; backups no longer export/restore `whatsapp-session/`). Previous: `42dd2664…` (claim/access, disconnect, per-peer sessions, `budgetResetAt`), `f947560e…` (`recreate`).
- Owner block is only written on the next config refresh: tenants provisioned before 2026-08-21 report `sync: "pending"` on `/owner` until an owner/access save or `recreate`. `openclaw doctor` inside such a container says "No command owner is configured" — expected until then.
- As of 2026-08-21 the orchestrator runtime tree (`agent-runtime/`, pairing, telegram linker, tests), pairing sidecar, db migrations, infra and ops docs are tracked in git (`c66fbce`); before that prod was built from an uncommitted working tree. Still untracked on purpose: `.codex-run/`, `backups/`, `outputs/`, `*.tfplan`.
- New bot creation currently defaults to OpenClaw: `AGENT_RUNTIME_KIND=openclaw`.
- Voice notes are transcribed by the `agentforall-media` plugin (`packages/openclaw-plugin-media`), not by a vendor STT. OpenClaw 2026.7.1 registers a *config* provider (our `litellm` entry) for image only (`resolveImageCapableConfigProviderIds`) and strips `audio` from a model's `input` (`model.static-catalog`), so without the plugin audio falls through to local `whisper-cli`/`whisper`, which the image does not carry, and voice notes fail silently. The plugin registers media provider id `agentforall-media` and posts the audio as an `input_audio` part to the bot's own LiteLLM `/v1/chat/completions` — same key, same budget, same spend log (verified 2026-08-29: a transcription call moved `key/info.spend`). It reads `AGENTFORALL_MEDIA_BASE_URL` / `AGENTFORALL_MEDIA_API_KEY` (rendered for every provider that has a `baseUrl`, not only LiteLLM) because the model client's key variable is derived from the provider id. It declares no `autoPriority`, so it is used only where `tools.media.audio.models` names it; bots on a direct provider (no `baseUrl`) keep OpenClaw's own audio provider. `tools.media.video` is not rendered for gateway providers at all — same registry limitation, and the plugin covers audio only. **Rollout is per container, like the credit plugin** (an image upgrade never re-seeds a tenant's plugin volume), and it needs an image built from the current Dockerfile first — `d99dec8d…` carries only `agentforall-credit`: build, pin, then `bash infra/ops/rollout-plugin.sh <new-image-ref> --plugin agentforall-media --sentinel provider.js --verify-env AGENTFORALL_MEDIA_API_KEY`. Verified end to end on 2026-08-29 with a real spoken `.ogg` (the format WhatsApp and Telegram send): `openclaw capability audio transcribe` returned the exact sentence 5/5 through the plugin. Two things only the live pilot could catch: OpenClaw resolves a custom provider's key from `models.providers.<id>.apiKey` **before** dispatching, so the provider needs an auth-only block (`30d7b83`) — the manifest's `setup.providers[].envVars` feeds the setup/doctor surfaces, not the runtime resolver; and the model answers non-speech (a tone, birdsong) with `finish_reason: "stop"` and no content, which is an empty transcript rather than a failure (`04b9601`) — OpenClaw then reports "No transcript returned", which is correct for a voice note with nothing in it. **After any OpenClaw image bump, send a voice note and confirm a transcript**: the media config shape moved in newer OpenClaw (top-level `tools.media.models` + `preferredModel`), and a shape mismatch fails silently.
- Current OpenClaw image: `…openclaw-browser@sha256:a81764a47c59c7a1130d6ae40dd7eca9f3c644b1bd007eac2d3186a450e44326` (deployed 2026-08-29, commit `04b9601`: OpenClaw 2026.7.1 + `agentforall-credit` + `agentforall-media`). `AGENT_RUNTIME_IMAGE` flipped in the VM's `.env.runtime`; the media plugin was rolled into all 11 running tenants the same day (11 ok / 0 skipped / 0 failed) and each was verified independently of the script: the boot line lists `agentforall-media`, `tools.media.audio.models[0].provider` is `agentforall-media`, the auth block is present and the container is healthy. Previous: `d99dec8d…` (deployed 2026-08-26: `AGENT_RUNTIME_IMAGE` flipped in `.env.runtime` and `infra/variables.tf` updated; new bots get it, existing ones keep their container and got the plugin via the rollout below). Previous: `6eb75c5c…` (`OpenClaw 2026.7.1`, upgraded 2026-07-23 for the June 30 security advisories incl. GHSA-52xj CVSS 8.3) — same OpenClaw version, so rolling back is only the env flip.
- All 5 live tenants recreated onto 2026.7.1 on 2026-07-23 via the new recreate endpoint; all healthy, שרוליק's WhatsApp re-linked. Pre-upgrade backups: 4 via GCS export, שרוליק (1.8 GB, export timed out) at `/home/deploy/backups/9901b13d-pre-2026.7.1.tar.gz` on the VM.
- Image upgrades do NOT refresh plugins living in tenant state volumes: after `recreate`, run `openclaw plugins update @openclaw/whatsapp` inside the container and restart it, else the volume's old plugin shadows the image's (core/plugin version mismatch).
- The `d99dec8d…` image above is OpenClaw 2026.7.1 plus the `agentforall-credit` plugin (`packages/openclaw-plugin-credit`, a `before_agent_reply` hook that answers with a Hebrew top-up message once LiteLLM `/key/info` reports `spend >= max_budget`; fails open on any lookup problem; 15s verdict cache). Verified on test bot קוקי2 (`openclaw-e43f2627-29d`, budget set to 0): plugin loads alongside the full bundled set. Do NOT set `plugins.allow` — on a live gateway it shrank the plugin set from 10 to 3, dropping memory-core.
- Same trap applies to `agentforall-credit` (the out-of-credit responder baked in at `infra/images/openclaw-browser/Dockerfile`). A tenant provisioned before that image gets the plugin only from its own volume, which Docker never re-seeds, so it needs a one-time install per container. Done 2026-08-26 for all 9 running tenants (reported 9 ok / 0 skipped / 0 failed, one restart each — but until 2026-08-29 the per-tenant checks ran inside `if ( set -e … )`, where errexit is ignored, so that verdict proved only that each container restarted) with `infra/ops/rollout-plugin.sh <image-ref> --plugin agentforall-credit --sentinel budget.js --verify-env AGENTFORALL_CREDIT_API_KEY --verify-hooks --require-provider litellm` (then named `rollout-credit-plugin.sh`, before it was parameterized), which (run on the VM, `--dry-run` / `--only <container>` supported) does it for every running OpenClaw tenant: stages the plugin out of the image (`/opt/agentforall-credit` only exists inside containers already on the new image, so older ones get it copied in), reinstalls it, then `POST /api/v1/instances/:id/restart` as the owner — `restartLocked` re-renders `openclaw.json` (hooks entry) and `.env` (credit vars) via `refreshRuntimeConfig` before an unconditional restart — waits for a new container `StartedAt`, and verifies all three against logs from that boot only. Safe to rerun; `--only <container>` targets one bot. It must run against an orchestrator that renders the entry, and it fails per tenant, loudly, if the env vars do not appear. Why the PATCH: `openclaw plugins install`/`uninstall` rewrite `plugins.entries.agentforall-credit` down to `{enabled: true}`, dropping `hooks.allowConversationAccess` — without which the plugin loads but never receives `before_agent_reply` and the bot keeps returning the raw error (verified on קוקי2 2026-08-26). (`PATCH /:id/config` renders the same files but only restarts when `.env` changed — fine the first time, wrong on a rerun — and its `PatchConfigBody` refuses `{}`; hence the restart route.) A reinstall of the same name@version is refused ("plugin already exists"), so a plugin update needs `openclaw plugins uninstall agentforall-credit --force` first. Verified safe to run before that: OpenClaw treats `plugins.entries.agentforall-credit` on a container without the plugin as a stale entry, logs "stale config entry ignored" and reports `Errors: 0` — the gate is inert, not broken, so an out-of-credit user just sees the raw model error until the install happens.
- Known follow-ups: platform settings frozen after creation — `browser` and `agents.defaults.{workspace,maxConcurrent}` are deliberately not orchestrator-owned (`web`, `logging` and `agents.list` no longer exist since 2026.8.2), so a container created before a platform fix keeps the old value forever with no repair path short of destroying its state volume. Two that matter: `web.reconnect.maxMs: 600000` (a WhatsApp 405 throttle stays permanent at the old 30s cap) and `logging.redactSensitive: "tools"` (a container whose live value is `"none"` cannot be corrected by config apply). Decide on a one-off repair path rather than leaving it implicit. Also: `ContainerRuntime.readFile` returns `null` for both "file missing" and "container missing" (docker 404 either way) and `adapter.writeConfig` reads that `null` as "write the pristine config", so a misread would factory-reset a tenant's config; and its reject paths never destroy the archive stream, leaking the docker response socket. Billing: `apps/web/src/lib/billing/credits/service.ts` sets each bot's LiteLLM ceiling to `spend + all available credits`, so a user with N bots could spend up to N× their balance between syncs — moot while `maxInstancesPerUser=1`, split the balance before raising it.
- Known follow-ups: backup export times out on multi-GB state (raise prep timeout); `HERMES_RUNTIME_IMAGE` in VM `.env.runtime` points at the known-bad `7a47d19e` digest (unused, but fix); permission allowlist uses `gcloud compute ssh agent-forall *` while ops commands use `deploy@agent-forall` (add matching rule).
- Current Hermes image: `nousresearch/hermes-agent@sha256:b6e41c155d6bfce5ad83c5d0fec670086db8a43250e4511c9474134be5482d33`. This is the Docker Hub `latest` manifest digest smoke-tested on 2026-05-26.
- Hermes images use the official Docker runtime contract. Do not force the generic tenant hardening profile (`CapDrop=ALL` / `no-new-privileges`) onto Hermes unless the exact digest has been smoke-tested; newer Hermes `s6` supervision needs to manage `/run/service`.
- Hermes gateway/platform variables are passed as Docker env vars, written to `/opt/data/.env`, and mirrored as explicit `platforms.*.enabled` config. This follows Hermes' secrets-in-env / behavior-in-config split.
- Hermes WhatsApp UX is intentionally quiet for non-technical users: `approvals.mode=off`, `display.busy_input_mode=queue`, `display.busy_ack_enabled=false`, `display.interim_assistant_messages=false`, `display.platforms.whatsapp.tool_progress=off`, `agent.gateway_notify_interval=0`, runtime footer disabled, and `HERMES_GATEWAY_BUSY_ACK_ENABLED=false`.
- TODO: evaluate whether Hermes' default `SOUL.md` feels too technical for Israeli WhatsApp users before adding a custom consumer identity.
- Do not promote `nousresearch/hermes-agent@sha256:7a47d19ed1d4fa98f178756fd33772c914d9853e414e8366c268773f55517944`: on 2026-05-26 it passed container startup but never opened the API server health endpoint and logged `No messaging platforms enabled` despite docs-aligned env + config.
- Runtime image refs live in `infra/variables.tf` and are rendered into `infra/startup.sh`. Update them only after typecheck/test/build and a production smoke test creates and deletes a temporary bot.
- VM cleanup may prune unused images and build cache only. Never automate `docker volume prune`; tenant state is stored in Docker volumes.

## LiteLLM gateway and usage notes (updated 2026-08-15)

- LiteLLM is the current LLM cost-control gateway. It runs on Cloud Run service `litellm-gateway` in `europe-west4`, URL `https://litellm-gateway-od57tvmr6q-ez.a.run.app`.
- Bot model is `gemini/gemini-3.7-flash` (switched from 3.6-flash on 2026-08-15) behind the `gemini-agentforall` alias in `infra/litellm/config.yaml`. All bots pick it up via the alias; no orchestrator/tenant changes.
- Pricing is pinned in config (`0.75e-6` in / `3.75e-6` out / `7.5e-8` cache-read per token — 3.7-flash intro rates; they double on 2027-01-01, update config then) because LiteLLM otherwise fetches its price map from GitHub at boot and the image's baked-in fallback map has no 3.x entries — a failed boot-time fetch would silently record $0 spend and break budgets.
- Deployed image: `litellm-gateway@sha256:01f96fab322b52696854d74b96891481744902fd08066e94c00d406538426d05` (revision `00008-lxb`, still LiteLLM v1.83.14-stable). Smoke-tested 2026-08-15: alias resolves to `gemini-3.7-flash` (DB config did not override yaml), tool calls, streaming+tools, and non-zero `x-litellm-response-cost`.
- TODO: bump LiteLLM to latest stable (v1.93.0+) as a separate deploy with its own smoke test.
- TODO: set `rpm_limit` on provisioned virtual keys — they are `null` today, so a key that leaks out of its container can drain the whole monthly budget in minutes, hammer the shared gateway, and eat the shared upstream rate limit for every other tenant. Measured 2026-08-26 across all 9 keys: peak was 11 req/min, next 7, rest ≤4 (196 requests total, and `/spend/logs` may paginate, so read it as a floor). OpenClaw caps parallel runs at `agents.defaults.maxConcurrent` (2 for us) but subagents use their own lane defaulting to 8, so a fan-out could legitimately reach ~200/min. Set `rpm_limit` to 300 — far above both — and skip `tpm_limit`, which is hard to size and would bite legitimate long-context turns. Note RPM mainly protects the shared gateway from a noisy neighbour: at ~$0.017 per call, even 300 RPM drains a $100 budget in ~20 minutes, so only the budget cap bounds the money. The key is readable by the agent itself: it lives in the container's `.env` as `LITELLM_API_KEY`, and `GET /key/info` authenticates with the key itself (verified on a live tenant — returns only its own budget and spend, never another tenant's, and the master key never enters a container).
- Lifetime spend per LiteLLM accounting on 2026-07-22: `gemini/gemini-3.5-flash` $377.69.
- LiteLLM database moved off Supabase to dedicated Cloud SQL Postgres instance `agent-forall-litellm`, database/user `litellm`, private IP only, backups enabled, PITR enabled, 7 retained backups.
- Cloud Run LiteLLM uses Secret Manager secret `litellm-cloudsql-database-url`, Cloud SQL socket mount, Direct VPC egress to the default VPC, `min_instances=1`, `max_instances=1`, `cpu=2`, `memory=4Gi`. Keep max at 1 until Redis is introduced.
- LiteLLM ingress is public again so the operator can open the dashboard directly, but it is still protected by LiteLLM auth/master key. Long-term preference remains an admin-only dashboard route/IAP.
- Orchestrator provisions one LiteLLM virtual key per bot when the default provider is LiteLLM. Default budget is currently `$50 / 30d`; key metadata is stored on `instances` only for ownership/reference, while usage remains sourced from LiteLLM.
- Generic bot-usage contract is live: `GET /api/v1/instances/:id/usage`. Route verifies the authenticated owner, then the backend usage provider reads LiteLLM `/key/info`.
- Web commit `ab9773f feat(web): show bot usage` was pushed to GitHub `main`. The user dashboard bot card now shows usage/limit/period using generic `BotUsage`; no LiteLLM secret or service token reaches the browser.
- Backend image with the usage endpoint is deployed on the VM: `orchestrator@sha256:af13673eb51027f3e4420877d72047a9beb75d0f2825c20909d2e91cd14deac6`.
- Verified after deploy: `https://api.agentforall.co.il/health` healthy, orchestrator container running that digest, and `/api/v1/instances/79024c17-2aac-4e3e-814e-a4da8646625d/usage` returned `supported=true`, `spendCents=391`, `maxBudgetCents=5000`, `budgetDuration=30d`.

## 2026-05-24 robustness notes

- Applied forward-only migration `0007_backup_import_state`: restore source object, content length/type, and restore status are persisted on the instance row. Startup migrations are disabled by default; run `npm run -w @agent-forall/db db:migrate` before deploying schema-dependent orchestrator code.
- Backup import no longer sends archives through Next.js or stores them in process memory. Browser uploads directly to a GCS resumable URL; orchestrator later opens the GCS object as a stream and restores it into Docker.
- Backup export is async job based. Web starts `POST /api/bot/:id/export`, polls `GET /api/bot/:id/export?jobId=...`, then navigates directly to the signed GCS URL. The old sync `/api/v1/instances/:id/export` and signed orchestrator `/download` paths were removed.
- GCS archive export upload uses the official `@google-cloud/storage` `file.createWriteStream({ resumable: true, chunkSize: 8MiB })` path with CRC32C validation, generation precondition, and post-upload size verification. The custom export uploader was removed.
- Fixed Docker exec stream EOF handling: demuxed stdout is explicitly ended when Docker's raw exec stream ends, so backup upload pipelines complete instead of waiting forever.
- Live bucket CORS now exposes `Range` as well as `Content-Range`, matching Terraform. This is required for browser resumable import recovery.
- Restore validation is bounded: max archive size, max tar entries, unsafe symlink skipping, top-level `.env` exclusion, and cleanup of invalid import objects.
- Health checks are concurrency bounded via `HEALTH_MAX_CONCURRENT_CHECKS`.
- Per-instance lifecycle operations are serialized in `InstanceManager`, and DB CAS remains the guard for status transitions.
- Added regression tests for backup import metadata, async export job behavior, migration shape, and schema rejection of the removed base64 path.

Deployment order for this batch:
1. DONE: `npm run -w @agent-forall/db db:migrate` applied migration `0007_backup_import_state` to Supabase on 2026-05-24.
2. DONE: updated live GCS bucket CORS to expose `Range`.
3. DONE: built and pushed `orchestrator:latest` via Cloud Build, digest `sha256:e4ffdda113af7540e824ec0dad4df737552bd0334f2b7be098a2f773af6d28ba`.
4. DONE: built and pushed `whatsapp-pairing:latest` via Cloud Build, digest `sha256:20b44400bee9b7ea9c5e233d9dfc779434922b92fd9b9a9dc444ae8054544a57`.
5. DONE: force-recreated only the orchestrator container on the VM and pulled the new pairing image; no VM reboot.
6. DONE: deployed web to Vercel production project `agentforall`, deployment `https://agentforall-fp7fnm6pe-avi711s-projects.vercel.app`, aliased to `https://agentforall.co.il`.
7. Verified after deploy: `https://api.agentforall.co.il/health` returns healthy; `https://agentforall.co.il` returns 200; orchestrator container is healthy, attached to both `agent-forall_frontend` and `tenant-net`, and running the new GAR digest.
8. Verified real production backup export for instance `6a6fd34a-381d-408b-9a56-c614e5ad5037`: archive prepared, GCS upload completed, signed URL returned in ~35s, object size `278896513` bytes.

Validation for this batch:
- `npm run -w @agent-forall/db typecheck`
- `npm run -w @agent-forall/db test`
- `npm run -w @agent-forall/orchestrator typecheck`
- `npm run -w @agent-forall/orchestrator test`
- `npm run -w @agent-forall/web typecheck`
- `npm run -w @agent-forall/web test`
- `npm run -w @agent-forall/orchestrator build`
- `npm run -w @agent-forall/web build`
- `npm run typecheck --workspaces --if-present`
- `npm run test --workspaces --if-present`
- `npm run build --workspaces --if-present`
- `npm audit --omit=dev --json` now reports no high or critical advisories; remaining advisories are moderate transitive items in `next`/`drizzle-kit`/`better-auth`.

## 2026-05-23 robustness notes

- Added forward-only migration `0006_host_scoped_ports`: active gateway-port uniqueness is now `(host_id, gateway_port)` so local/dev/prod hosts can share a DB without blocking each other's port ranges.
- Made `0002_light_grey_gargoyle.sql` idempotent for `instances` bootstrap so a clean DB can apply the full journal from zero. This is an intentional bootstrap repair: a forward migration cannot fix a clean-DB failure that occurs before it runs. Do not make a habit of editing applied migrations.
- `0005_host_id_scoping.sql` backfills existing rows to `agent-forall-vm`; this matches current production. If a different deployed host id already owns rows, run a one-time backfill to that exact `ORCHESTRATOR_HOST_ID` before starting its orchestrator.
- Web bot API routes now parse dynamic `id` params with Zod, call `BotService`, and keep direct orchestrator-client calls out of controllers.
- Orchestrator create quota now uses a transaction-scoped advisory lock before insert; pairing start is serialized per instance and guarded by DB compare-and-set.
- Added OpenClaw state export/import flow: dashboard can download selected `/home/node/.openclaw` state as `.tar.gz`; bot creation uploads backups through GCS and restores them into the new tenant before start.
- Backup download uses a short-lived signed orchestrator URL that prepares a file-backed `.tar.gz`, creates a GCS resumable upload session, streams the archive to GCS with fixed `Content-Length`, and redirects the browser to a signed GCS URL. Next.js never handles the archive body.
- Created `gs://agent-forall-backup-imports` in `europe-west4` with uniform bucket access, public access prevention, `https://agentforall.co.il` PUT CORS, 1-day lifecycle cleanup, and VM service account `roles/storage.objectAdmin`.
- Restore now streams uploaded `.tar.gz` backups through gunzip/tar into Docker `putArchive`; it no longer materializes the uncompressed OpenClaw state in orchestrator memory.
- Backup export includes the full top-level OpenClaw state set (`cron`, `memory`, `flows`, `plugins`, `plugin-skills`, `whatsapp-session`, etc.) while excluding volatile/runtime-only `.env`, `logs`, and `npm`. Duplicate export requests for the same instance share in-flight work and reuse a ready GCS object briefly.
- Restored bots preserve imported OpenClaw model/provider config, including custom `models.providers.*` base URLs. Runtime refresh only replaces gateway auth/env and leaves imported agent/model settings intact.
- Dashboard backup download uses a normal browser download link instead of a hidden iframe, so the GCS redirect is not blocked by `frame-src` CSP.
- Production sets `PULL_IMAGES_ON_STARTUP=false`; VM startup authenticates Docker to GAR and warms tenant images, while orchestrator boot does not perform unauthenticated registry pulls.
- Health monitor now self-heals stale `container_id` values by resolving the deterministic container name before WhatsApp probing.
- Production auth now fails closed if `RESEND_API_KEY` is missing instead of logging magic/delete-account links.
- Added workspace test scripts and focused regression tests for migration shape, bot schemas, pairing concurrency, and sidecar phone validation. Run `npm run test` before rollout.

Deployment order for this batch:
1. DB migration `0006_host_scoped_ports` is already applied to Supabase as of 2026-05-23; verify migration count is 7 before deploy.
2. DONE: built and pushed `orchestrator:latest` via Cloud Build, digest `sha256:2724eef0f87893f1ff8372d33f2f5a1f2d418d72cec6e5f489f171b22dbf3b8b`.
3. DONE: force-recreated only the orchestrator container on the VM; no VM reboot.
4. DONE: deployed web to Vercel production project `agentforall`, deployment `https://agentforall-g9krjnkvk-avi711s-projects.vercel.app`, aliased to `https://agentforall.co.il`. Do not deploy the separate `agent-forall` Vercel project.
5. Verified after deploy: `https://api.agentforall.co.il/health` healthy; `https://agentforall.co.il/login` has CSP access to `https://storage.googleapis.com`; `/api/v1/backup-imports` returns a GCS upload session; a real GCS `PUT` with `Origin: https://agentforall.co.il` returns `Access-Control-Allow-Origin: https://agentforall.co.il`; restore accepts safe symlink entries, skips unsafe symlink entries, and streams archive rewrap without crashing; backup download for `6a6fd34a-381d-408b-9a56-c614e5ad5037` returned `302` in 31.7s after archive + GCS upload; live Caddy request body limit is back to `1MB`.

## 2026-05-16 verification notes

- Verified from official GitHub releases on 2026-05-28: latest stable OpenClaw is `2026.5.27`.
- Local image Dockerfile now targets `OPENCLAW_VERSION=2026.5.27`.
- OpenClaw 2026.5 externalizes WhatsApp from core; Dockerfile now explicitly runs `openclaw plugins install @openclaw/whatsapp` before `openclaw doctor --fix --non-interactive`.
- Health monitor now probes WhatsApp with `openclaw channels status --channel whatsapp --probe --json --timeout <ms>` and falls back to old text parsing only if JSON is unavailable.
- Do not switch away from Gemini only because the model name includes `preview`; verify provider behavior from logs/A-B tests first.
- Built and pushed the OpenClaw 2026.5.27 custom browser image to GAR digest `sha256:13f281ec9c8452b1f50d554edd1d2f6879195ecc956a463c99f01a79303a71bc`.
- VM pulled that digest and orchestrator was force-recreated; `https://api.agentforall.co.il/health` returned healthy.
- Verified locally inside the new image: `OpenClaw 2026.5.27`, WhatsApp plugin installed, and browser plugin dependencies present.

---

## TL;DR — current state

- **Production is LIVE and HEALTHY.** Vercel + GCP VM + Supabase + Caddy TLS. `https://api.agentforall.co.il/health` → 200.
- **VM:** `agent-forall` in `europe-west4-a`, **`e2-highmem-4`** (4 vCPU / 32 GB RAM), static IP `34.90.58.155`. Two disks: 50 GB boot (`autoDelete=true`) + 80 GB `agent-forall-data` (`autoDelete=false`, Docker `data-root` at `/mnt/docker`). Destroy-guarded — see open issue 3 before any `terraform apply`.
- **Headroom (5 days to 2026-08-29):** CPU p50 6.3% / peak 63.6%; RAM p50 16.1% / peak 78.0% (~24 GB). 11 tenants idle at 300–730 MB each against 4 GB caps = 44 GB committed on 31 GB. Levers: `DEFAULT_RESOURCE_LIMITS.memoryMb` (4096) and `shmSizeBytes` (2 GB, `openclaw/adapter.ts`) — both fixed at create, so existing tenants need a recreate.
- **Bot status:** **PARTIALLY working.** The 1st message after pair gets eaten by Baileys 408 + channel-exit storm; the 2nd and 3rd messages reply in 35-41s on prod (vs 14-19s local). User decided to switch from Gemini → OpenAI to address this. (See "Open issues" below for verified-real root cause.)
- **Last infra work (2026-08-29):** LiteLLM Cloud Run 2 vCPU/4 GiB → 1 vCPU/3 GiB (~₪160/mo); `prevent_destroy` + `deletionProtection` on the VM; tenant volumes migrated to a dedicated `agent-forall-data` disk (~25 s downtime, 12/12 containers healthy after).
- **First task next session:** resolve open issue 3 (startup-script drift blocks every `terraform apply`), then `terraform import` the two alert policies and the `agent-forall-data` disk so state matches reality.

---

## Project overview

agent-forall is a Hebrew-first Israeli SaaS at ₪199/mo. Each paying user gets their own private OpenClaw AI agent connected to their personal WhatsApp via Baileys.

**Architecture:**
- **Vercel (Next.js):** landing page, Better Auth dashboard, admin, API proxy routes (`/api/bot/**`)
- **One GCP VM (Ubuntu 24.04):** runs `orchestrator` container + Caddy + per-tenant `openclaw-<id>` containers + per-pairing `whatsapp-pairing` sidecars
- **Supabase Postgres:** single source of truth for `instances`, `instance_events`, `leads`, Better Auth tables
- **GAR `europe-west4-docker.pkg.dev/agent-for-all/agent-forall`:** all three images (`orchestrator`, `whatsapp-pairing`, `openclaw-browser`); VM auths via service account
- **Three-layer architecture (per `CLAUDE.md`):** route handler → service → repository. Drizzle calls only in repositories.

**Domain pieces:**
- Apex `agentforall.co.il` is canonical; `www` 307-redirects.
- Better Auth via Google OAuth (no Resend/email yet).
- LLM provider config lives on the orchestrator (DEFAULT_PROVIDER_*); web sends only `{ displayName, channels }`.

---

## Configuration constants

| Key | Value |
|---|---|
| GCP project | `agent-for-all` (project number `776713718581`) |
| Region / zone | `europe-west4` / `europe-west4-a` |
| VM name | `agent-forall` |
| Static IP name | `agent-forall-ip` |
| Service accounts | `agent-forall@...iam.gserviceaccount.com` (VM); `agent-forall-ci@...` (GitHub Actions) |
| Terraform state | `gs://agent-forall-tf-state` (bucket, versioning ON) |
| Backup import bucket | `gs://agent-forall-backup-imports` (GCS resumable uploads, 1-day cleanup) |
| GHA WIF pool | `github-actions` (pool); `github` (provider) |
| GitHub repo | `https://github.com/Avi711/agentforall.git` (`main` branch) |
| Required GHA repo secrets | `WIF_PROVIDER`, `GCP_SA_EMAIL` (values from `terraform output github_actions_wif_provider` + `..._service_account`) |
| Image registry | GAR repository `europe-west4-docker.pkg.dev/agent-for-all/agent-forall`; production deploys pin image digests in `infra/variables.tf` |
| Apex domain | `agentforall.co.il` (Vercel) |
| API domain | `api.agentforall.co.il` (VM via Caddy + LE) |
| WhatsApp test sender | +972527780673 |
| Bot WhatsApp number | +972552506938 |
| State bucket region | `europe-west4` |
| Disk snapshot retention | 14 days, daily |
| Active gcloud config | `compledio.com@gmail.com` |
| Local Docker network | `agent-forall-net` (dev) |
| VM Docker tenant network | `tenant-net` |
| VM Caddy + orchestrator network | `frontend` |
| Operator deploy user on VM | `deploy` (home: `/home/deploy/agent-forall/`) |
| VM startup logs | `/var/log/agent-forall-startup.log` |
| Bootstrap sentinel | `/var/lib/agent-forall/bootstrap.done` |
| Container env file on VM | `/home/deploy/agent-forall/.env.runtime` (mode 600) |
| Compose file on VM | `/home/deploy/agent-forall/docker-compose.yml` (generated by startup.sh) |

**Full container env var list:** see `infra/startup.sh` — that's the source of truth (`.env.runtime` is generated from there on first boot).

**Backup import bucket:** production requires `BACKUP_IMPORT_BUCKET=agent-forall-backup-imports`, `BACKUP_IMPORT_UPLOAD_ORIGIN=https://agentforall.co.il`, and `BACKUP_IMPORT_TTL_SECONDS=3600` in `/home/deploy/agent-forall/.env.runtime`. GCS resumable sessions must be created with the browser `Origin`, otherwise the later browser `PUT` response will not include CORS headers. The bucket is Terraform-declared in `infra/main.tf`, imported into state, and applied with:
```bash
terraform -chdir=infra import google_storage_bucket.backup_imports agent-forall-backup-imports
terraform -chdir=infra import google_storage_bucket_iam_member.backup_imports_vm_object_admin "b/agent-forall-backup-imports roles/storage.objectAdmin serviceAccount:agent-forall@agent-for-all.iam.gserviceaccount.com"
terraform -chdir=infra apply -target=google_storage_bucket.backup_imports -target=google_storage_bucket_iam_member.backup_imports_vm_object_admin
```

---

## Production runtime state

| Resource | State |
|---|---|
| `agent-forall` VM | `e2-highmem-4`, IP `34.90.58.155`, healthy. `deletionProtection=true` + `lifecycle.prevent_destroy` (2026-08-29). **Do not reboot** — open issue 3. |
| `agent-forall-data` disk | 80 GB pd-balanced, `autoDelete=false`, `/mnt/docker` via UUID+`nofail` in fstab, Docker `data-root`. Created out-of-band 2026-08-29 — not in Terraform state. |
| `api.agentforall.co.il` | Caddy + Let's Encrypt, `/health` → 200 |
| `orchestrator` container | GAR image digest `sha256:bf4777ab90929b66e593440ac839091985ce0f715ee7a030641d258b65cdf95c` (verified running 2026-08-29) |
| `openclaw-browser` image | GAR digest `sha256:d99dec8d55379dcce9cc35a8971675ce38b37d4ee8c5c876fb3bcf879359844f` (OpenClaw 2026.7.1, WhatsApp plugin + `agentforall-credit` preinstalled, Playwright Chromium prewarmed) |
| `litellm-gateway` Cloud Run | 1 vCPU / 3 GiB, `minScale=1`, `cpu-throttling=false`, revision `litellm-gateway-00009-r8r` (downsized from 2 vCPU / 4 GiB on 2026-08-29) |
| `whatsapp-pairing` image | GAR digest `sha256:20b44400bee9b7ea9c5e233d9dfc779434922b92fd9b9a9dc444ae8054544a57` |
| Tenant containers | per-tenant `openclaw-<shortId>` + state volume `oc-<shortId>-state` |
| Supabase `instances` | host-scoped via `host_id` column. Local = `local-dev`, VM = `agent-forall-vm`. |
| Supabase `leads` | preserved (7 rows). Better Auth tables intact. |
| Daily snapshots | boot disk only, 03:00 UTC, 14-day retention (Terraform-managed). **`agent-forall-data` is not yet in the snapshot policy.** |

**Docker storage (2026-08-29):** containerd snapshotter (`overlayfs` / `io.containerd.snapshotter.v1`), so `data-root` covers **volumes + container metadata only**. Image layers stay in `/var/lib/containerd` on the boot disk (9.9 GB / 8 images after the 2026-08-29 `docker image prune -af`) and re-pull from GAR. Tenant volumes = 4.2 GB, now on `agent-forall-data` (added to the daily snapshot policy 2026-08-29 — it was uncovered between the migration and that fix). Pre-migration `/var/lib/docker` deleted 2026-08-29.

**Costs (30 Jul – 28 Aug 2026, `agent-for-all` only):** ₪928.20 gross, **₪0.00 net** — credits cover it. Compute ₪468.08 (RAM ₪226.89 / vCPU ₪211.63 / disk+IP ₪26.66), Cloud Run ₪349.52, Cloud SQL ₪95.79, rest ₪14.81. The Cloud Run downsize cuts ~₪160/mo.

**Credit runway:** GFS Ecosystem Partner, $14,971.39 of $25,000 left, expires 2028-03-09. Account-wide burn ₪7,293.82/mo (`compledio` = ₪6,365.61), so **credits run out ~April 2027**.

---

## Vercel environment variables

| Var | Value |
|---|---|
| `DATABASE_URL` | Supabase pooler URL (matches `apps/orchestrator/.env`) |
| `BETTER_AUTH_URL` | `https://agentforall.co.il` (apex, exact) |
| `BETTER_AUTH_SECRET` | random 32-byte hex |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Google Cloud Console OAuth 2.0 client; redirect URI `${BETTER_AUTH_URL}/api/auth/callback/google` |
| `META_CAPI_ACCESS_TOKEN` | server-side lead tracking |
| `ADMIN_PASSWORD` | set |
| `NEXT_PUBLIC_META_PIXEL_ID` | `803144279101703` |
| `ORCHESTRATOR_BASE_URL` | `https://api.agentforall.co.il` |
| `ORCHESTRATOR_SERVICE_TOKEN` | matches GSM `dashboard-service-token` |
| `NEXT_PUBLIC_APP_URL` | `https://agentforall.co.il` |
| `NEXT_PUBLIC_ESIM_PARTNER_URL` | placeholder OK (`https://esimdb.com`) |

Stale (can delete): `ORCHESTRATOR_PROVIDER`, `ORCHESTRATOR_PROVIDER_API_KEY`, `ORCHESTRATOR_PROVIDER_MODEL`. Not set: `RESEND_API_KEY`, `AUTH_EMAIL_FROM` (deferred).

---

## GSM secrets (out-of-band, operator-managed)

Pattern: secrets created once with `gcloud secrets create`; values populated via `gcloud secrets versions add`. Terraform references via `data` source, owns only IAM bindings. Never `resource "google_secret_manager_secret"` for values we own.

| Secret | Purpose |
|---|---|
| `database-url` | Supabase pooler connection string |
| `encryption-key` | 64-hex-chars; encrypts `instances.gateway_token` + `instances.whatsapp_creds`. ⚠️ Rotation requires re-encrypting all rows. |
| `dashboard-service-token` | bearer token Vercel uses to call orchestrator. Matches Vercel env `ORCHESTRATOR_SERVICE_TOKEN`. |
| `default-provider-api-key` | LLM provider API key (currently Gemini, switching to OpenAI) |
| `composio-api-key` | Composio project API key for integrations. Never enters a tenant container (see `docs/integrations.md`). Create before deploying the integrations orchestrator image; `startup.sh` reads it on every boot. |

VM startup script reads these on every boot via `gcloud secrets versions access latest`. Restart the VM to pick up rotated values.

---

## Catalog paging + dashboard redesign (2026-08-28, DEPLOYED — commit `1194119`+follow-up, orchestrator `bf4777ab…`)

- Orchestrator `orchestrator@sha256:bf4777ab90929b66e593440ac839091985ce0f715ee7a030641d258b65cdf95c` (Cloud Build `2eb5b811`, 2026-08-28 ~05:00 IL) force-recreated on the VM. Catalog route now takes `offset` (≤10,000) and answers `{ data, total }`; verified live: `limit=1` → `total=1380`, `offset=5` → slack, `offset=99999` → 400. Rollback: `566ea877…` (the web falls back to page-length totals against it — no paging button, nothing breaks).
- Web (same commit, Vercel auto-deploy from push): connections page is ONE list (connected → curated Hebrew shortlist (20 apps incl. monday/Wix/LinkedIn/Zoom/Canva/DocuSign) → whole catalog behind "עוד אפליקציות" paging); search==browse (same paged query), Hebrew queries hoist curated matches; provider English descriptions no longer rendered. Dashboard card: single-line header, icon-circle open buttons, quiet actions are outlined pills, logo showcase (server-fetched, text fallback), loading.tsx on every dynamic route incl. /admin.
- Owner-number prompt ("הגדרת המספר שלי") gated on a connected WhatsApp row (was showing before pairing).

## Integrations (2026-08-27, DEPLOYED — commit `3c27e5e`, orchestrator `566ea877…` incl. catalog search + stale-attempt prune; web UX pass on Vercel)

Deployed 2026-08-27 01:30 IL: migration 0011 applied to Supabase; GSM `composio-api-key` created + IAM binding applied (targeted `terraform apply`); VM `.env.runtime` got `INTEGRATIONS_PROVIDER=composio`, `COMPOSIO_API_KEY`, `DASHBOARD_ORIGIN` by hand; Caddyfile got the `/api/v1/mcp/*` → 404 block by hand. Orchestrator `orchestrator@sha256:cb685b59b8f5f57e19d9c9b5bbe318ed6b7c3012cf89b650dd09a6e2245e9370` (Cloud Build from `2e148d5`) force-recreated: healthy in 4s, both networks, log `integrations provider: composio`, `GET /api/v1/integrations/catalog` returns the live catalog, public relay path → 404 from Caddy. Web deployed to Vercel `agentforall` (`https://agentforall-nwpkfhjdm-avi711s-projects.vercel.app`, aliased to `https://agentforall.co.il`).

Gotchas learned:
- OpenClaw 2026.7.1 does NOT hot-load new `mcp.servers` into a running gateway (config apply says `applied`, but zero MCP activity until reboot — hit live on קוקי2, bot said "אין לי כלים"). Fixed: the first connect per bot now fires a detached restart while the user is on the consent screen (orchestrator `1e0…`+). Existing bots that connected before that fix need one manual restart.
- `docker exec agent-forall-caddy caddy reload` exits 0 but did NOT apply the new Caddyfile; `docker compose restart caddy` did (≈3s API blip).
- **Do not `terraform apply` the `google_compute_instance.platform` change.** The startup-script edit shows as `forces replacement` — it would destroy the VM and every tenant volume. The script in git is the source of truth for a fresh VM; the live VM was patched by hand. Fix later by moving the script to `metadata = { startup-script = … }` (in-place update) before any full apply. `terraform plan` also shows unrelated drift (monitoring alert policies, a `litellm-master-key` IAM member) — review before applying anything untargeted.
- On a VM reboot the old startup script would regenerate the Caddyfile WITHOUT the relay block (env vars survive). Re-add the block or land the startup-script fix first.
- 2026-08-27 evening: "Drive shows disconnected although connected" was an account mismatch, not a sync bug — the dashboard session owned bot `b952dbaa…` (user `yaVH…`) while the Telegram bot handing out links was קוקי2 `e43f2627…` (user `lJ6x…`); Composio had Drive ACTIVE under `e43f2627` only. The page now names the bot in its header. Same pass: catalog is searched in the orchestrator (page payload 440 KB → ~15 KB), the list refreshes on tab focus/bfcache and polls while pending, abandoned attempts (`expired`/`failed`) are pruned on reconnect, and `apps/web/vercel.json` pins functions to `fra1` (DB is eu-central-1, VM europe-west4; default was us-east) — takes effect on the next Vercel deploy.

### Original build notes

One-click third-party app connections per bot via Composio Tool Router sessions, behind a provider port with a mock adapter; design and security model in `docs/integrations.md`. The Composio project key authenticates every session's MCP URL, so tenant containers never hold it: OpenClaw talks to the orchestrator's relay (`/api/v1/mcp/:instanceId`, per-bot bearer in `InstanceConfig.integrations`, encrypted at rest) and the orchestrator forwards with the key. Verified in the pinned `openclaw-browser:2026.7.1` image that `mcp.servers.<name>` with `streamable-http` + `headers` passes `openclaw config validate`.

Deploy order:
1. `npm run -w @agent-forall/db db:migrate` — applies `0011_integration_sessions` (one new table, no changes to `instances`).
2. Create a Composio project (keep `require_mcp_api_key: true`; scope the key to Sessions, Connected accounts, Toolkits) and `gcloud secrets create composio-api-key` + `versions add`; `terraform -chdir=infra apply` for the new IAM binding (`vm_secret_ids`).
3. Build + deploy the orchestrator image; `startup.sh` now writes `INTEGRATIONS_PROVIDER=composio`, `COMPOSIO_API_KEY`, `DASHBOARD_ORIGIN` and blocks `/api/v1/mcp/*` at Caddy (regenerated on reboot — for a no-reboot deploy, patch `.env.runtime` and `Caddyfile` by hand and `docker compose up -d`). Without the env the orchestrator boots with integrations disabled (routes answer 503 `FEATURE_UNAVAILABLE`, dashboard page shows "עוד לא זמין").
4. Deploy web; no new Vercel env.
5. Smoke: create bot → `/app/bot/connections` → connect Gmail → back with `?connected=gmail` → tile shows מחובר; in the container `openclaw.json` has `mcp.servers.agentforall` with the relay URL and NO `x-api-key`; `curl https://api.agentforall.co.il/api/v1/mcp/<id>` → 404 from Caddy; delete bot → Composio shows no connected accounts for that `user_id`.

Verified against the live Composio API on 2026-08-27 with the project key: session create → `{session_id, mcp.url}`; the MCP URL answers 401 without `x-api-key` and 200 (SSE `initialize` result) with it — the relay is mandatory, not optional; `/link` → `{redirect_url, connected_account_id}`; connected accounts carry `toolkit.slug`, `status` (`INITIALIZING` before OAuth completes → shown as pending), `created_at`; toolkits: 1,412 managed, logo lives at `meta.logo`. Probe session and account were deleted afterwards.

Known follow-ups: connection-expiry webhook, relay-token rotation, own Google OAuth app (consent screen branding; CASA needed for Gmail read).

## Billing (2026-08-26, deployed to Vercel in `0d2a8ab`; billing disabled until `PAYMENT_PROVIDER` is set)

Provider-agnostic subscription billing landed in `apps/web/src/lib/billing/` with a **mock gateway only** — the Israeli provider (PayPlus / HYP / Grow) is still to be chosen. Design, data model, event semantics, and the adapter checklist are in `docs/billing.md`.

- Migration `0010_billing` (7 new tables) is generated and verified on a disposable Postgres 16 (migrations 0000–0010 apply clean; 12 repository integration tests pass) and **applied to prod on 2026-08-26** (`drizzle-kit migrate`, all 7 tables created, nothing existing touched). Regenerating it re-emits stale `ALTER TABLE "instances"` lines because 0007–0009 have no snapshots — strip them.
- Vercel prod has `CRON_SECRET` set (2026-08-26); `PAYMENT_PROVIDER` and `BILLING_REQUIRED` are intentionally unset until the Israeli adapter lands. Smoke after deploy: `/api/billing/status` → 401, `/api/billing/cron/sync` → 401, `/api/billing/webhooks/mock` → 404.
- New Vercel env: `PAYMENT_PROVIDER` (unset = billing disabled, status reads still work), `BILLING_REQUIRED` (default false = never blocks bot creation). `MOCK_PAYMENT_WEBHOOK_SECRET` is dev-only; the mock adapter refuses `NODE_ENV=production`.
- Webhook endpoint: `POST /api/billing/webhooks/<provider>`. Bot creation routes return `402 payment_required` only when `BILLING_REQUIRED=true`.
- Account deletion now cancels the subscription at the provider before the orchestrator cleanup; a provider failure aborts the deletion.
- **Credits** replace the ₪-formatted USD budget in the UI. 1 credit = $0.005 gateway spend; tiers ₪100→1,000 · ₪200→2,500 · ₪400→6,000 credits per period (change = cancel at period end + new checkout), trial = 400 for 7 days on first bot, top-ups any ₪20–₪500 (presets ₪50/₪100/₪200, ₪1 = 20 credits). All numbers in `apps/web/src/lib/billing/pricing.ts`. The web now sets each bot's LiteLLM `max_budget` from the ledger via `PATCH /:id/litellm-budget`, which now accepts 0 (orchestrator change → new image needed). Daily Vercel Cron `/api/billing/cron/sync` (env `CRON_SECRET`) re-caps bots after expiries. Orchestrator change: `PATCH /:id/litellm-budget` no longer resends `budget_duration` (LiteLLM rewrites `budget_reset_at` whenever it is present, which would corrupt the credit cursor). **LiteLLM env switch (do this the day `BILLING_REQUIRED=true` goes on, not before):** while billing is off, users get no grants and run on the gateway default (`LITELLM_DEFAULT_BUDGET_CENTS=5000`, `_DURATION=30d`, unchanged in `.env.runtime` and `infra/startup.sh`). When enforcement turns on: set `LITELLM_DEFAULT_BUDGET_CENTS=200` (a fresh key holds the trial's $2 until the post-create sync pushes the real cap) and `LITELLM_DEFAULT_BUDGET_DURATION=` (empty → never reset; a 30d reset would let a bot re-spend a whole period before the next sync) in `.env.runtime` and `startup.sh`, recreate the orchestrator, and clear the reset once on every existing key (`/key/update` with `budget_duration: null`). The orchestrator image in prod already sends only `max_budget` on updates and accepts 0, so no image rebuild is needed for that switch. Second and third review passes (2026-08-26) closed: delete-bot-and-recreate no longer resets the cap (`beforeBotDelete` settles spend, fails closed), users with no ledger are never capped, renewals validate amount/currency, stale charges cannot revive a cancelled order, a new order ends any older live one, deletion waits for pending checkouts, one trial per mailbox (`billing_trial_claims`, deleted accounts included, claim result honoured), users entitled without a trial (beta / enforcement off / paid) get no trial and are never capped, renewals validated against the order's last paid amount (price rises don't break loyal subscribers), `error` bots skipped by sync and delete-settlement, poison events stop after `MAX_EVENT_ATTEMPTS`, cron syncs least-recently-synced first. Verify on staging (LiteLLM v1.83.14): `max_budget: 0` blocks rather than disables, `/key/update` takes effect immediately (auth cache), and `/key/update` without `budget_duration` leaves `budget_reset_at` untouched.

---

## Blog (2026-08-26)

`/blog` + `/blog/<slug>` via the official `@next/mdx` setup (`createMDX` in `next.config.ts`, `src/mdx-components.tsx` for prose styling + the `Figure` component). Posts live in `apps/web/src/content/blog/<slug>.mdx`, each exporting `metadata` (`PostMeta` in `src/lib/blog/index.ts`); adding a post = one MDX file + its slug in `POST_SLUGS` (sitemap, index, and static params derive from it). Article/Breadcrumb/FAQ JSON-LD per post; `public/llms.txt` lists them. Images are Nano Banana Pro (Compledio) illustrations in the site palette, stored as 1600px webp under `public/blog/<slug>/{cover,inline-1}.webp`. Eight posts: personal-agent explainer, pricing/credits, WhatsApp uses, Telegram vs WhatsApp, small-business agent, service-bot vs personal-agent, OpenClaw in Hebrew, privacy.

## Open issues

### 1. First-message-lost on fresh tenant containers (PARTIALLY MITIGATED — STILL OPEN)

**Symptom:** after pairing, the first inbound message arrives at OpenClaw. Agent processing starts → ~1-2 minutes silence → Baileys `Web connection closed (status 408)` + `[whatsapp] [default] channel exited`. The 1st message is dropped. The 2nd and 3rd messages reply normally (35-41s on prod, 14-19s local).

**What's been verified:**
- `gemini-3-flash-preview` returns empty/incomplete responses with streaming + tools — [google/adk-python#4090](https://github.com/google/adk-python/issues/4090). Affects both local + prod.
- [openclaw/openclaw#71127](https://github.com/openclaw/openclaw/issues/71127): OpenClaw stuck-session diagnostic emits WARN but has NO auto-recovery.
- Direct `curl` to Gemini API from prod VM succeeds — not a network/quota issue.
- No GA `gemini-3-flash` exists; only `gemini-3-flash-preview`.

**Historical (2026.4.25; the whole `web.*` block was removed in 2026.8.2, the plugin owns reconnects):**
- `docs.openclaw.ai/channels/whatsapp` Troubleshooting prescribes `web.whatsapp.keepAliveIntervalMs`, `connectTimeoutMs`, `defaultQueryTimeoutMs` to mitigate 408.
- **We tried it. The OpenClaw zod schema in 2026.4.25 is `.strict()` and rejects `web` as an unknown key under `channels.whatsapp`** → gateway fails to start with `Invalid config: channels.whatsapp: Unrecognized key: "web"`.
- Verified by inspecting `/app/dist/zod-schema.providers-whatsapp-Cxadn1_t.js` inside the running container. Real WhatsApp config keys: `accounts, actions, allowFrom, authDir, blockStreaming, capabilities, chunkMode, configWrites, defaultAccount, defaultTo, direct, dmHistoryLimit, dms, emoji, enabled, group, groupAllowFrom, historyLimit, mediaMaxMb, messagePrefix, name, polls, reactionLevel, reactions, requireMention, responsePrefix, selfChatMode, sendMessage, sendReadReceipts, systemPrompt`. **No timing knobs at all.**
- Latest OpenClaw is 2026.4.29 — possibly added these fields. Untested.

**Working alternatives for the LLM bug** (verified):
- `gemini-2.5-flash` (stable, GA, explicitly cited as workaround in #4090) — user rejected as "legacy" 2026-05-02
- `claude-haiku-4-5`, `claude-sonnet-4-6`
- `gpt-4o-mini`, GPT-5.x

**Paths forward** (in order of effort):
1. OpenClaw is currently bumped to `2026.5.27` and new bot creation defaults to OpenClaw. If upgrading again, rebuild the custom image, smoke-test, push to GAR, and pin by digest before production use.
2. **Switch LLM provider** to one that doesn't have the empty-response bug
3. **Live with it** — 1st message lost, 2nd+ work; prewarm + ShmSize already mitigate the secondary causes

### 2. Why prod replies are 2x slower per turn than local (35-41s vs 14-19s)

Honest answer: not definitively known. Likely contributors (none verified individually):
- Cold agent/browser/memory-core state on prod after VM replace; local has warm caches from prior runs
- Chromium browser plugin spawn on first use
- Possibly disrupted internal state after the 1st-message 408+reconnect cycle eats turns

To diagnose: run identical fresh containers in both envs with same first message, time each step from the internal log (`/tmp/openclaw/openclaw-<date>.log` has per-call latencies); compare `time curl` to `generativelanguage.googleapis.com` from both.

### 3. VM startup-script drift — DO NOT REBOOT (found 2026-08-29)

Deployed `metadata_startup_script` differs from `infra/startup.sh` in 75 lines: BOM + ANSI-mangled em-dashes (`???`), older `ORCHESTRATOR_IMAGE`/`AGENT_RUNTIME_IMAGE` digests, and **missing the `LITELLM_MASTER_KEY` + `COMPOSIO_API_KEY` fetches**. A reboot comes up without those secrets. Unbitten only because the VM is up since 2026-05-02.

The field is ForceNew → Terraform wants to replace the instance; `prevent_destroy` now makes that plan **error**, so every apply needs `-target` (the 2026-08-29 Cloud Run change used `-target=google_cloud_run_v2_service.litellm`).

Also missing from state, so the plan wants duplicates: `google_monitoring_alert_policy.vm_disk_warning` / `vm_disk_critical` (exist in GCP since 2026-05-26 → `terraform import`). `google_secret_manager_secret_iam_member.vm_secret_access["litellm-master-key"]` is genuinely absent → create.

Fix: tenant volumes now survive instance replacement, so update script + digests, replace deliberately, restore `prevent_destroy`. Add `.gitattributes` (`*.sh text eol=lf`) to stop PowerShell reintroducing the BOM.

---

## Uncommitted local changes (deployed via image build, NOT in git)

These are live on prod via the GAR images but unstaged in the working tree.

**Orchestrator backend (host-scoping + cold-start UX + ShmSize fix):**
- `apps/orchestrator/src/services/pairing-manager.ts` — removed `lastSeenAt: new Date()` from pair completion (pair is a credential event, not a "seen" event)
- `apps/orchestrator/src/services/health-monitor.ts` — pass `{ markSeen: true }` to `repo.updateHealth` on healthy probe
- `apps/orchestrator/src/services/container-runtime.ts` — added `ShmSize: 2 * 1024 * 1024 * 1024` to tenant `HostConfig` (Chromium crashes on default 64 MB `/dev/shm`)
- `apps/orchestrator/src/storage/instance-repository.ts` — `updateHealth` accepts `{ markSeen?: boolean }`; entire repo scoped via `ownedByHost()` filter
- `apps/orchestrator/src/config.ts`, `main.ts`, `domain/types.ts` — `orchestratorHostId` zod-validated env var, threaded through repo constructor
- `apps/orchestrator/src/domain/constants.ts`, `runtime-users.ts`, `openclaw-config.ts` — supporting domain code (new files)
- `apps/orchestrator/src/routes/pair.ts`, `services/pairing-manager.ts`, `services/health-service.ts`, `storage/event-repository.ts` — pairing sidecar + event log + health route (new files)
- `apps/orchestrator/src/services/config-generator.ts` — note: a `web.whatsapp` block was attempted then reverted; kept only base config
- `apps/whatsapp-pairing/**` — entire new package (Baileys sidecar)
- `packages/db/drizzle/0005_host_id_scoping.sql` + `meta/0005_snapshot.json` — applied to Supabase
- `packages/db/src/schema/instances.ts` — `host_id` column declaration

**Infra:**
- `infra/images/openclaw-browser/Dockerfile` — switched from `apt install chromium` to Playwright-managed chromium per docs (`node /app/node_modules/playwright-core/cli.js install --with-deps chromium` + `PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright`); kept `RUN openclaw doctor --fix --non-interactive` prewarm step
- `infra/startup.sh` — `OPENCLAW_IMAGE` points to GAR; `ORCHESTRATOR_HOST_ID=agent-forall-vm` self-heal block
- `infra/terraform.tfvars` — `machine_type = "e2-highmem-4"`
- `infra/main.tf`, `infra/outputs.tf`, `infra/variables.tf` — terraform modules
- `.github/workflows/build-and-push.yml` — GHA workflow (untracked, manual builds for now)

**Env files (gitignored, local-only):**
- `apps/orchestrator/.env` — has model, api key, host_id=local-dev
- `apps/orchestrator/.env.example`, root `.env.example` — updated openclaw image path

**Docs (uncommitted):**
- `DEPLOY_HANDOFF.md`, `CLAUDE.md`, `README.md`, `SESSION_SUMMARY.md`, `docs/`
- `.dockerignore`, `docker-compose.yml`, root `package.json`, `package-lock.json`
- `backups/` (gitignored)
- 4 deleted MP4 files (intentional — moved to `D:\Projects\remotion-vid`)

**Suggested commit themes** (don't commit en-masse without per-turn auth):
1. orchestrator backend + db schema (host-scoping + cold-start UX backend)
2. infra (prewarm Dockerfile + GAR consolidation + VM upgrade tfvars + startup self-heal)
3. pairing sidecar (`apps/whatsapp-pairing/`)
4. docs/handoff cleanup

---

## How to resume (next session)

1. Read this file top-to-bottom (especially TL;DR + Open issues).
2. `git log -5 --oneline` — confirm `e70ea60 feat(web): friendlier loading panel during bot creation` is the latest on `main`.
3. `git status --short` — expect ~40 modified/untracked files (see "Uncommitted local changes" above). **Don't commit en-masse without per-turn auth.**
4. Before provider work, verify `npm run test`, `npm run typecheck`, and `npm run build` pass after the robustness patch.
5. **Next product task: switch LLM provider to OpenAI.**
   - Confirm exact published OpenAI model name (user said "GPT-5.5"; verify it actually exists at that name as of resume date — may be `gpt-5.5`, `gpt-5o`, `gpt-5.x`, etc.)
   - Get OpenAI API key from user
   - Local first: edit `apps/orchestrator/.env` → `DEFAULT_PROVIDER_NAME=openai`, `DEFAULT_PROVIDER_API_KEY=<key>`, `DEFAULT_PROVIDER_MODEL=<model>`. Test end-to-end.
   - Update GSM: `echo -n '<key>' | gcloud secrets versions add default-provider-api-key --data-file=- --project=agent-for-all`
   - Update `infra/startup.sh` lines 99-101 (provider name + model).
   - Update VM `.env.runtime` via SSH OR re-run `terraform apply` (startup.sh change forces VM replace, ~5 min downtime).
   - Force-recreate orchestrator container or reboot VM.
6. After provider works end-to-end: ship the uncommitted backend + infra changes via themed commits (with per-turn auth).
7. **Don't trust subagents blindly.** This codebase has had ≥3 hallucinated subagent claims (fake env vars `OPENCLAW_PLUGIN_STAGE_DIR` layered colon paths, fake openclaw CLI commands). The 2nd subagent in 2026-05-02 was correct on issue #71127 + adk-python #4090 ONLY because I WebFetched those URLs to verify. Always verify a load-bearing claim with WebFetch before implementing.

---

## Memory entries (auto-loaded; respect these without prompting)

`C:\Users\avrah\.claude\projects\D--Projects-agent-forall\memory\MEMORY.md` is the index. Critical entries:
- `feedback_production_grade.md` — agent-forall is production. Recommend KMS/mTLS/per-tenant patterns first; never frame as "MVP".
- `feedback_secrets_bootstrap.md` — secrets created out-of-band by operator; Terraform via `data` source only.
- `feedback_comments.md` — short or none. No JSDoc preambles in `.ts/.tsx/.sql`. One-line max.
- `feedback_git.md` — never commit/push without explicit per-turn authorization.
- `feedback_design_ad.md` — no AI slop, light/cream design, ask before changing reels/ads.
- `project_openclaw_lazy_install_bug.md` — UPDATED 2026-05-02. Lazy-install RESOLVED via prewarm. New blocker is gemini-3-flash-preview empty-response.

---

## Operational reference

### Image rebuild + push

**Orchestrator:**
```bash
cd /d/Projects/agent-forall
IMAGE_TAG=$(git rev-parse HEAD)
docker build -f apps/orchestrator/Dockerfile -t europe-west4-docker.pkg.dev/agent-for-all/agent-forall/orchestrator:$IMAGE_TAG .
gcloud auth configure-docker europe-west4-docker.pkg.dev --quiet  # one-time
docker push europe-west4-docker.pkg.dev/agent-for-all/agent-forall/orchestrator:$IMAGE_TAG
```

For production, deploy the git-SHA tag or record the pushed digest, update `infra/variables.tf`, then deploy that exact ref.

**openclaw-browser:** build from the repo root — the image bakes in `packages/openclaw-plugin-credit` and `packages/openclaw-plugin-media`, so the old `infra/images/openclaw-browser/` build context no longer works.
```bash
gcloud builds submit --project agent-for-all --config cloudbuild.openclaw-browser.yaml --region europe-west4 .
```

### VM redeploy after image push

Container env vars in `/home/deploy/agent-forall/.env.runtime`. Force-recreate orchestrator:
```bash
gcloud compute ssh deploy@agent-forall --zone=europe-west4-a --project=agent-for-all --command='\
  cd /home/deploy/agent-forall && \
  sudo env ORCHESTRATOR_IMAGE=europe-west4-docker.pkg.dev/agent-for-all/agent-forall/orchestrator@sha256:<digest> docker compose pull orchestrator && \
  sudo env ORCHESTRATOR_IMAGE=europe-west4-docker.pkg.dev/agent-for-all/agent-forall/orchestrator@sha256:<digest> docker compose up -d --force-recreate orchestrator'
```

The orchestrator must be attached to both Docker networks: `agent-forall_frontend` for Caddy and `tenant-net` for `docker-socket-proxy` and tenant containers. If recreated manually, connect `tenant-net` with alias `docker-socket-proxy` before health verification.

If `.env.runtime` missing a new env var (e.g. when adding `ORCHESTRATOR_HOST_ID`):
```bash
sudo grep -q "^ORCHESTRATOR_HOST_ID=" .env.runtime || echo "ORCHESTRATOR_HOST_ID=agent-forall-vm" | sudo tee -a .env.runtime
```
The startup.sh self-heal block also handles this on next boot.

### GSM secret rotation

```bash
echo -n '<new-value>' | gcloud secrets versions add <secret-name> --data-file=- --project=agent-for-all
# secrets re-read on each VM boot; reboot or force-recreate orchestrator to pick up
```

Initial creation (one-time, already done for current secrets):
```bash
gcloud services enable secretmanager.googleapis.com --project=agent-for-all
gcloud secrets create <name> --replication-policy=automatic --project=agent-for-all
```

### Bootstrap a fresh VM (disaster recovery)

```bash
cd infra
terraform plan        # expect no changes if state matches
terraform apply       # creates VM + IAM + WIF + secret bindings + snapshot policy
terraform output      # capture github_actions_wif_provider, github_actions_service_account, external_ip
```

After apply, VM startup script (~5 min): installs Docker, fetches GSM secrets, writes `.env.runtime`, generates `docker-compose.yml` + `Caddyfile`, pulls images, runs `docker compose up -d`.

### Tenant lifecycle on a host

- Bot row created in `instances` (status=`provisioning`, `host_id` stamped from `ORCHESTRATOR_HOST_ID`)
- Container created: `openclaw-<shortId>` on the `tenant-net` Docker network
- Per-tenant Docker volume `oc-<shortId>-state` mounted at `/home/node/.openclaw` (memory persistence; survives container recreation)
- Pair completes → creds injected via `docker exec`, container restarts, gateway picks up creds
- Health monitor (every 15s) probes gateway, marks `lastSeenAt` on success, escalates to `degraded` / `unhealthy` on consecutive failures
- Reconciler (every 60s, host-scoped) heals stale rows, completes orphaned destroys

### OpenClaw tenant memory backup

`~/.openclaw/` per-tenant volume contains workspace/agents/tasks/identity/devices/media/openclaw.json. Product flow now supports dashboard download/upload. Manual backup remains useful for ops:
```bash
sudo docker exec <container> sh -c "cd /home/node/.openclaw && tar -czf /tmp/soul.tar.gz workspace agents tasks delivery-queue identity devices media openclaw.json openclaw.json.bak"
sudo docker cp <container>:/tmp/soul.tar.gz /local/path.tar.gz
```
Excludes `plugin-runtime-deps` (regenerable from image prewarm) and `whatsapp-session` (already encrypted in DB).

To restore into a new container:
```bash
sudo docker cp soul.tar.gz <new-container>:/tmp/
sudo docker exec <new-container> sh -c "cd /home/node/.openclaw && tar -xzf /tmp/soul.tar.gz"
```

Backups directory: `D:\Projects\agent-forall\backups\` (gitignored).

Product backup detail: downloads are prepared by the orchestrator, not Next.js. Web starts an export job, polls for readiness, then navigates directly to the signed GCS URL. OpenClaw creates a temporary gzip tar under `/tmp`; orchestrator streams that file through Docker exec into a GCS resumable upload session with a fixed `Content-Length`, removes the temporary file, and stores only a short-lived GCS object. Uploaded backups are gzip tar archives. Web asks orchestrator for a short-lived GCS resumable upload URL, browser uploads the archive directly to `storage.googleapis.com`, then web calls `/api/bot/import-complete` with a restore token. Orchestrator opens the GCS object as a stream, rewraps gunzip/tar into `/home/node/.openclaw`, preserves imported OpenClaw model/provider settings, refreshes only runtime-owned gateway auth/env, then deletes the temporary object after successful or invalid restore. Transient container/DB failures keep the object so restore can be retried.

### DB cleanup pattern (preserve leads)

```javascript
// node -r dotenv/config script.js dotenv_config_path=apps/orchestrator/.env
const { Pool } = require('pg');
const p = new Pool({ connectionString: process.env.DATABASE_URL });
await p.query('BEGIN');
await p.query("DELETE FROM instance_events WHERE instance_id = ANY($1)", [ids]);
await p.query("DELETE FROM instances WHERE id = ANY($1)", [ids]);
await p.query('COMMIT');
// NEVER touch leads, user, session, account, verification tables
```

### Migrations

```bash
npm run -w @agent-forall/db generate     # create from schema diff
npm run -w @agent-forall/db db:migrate   # apply explicitly before deploy
```
Tracking table: `drizzle.__drizzle_migrations`. Idempotent. Never edit a migration after it's applied to a deployed env.

Applied through `0007_backup_import_state`. Migration 0005 was hand-rewritten as 3-step backfill (auto-generated `ADD COLUMN ... NOT NULL` would have failed on populated tables):
```sql
ALTER TABLE "instances" ADD COLUMN "host_id" text;
UPDATE "instances" SET "host_id" = 'agent-forall-vm' WHERE "host_id" IS NULL;
ALTER TABLE "instances" ALTER COLUMN "host_id" SET NOT NULL;
CREATE INDEX "idx_instances_host_id" ON "instances" USING btree ("host_id");
CREATE INDEX "idx_instances_host_status" ON "instances" USING btree ("host_id","status");
```

### Capacity planning

- `e2-highmem-2` (2 vCPU/16 GB): 4-6 active tenants, ~$80/mo
- `e2-highmem-4` (4 vCPU/32 GB): **current**, ~10-12 active tenants, ~$155/mo
- `e2-highmem-8` (8 vCPU/64 GB): ~20-25 active tenants, ~$285/mo
- Multi-VM split: at >30 active tenants, add a second VM (host-scoping is already in place)

Per-tenant resource cap: 4 GB RAM ceiling (`DEFAULT_RESOURCE_LIMITS` in `apps/orchestrator/src/domain/types.ts`). Not reservation — actual usage typically <1 GB.

---

## Architectural decisions (don't relitigate)

| Decision | Why |
|---|---|
| Single VM + Docker, NOT Kubernetes | 1-VM 10-100 tenants. `ContainerRuntime` is abstracted; future K8s migration possible. |
| `e2-highmem-4` (Netherlands `europe-west4`) | EU-adequate jurisdiction for Israeli privacy law. Anthropic has no EU inference yet (April 2026). |
| Supabase, NOT self-hosted Postgres | Single source of truth across web + orchestrator. Managed backups. |
| GAR for ALL images (orchestrator, pairing, openclaw-browser) | VM auths via service account metadata server, no PAT to manage. (openclaw-browser was on GHCR until 2026-05-02 when the PAT rotation forced a move.) |
| WIF for GitHub Actions, NOT JSON keys | Production-grade keyless OIDC trust. |
| Single-container OpenClaw with Chromium baked, NOT per-tenant sandbox-browser sidecar | Below 30 paying users, sidecar pattern doubles container count. Migration path open. |
| LLM provider config on orchestrator, NOT web | Sensitive API key shouldn't be in Vercel env. Web sends only `{displayName, channels}`. |
| Caddy auto-TLS, NOT GCP managed cert / Cloud LB | $18/mo+ for LB, simple Caddyfile. Switch to LB at multi-VM. |
| `docker-socket-proxy` between orchestrator and Docker daemon | Defense in depth. Same pattern as Traefik / Coolify / Dokploy. |
| Host-scoping via `host_id` column (K8s `nodeName`/Nomad `node_id` analog) | Multiple orchestrators (multi-host prod, blue/green, local dev) can share one DB without stomping. |
| Plugin prewarm via `RUN openclaw doctor --fix` at image build time | Officially blessed pattern in OpenClaw docs ("prewarm the image in your release lane"). Eliminates first-message lazy-install storm. |
| `lastSeenAt` only set on healthy probe (not at pair-completion) | Pair is a credentials event, not a "seen" event. Clean dashboard UX. |

---

End of handoff.

## Channel access & sessions (2026-08-21)

- `session.dmScope` is now `per-peer` for every instance (was OpenClaw default `main`). Strangers get isolated sessions; `session.identityLinks.owner` folds the owner's `telegram:<id>` + `whatsapp:<+E164>` into one session key (`agent:main:direct:owner`). Rollout cost: one-time chat-context reset per bot (workspace/memory files untouched).
- WhatsApp channel config carries `dmAccess` (`owner` | `open`) + `ownerNumber`:
  - undefined (legacy, pre-rollout) → still `dmPolicy: open, allowFrom: ["*"]`; dashboard nudges the user to restrict.
  - `owner` + no number → `dmPolicy: pairing` (claim mode): first message from the owner's phone shows up in the dashboard via `openclaw pairing list whatsapp --json`, user taps "זה אני". Self-chat (same number as bot) never enters pairing → "כן, זה המספר שלי" shortcut; manual E.164 entry always available.
  - `owner` + number → `dmPolicy: allowlist, allowFrom: [number]`. `open` → wildcard, owner still linked.
- New instances default to `owner` (`domain/channels.ts applyChannelDefaults`). Access policy + `session` are orchestrator-owned in the runtime patch merge (`generated` wins over on-disk config).
- API: `GET/PATCH /api/v1/instances/:id/whatsapp/access` (orchestrator), `GET/PATCH /api/bot/:id/whatsapp/access` (web). PATCH goes through `InstanceManager.updateConfig` → container restart (~40s).
- Per-channel disconnect: `POST /instances/:id/whatsapp/disconnect` (CLI logout + rm auth dir, creds/pairing cleared, channel + access settings kept, container restart; refused while container is down so stale auth can't resurrect) and `POST /instances/:id/telegram/disconnect` (token revoked, channel stripped, runtime reloaded). `POST /:id/pair` now adds the WhatsApp channel to Telegram-first bots (`ensureWhatsappChannel`). Dashboard shows both channels as rows with status / connect / disconnect.
