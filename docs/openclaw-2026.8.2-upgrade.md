# OpenClaw 2026.8.2 upgrade — what changes for agent-forall

Researched 2026-09-01 against the official release notes, docs.openclaw.ai, the merged PRs behind the
changes, the **shipped code of `openclaw@2026.8.2` / `@openclaw/whatsapp@2026.8.2`** (npm tarballs grepped
for every config key, RPC shape and CLI flag we depend on), and a **local smoke test on the real
`ghcr.io/openclaw/openclaw:2026.8.2-browser` image** (§6). Everything below is verified unless marked *open*.

## 0. Target

| | Value |
|---|---|
| Version | **2026.8.2** — latest stable (published 2026-09-01). `2026.8.1` shipped 2026-08-31; `@openclaw/whatsapp@2026.8.2` requires `openclaw >=2026.8.2`, so 8.1 is already behind its own channel plugin. The `2026.9.1-beta.1` npm tag is a mislabeled 8.1 beta — ignore it. |
| Base image | `ghcr.io/openclaw/openclaw:2026.8.2-browser` — index digest `sha256:e164a318801fad2d49dc19b99adadfa629fa5f9ffb43673e73661c1d3f9cc7de`. Chromium pinned by its Playwright release (1.62.1) plus Debian security updates. **No ffmpeg**, only one Noto font — our apt layer stays. **`/home/node/.cache` is root-owned** in this image, which breaks every OpenClaw CLI call after the first (`Unable to create fallback OpenClaw temp dir /home/node/.cache/openclaw-1000`); the Dockerfile must `chown node:node /home/node/.cache`. |
| Node | image-provided; engines `>=22.22.3 <23 \|\| >=24.15.0 <25 \|\| >=25.9.0`. |
| Hard deadline | **2026-09-18** — the doctor compatibility windows that migrate our retired keys close (PRs #111142/#111382/#111527). Every tenant must be migrated before then. |

## 1. The two facts that shape the whole rollout

1. **The gateway refuses to boot on a legacy session store.** Verified: on a volume with
   `agents/main/sessions/sessions.json` the 2026.8.2 gateway exits with code 1 —
   `Gateway failed to start: Legacy session store requires migration: … Run "openclaw doctor --fix" against
   the same state/config before starting OpenClaw`. Startup does *not* import JSONL sessions; only
   `openclaw doctor --fix` does, and it needs the gateway stopped. **Every existing tenant needs a
   stopped-gateway `doctor --fix --non-interactive` on its volume before its first 2026.8.2 boot.** The
   migration is one-way; rollback is a pre-migration volume snapshot, nothing else.
2. **Copying a live state dir is no longer a backup.** Auth profiles, pairing store, plugin index and
   sessions live in `state/openclaw.sqlite` and `agents/<id>/agent/openclaw-agent.sqlite`; the docs say
   never to copy live `.sqlite`/`-wal`/`-shm` files. Our `tar -czf` export produces torn databases. Verified
   replacement: `openclaw backup create --verify --json` works with the gateway running (SQLite online
   backup), the archive can be filtered and still passes `openclaw backup verify`, and
   `openclaw backup restore --target <empty dir>` works (§6.9).

## 2. Config we render — verified key by key

`openclaw config validate` on 2026.8.2 **rejects our current 7.1 render** on exactly four paths:
`logging.redactSensitive`, `tools.media.image.models`, `tools.media.audio.models`, root `web`. The proposed
render below validates with zero issues, and `doctor --fix` on the 7.1 render produces the identical shape.

### Must change (rejected or retired in 2026.8.2)

| Key we render today | 2026.8.2 | Change in `agent-runtime/openclaw/config.ts` + `schema.ts` |
|---|---|---|
| `agents.list: [{id:"main", default:true}]` | retired → keyed `agents.entries`; `default` retired | render `agents.entries: { main: {} }` (validated; doctor produces exactly this). |
| `web.whatsapp.*`, `web.reconnect.*` | removed (PR #111382); the WhatsApp plugin owns socket timing and reconnect policy, no config knob | delete the `web` block and `WebConfig`. Watch reconnect logs after rollout. |
| `logging.redactSensitive: "tools"` | removed — redaction always on | drop the `logging` block. |
| `tools.media.{image,audio}.models[]` | one capability-tagged `tools.media.models[]` + `tools.media.<cap>.{enabled, preferredModel, maxBytes, timeoutSeconds}` | render `models: [{provider:"litellm", model, capabilities:["image"]}, {provider:"agentforall-media", model, baseUrl, capabilities:["audio"]}]`, `image.preferredModel:"litellm/<model>"`, `audio.preferredModel:"agentforall-media/<model>"`. Verified end to end: a voice note routes to `agentforall-media` through this shape (§6.7). Video stays omitted. |
| `.env`: `OPENCLAW_HEADLESS`, `WHATSAPP_ENABLED`, `WHATSAPP_SESSION_PATH`; container env `OPENCLAW_HEADLESS` | not read by 2026.8.2 core or the WhatsApp plugin (`browser.headless: true` in config applies) | remove. |

### New per-tenant automations — product decision required (cost)

A fresh 2026.8.2 gateway creates three system cron jobs per tenant (verified with `openclaw cron list`):

| Job | Cadence | What it does | Off switch (verified) |
|---|---|---|---|
| `heartbeat-main` | every 30 min, in the **main session** | a full agent turn with conversation history (docs: ~100K tokens per run unless isolated). In 7.1 it was gated on `HEARTBEAT.md`; 8.2 removed that file and runs unconditionally | `agents.defaults.heartbeat: { every: "0m" }` → gateway logs `[heartbeat] disabled`, no cron row |
| `Memory Dreaming Promotion` | daily 03:00, isolated session | memory-core "dreaming": model-driven memory promotion + Dream Diary subagent turn | `plugins.entries.memory-core: { enabled: true, config: { dreaming: { enabled: false } } }` → `removed 1 managed dreaming cron job(s)` |
| `skill-collection-review-main` | weekly | system-owned skill review (#130030) | no config key exists; accept and watch spend |

Decision (2026-09-01): keep both, shaped. Heartbeat `{ every: "8h", activeHours: { start: "08:00", end: "22:00" }, isolatedSession: true, target: "owner" }` (≈2 runs/day, ≈$0.3–1/tenant/month); dreaming stays on (≈$1/month). Not the 30-minute default. No seeding needed — the agent records its own follow-ups when a client asks for one.

### Product decision required

`channels.telegram.streaming.mode` — 2026.8 changed Telegram's default from a partial-text preview to
`progress` (a live-edited status draft with tool lines). Pin it explicitly: `"partial"` keeps today's
behaviour, `"off"` is quietest. Add to `CHANNEL_OWNED_PATHS.telegram`.

### Verified unchanged (no code change)

`gateway.{port,mode,bind:"lan",auth.mode:"token",auth.token}` · `session.{dmScope,identityLinks}` ·
`commands.ownerAllowFrom` · `browser.{headless,noSandbox}` · `agents.defaults.{model,imageModel,pdfModel,
workspace,maxConcurrent}` · `models.{mode,providers.*}` including the auth-only `agentforall-media`
provider block (still required: without it 8.2 fails with `ProviderAuthError: No API key found for provider
"agentforall-media"`; with it the plugin is called) · `mcp.servers.*` · `plugins.entries.*.{enabled,
hooks.allowConversationAccess,hooks.timeoutMs}` · Telegram `{enabled,botToken,dmPolicy,allowFrom,
errorPolicy,groupPolicy,groups.*.requireMention}` · WhatsApp `{enabled,dmPolicy,allowFrom,defaultAccount,
accounts.default.{enabled,authDir},actions.{sendMessage,reactions}}` (our `authDir` override stays valid).

Doctor additionally writes, harmlessly: `plugins.entries.{browser,litellm,memory-core}` (bundled),
`gateway.controlUi.allowedOrigins` (loopback), `channels.*.groupAllowFrom` copied from `allowFrom`,
`skills.entries` (33 bundled skills disabled), `wizard`, `meta`. None of these are orchestrator-owned.

## 3. Gateway RPC, probes and CLI we call

| Surface | 2026.8.2 | Action |
|---|---|---|
| WebSocket protocol | v4; `connect` role/scopes/token unchanged (`hello-ok protocol 4` in smoke) | none |
| `config.get` / `config.apply { raw, baseHash }` | unchanged; `meta`-less or shrinking writes are refused/auto-restored | none for the RPC path. **Fix the recreate path**: it ships a pristine `initialArchive` config with no `meta`, which the guard reverts (the 2026-08-29 בוב incident). Patch onto the volume's existing file before start. |
| `channels.status` | `channelAccounts[channel]` is an **array** of account snapshots (`accountId, linked, connected, running, lifecycle, healthState, …`) — verified on the live gateway | none; `gateway-probe.ts` already reads `[0]`. |
| `/healthz` | liveness, 200 four seconds after start | none |
| `/readyz` | **channel-aware**: 503 while any configured account is unlinked/blocked (verified: 503 with an unlinked WhatsApp account and a bad Telegram token, while `/startupz` was 200 `started`) | `health.ts`: derive `degraded` from `/startupz` (503 → degraded, 404 on a still-7.1 container → `null`); channel state keeps coming from the channel probe. |
| `openclaw channels logout --account default` | `--channel` inferred only when one configured channel supports logout | pass `--channel whatsapp`. |
| `openclaw pairing list whatsapp --json` | `{ "channel": "whatsapp", "requests": [] }` — matches `PairingListOutput` | none. Pending claim requests are not migrated; users re-send one message. |
| `openclaw doctor --fix --non-interactive` | valid; prompt-free; exits 0 with `Doctor complete` | the pre-boot migration step. Order matters: doctor **strips `plugins.entries` for plugins it cannot find** — run it only on a volume that already holds the plugins (every real tenant volume does). |
| `openclaw config validate --json` | works without a gateway | image smoke + CI check on the rendered config. |
| Config hot reload | `models.providers.*` edits hot-apply (`config hot reload applied`) | none |

## 4. Plugins

| Item | 2026.8.2 (verified) | Action |
|---|---|---|
| SDK | `plugin-sdk/plugin-entry`/`definePluginEntry`, `before_agent_reply → {handled, reply?}`, `registerMediaUnderstandingProvider`, `AudioTranscriptionRequest {buffer, fileName, mime?, apiKey, auth?, baseUrl?, model?, language?, prompt?, timeoutMs, signal?, fetchFn?}` — both plugins load and work unchanged (17 plugins listed at boot, transcription reached LiteLLM) | hygiene only: honour `req.signal`; bump `build.openclawVersion`, `peerDependencies`, `compat.pluginApi` to `>=2026.8.2`. |
| Installing ours (`npm-pack:`) | non-interactive install needs **`--force --accept-capabilities`** (arbitrary source + no integrity record). A `--force` reinstall of the same version **preserves `plugins.entries.<id>.hooks`** (7.1 stripped it). `plugins update <id>` does **not** work for npm-pack sources (it consults the npm registry) | Dockerfile + `rollout-plugin.sh`: `openclaw plugins install "npm-pack:<tgz>" --force --accept-capabilities`; drop the `uninstall --force` pre-step; reinstall *is* the upgrade path. Keep the orchestrator restart that re-renders `.env`. |
| `@openclaw/whatsapp` | `openclaw plugins install @openclaw/whatsapp@2026.8.2 --pin` **also needs `--accept-capabilities`** (an npm-pinned install of the official package is not exempt). The plugin lives in the tenant volume; **doctor does not converge an old copy** (a 7.1 plugin stays 7.1 and still loads); `openclaw plugins update @openclaw/whatsapp` upgrades it (`2026.7.1 -> 2026.8.2`, no extra flags) | Dockerfile: pinned install with `--accept-capabilities`. Per-tenant migration: `plugins update @openclaw/whatsapp` after the doctor step, verify `2026.8.2` in `plugins list --json`. |
| Prewarm (`doctor --fix --non-interactive` at build) | still valid | keep. |
| Telegram | bundled in the image | none |

## 5. Implementation list

**Status 2026-09-02: implemented on branch `feat/openclaw-2026.8.2` (uncommitted), typecheck clean, 233
orchestrator tests + 58 plugin tests green, rehearsed on the locally built image (§6b).** Deviations from
the list below, all deliberate:

- Image guard (compared by image id, so a re-tagged digest is the same image): `writeConfig` and a
  running `applyConfig` refuse a container from another image with `RuntimeImageMismatchError` (409);
  a stopped one gets `restart_required` with nothing written, because `start` and `restart` rebuild a
  container that is not on the adapter's image (stop → `prepareState` → remove → create → patch →
  seed → start; the old container survives a failed migration). Stopped bots catch up on their next
  start; `recreate-tenants.sh` skips them.
- `buildContainerOptions` no longer bakes an `initialArchive`; `ensureContainerExists` writes the
  config (patch when a file exists, pristine otherwise) and the AGENTS.md block every time, found or
  created, so a crash between create and write cannot leave a container booting on the bare volume.
  A backup restore lays the archive down, runs `prepareState`, then patches and seeds again.
- `prepareState` (doctor, then `plugins update @openclaw/whatsapp` when the bot has WhatsApp) runs in a
  throwaway container via `ContainerRuntime.runOneOff` — hardened like a tenant container, always
  removed. Used by recreate, by start-on-old-image, and after a backup restore (the archive may predate
  the image).
- Export = `openclaw backup create --verify` in the container, then python's `tarfile` strips
  `.env` and `whatsapp-session/` (tar cannot delete from a gzip stream), then `backup verify` again.
  Import maps `payload/posix/home/node/.openclaw/**` to the volume and still accepts the old flat tar.
- Heartbeat carries `directPolicy: "allow"` and `activeHours.timezone: "Asia/Jerusalem"` (doctor warns
  without the former; active hours are otherwise host-UTC).
- The dashboard `connect` keeps its bind-and-restart fallback for a bot created before the relay was
  bound at creation and not yet recreated; dead after the window, remove then.
- Workspace guidance is merged between markers (read file → merge → tar put, like config), best
  effort, before the container starts: the runtime seeds no bootstrap files at boot (only
  `onboard`/`setup`, which need a TTY), so nothing is pre-empted; see §8.

**`apps/orchestrator/src/services/agent-runtime/openclaw/`**

1. `config.ts` / `schema.ts`: §2 (agents.entries, drop `web`+`logging`, `tools.media` shape, shaped heartbeat
   (8h/08–22/isolated/owner), dreaming on (explicit), Telegram `streaming.mode: "partial"` (decided 2026-09-02: keep today's behaviour), env cleanup). `OWNED_PATHS`: add
   `["agents","defaults","heartbeat"]`, `["plugins","entries","memory-core"]`,
   `["channels","telegram","streaming","mode"]`. Never own `agents.entries`.
2. `health.ts` / `constants.ts`: readiness from `/startupz` (503 → degraded, 404 → null).
3. `whatsapp.ts`: `channels logout --channel whatsapp --account default`.
4. `backup.ts` / `adapter.ts`: export = `openclaw backup create --output /tmp --json` in the container,
   then rewrite the archive dropping `payload/**/whatsapp-session/**` and `payload/**/.env` (both are in the
   archive: verified), then `openclaw backup verify`. Import = accept the official archive (root
   `manifest.json` + `payload/posix/home/node/.openclaw/**`) and our legacy plain tar; both are laid into the
   volume before first start, followed by the one-off doctor. `npm/` (installed plugin packages) is skipped
   by the archive as regenerable — fresh volumes get the plugins from the image seed, so nothing to do.
5. New primitive `ContainerRuntime.runOneOff({ name, image, cmd, timeoutMs, memoryBytes, volumeMounts })`
   — a short-lived container on the tenant volume with an overridden command. Callers: pre-boot doctor,
   `plugins update @openclaw/whatsapp`, restore activation.
6. `instance-manager.ts` `recreateLocked`: stop → remove → **runOneOff doctor** → runOneOff
   `plugins update @openclaw/whatsapp` (when the channel exists) → create (not started) → patch existing
   config onto the volume file (no pristine `initialArchive` when a config exists) → inject creds → start →
   `waitForHealthy`. Guard in `applyConfig`: container image ≠ adapter image → `RuntimeImageMismatchError`
   (an 8.2-shaped config is rejected by a 7.1 gateway and vice versa).
7. Tests: `openclaw-config-merge`, `openclaw-runtime-adapter`, `openclaw-backup`, `instance-manager-recreate`.
8. Identity + workspace seed (decided 2026-09-02): render `agents.entries.main.identity.name` from the bot's
   display name (add to `OWNED_PATHS`; confirmed in §6b as `identityName`). Seed an
   orchestrator-owned block in `workspace/AGENTS.md` between `<!-- agentforall:begin/end -->` markers on
   create and recreate; everything outside the markers is preserved. `SOUL.md`, `IDENTITY.md`, `USER.md`,
   `TOOLS.md`, `MEMORY.md` are never touched. Block text:
   > You run on agentforall. Integrations (Gmail, Google Calendar, Sheets, Notion, Slack and ~1,400 more)
   > connect in one tap through the agentforall connections tool: find the app, send the owner the connect
   > link it returns, and continue once it's connected. Prefer this over manual setup.
   > The owner can also manage integrations, billing and settings at https://agentforall.co.il/app/bot/connections.

**`apps/orchestrator/src/services/integrations/`** (decided 2026-09-02)

9. Bind the MCP relay at bot creation, not at first dashboard connect: `InstanceManager.create` generates
   `config.integrations` (`randomBytes(32)` token + relay URL, no network) so every container boots with
   `mcp.servers.agentforall`. Root cause of the "bot walks the owner through Google Cloud Console" reports:
   a bot with no prior dashboard connect has no integrations tool at all.
10. `IntegrationsManager.resolveRelay`: when no Composio session exists, create it lazily under the per-bot
    lock on the first relay request (Composio outage = tool error, retried next call; creation never waits on
    Composio). `connect` keeps working; its restart-during-consent branch stays as the fallback for
    bots not yet recreated (see the status block; removal is a §8 follow-up). Existing bots receive
    the relay in the migration recreate, or on their next start when stopped.
11. Tests: `integrations-manager` (lazy session, concurrent first calls), `instance-manager` create.

**`packages/openclaw-plugin-*`**: version metadata, `req.signal`.

**`infra/images/openclaw-browser/Dockerfile`**

```dockerfile
ARG OPENCLAW_VERSION=2026.8.2
FROM ghcr.io/openclaw/openclaw:${OPENCLAW_VERSION}-browser@sha256:e164a318801fad2d49dc19b99adadfa629fa5f9ffb43673e73661c1d3f9cc7de
USER root
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg fonts-liberation fonts-noto fonts-noto-color-emoji git python3 python3-pip python3-venv unzip \
 && rm -rf /var/lib/apt/lists/* \
 && chown node:node /home/node/.cache    # root-owned in the upstream -browser image; the CLI needs it
USER node
RUN openclaw plugins install @openclaw/whatsapp@${OPENCLAW_VERSION} --pin --accept-capabilities \
 && openclaw doctor --fix --non-interactive 2>&1 | tail -20
COPY --chown=node:node packages/openclaw-plugin-credit /opt/agentforall/src/agentforall-credit
COPY --chown=node:node packages/openclaw-plugin-media  /opt/agentforall/src/agentforall-media
RUN set -e; mkdir -p /opt/agentforall/plugins; for p in agentforall-credit agentforall-media; do \
      TARBALL="$(npm pack "/opt/agentforall/src/$p" --pack-destination /opt/agentforall/plugins --silent)"; \
      openclaw plugins install "npm-pack:/opt/agentforall/plugins/$TARBALL" --force --accept-capabilities; \
    done
```

**Ops**: `recreate-tenants.sh` becomes the migration driver (§7); `rollout-plugin.sh` stages from
`/opt/agentforall/plugins`, installs with `--force --accept-capabilities`, no uninstall.
`infra/variables.tf` + VM `.env.runtime` `AGENT_RUNTIME_IMAGE` → the new GAR digest.
Also in the window: re-apply `infra/startup.sh` to the VM metadata — the deployed copy is stale and does not
fetch `LITELLM_MASTER_KEY` / `COMPOSIO_API_KEY` (DEPLOY_HANDOFF), so a reboot would lose integrations.

## 6. Smoke test results (2026-09-01, `2026.8.2-browser` + one-line chown fix, named volumes)

1. `config validate`: proposed render **valid, 0 issues**; 7.1 render **invalid** on the four keys above.
2. `doctor --fix --non-interactive` on the 7.1 render: exits clean; result equals the proposed render; on a
   volume *with* our plugins installed it keeps their entries; on a volume *without* them it removes them.
3. Gateway boot: `/healthz` 200 after 4 s; `/startupz` 200 `started`; `/readyz` 503; boot line lists 17
   plugins incl. `agentforall-credit`, `agentforall-media`, `whatsapp`.
4. `channels.status`: arrays per channel (Telegram `lifecycle: "blocked"` on a bad token, WhatsApp
   `linked: false`, `lifecycle: "stopped"`). `pairing list whatsapp --json` → `{channel, requests: []}`.
5. Plugins: WhatsApp pinned install (needs `--accept-capabilities`), ours with `--force --accept-capabilities`,
   all `loaded`; `--force` reinstall keeps `hooks`; `plugins update` fails for npm-pack; `plugins update
   @openclaw/whatsapp` moves a 7.1 copy to 8.2; doctor alone does not.
6. Legacy volume (`sessions.json` present): gateway exits 1 with the "requires migration" message.
7. Voice note: `openclaw infer audio transcribe` reaches `agentforall-media` and fails only at LiteLLM auth
   (fake key) with our own error text. Without the auth-only provider block: `ProviderAuthError`.
8. Automations: heartbeat (30 m), dreaming (daily), skill review (weekly) appear by default; `every: "0m"`
   and `dreaming.enabled: false` remove the first two.
9. Backup: `backup create --verify` live → `verified: true`; archive contains `.env` and
   `whatsapp-session/creds.json`; after stripping both, `backup verify` → `ok: true`, `backup restore
   --target /tmp/restored` → `ok: true`, layout `<root>/manifest.json` + `payload/posix/home/node/.openclaw/**`.
10. Image: `/home/node/.cache` root-owned (fixed by chown); no ffmpeg; Chromium present.

*Open*: nothing blocks implementation. Not rehearsed locally: a real multi-GB tenant volume's doctor run
time (do it on the VM with a stopped snapshot of שרוליק before the window).

### 6b. Rehearsal on the built image (2026-09-02, `openclaw-browser:2026.8.2-dev` from the new Dockerfile)

Fresh volume seeded from the image + the generator's real output: `config validate` valid; boot 17
plugins; `/startupz` 200; cron shows `heartbeat-main` every 28800000 ms, dreaming daily, skill review
weekly; `agents list` reports `identityName: "שרוליק smoke"` from config; the exact seed script creates
and then idempotently re-merges AGENTS.md; the exact backup command exits 0, the archive holds no
`.env`/`whatsapp-session`, `backup verify` ok, `/tmp` clean; `channels logout --channel whatsapp`
answers cleanly; `pairing list` shape unchanged; doctor after boot: only warnings (lan bind, plaintext
tokens) plus the unreachable relay (no orchestrator in the rehearsal).
Legacy volume (7.1 render + `sessions.json`): gateway refuses to boot; `doctor --fix --non-interactive`
exit 0 removes `web`/`logging`/`agents.list`, writes `agents.entries`, consolidates media models and
keeps our plugin entries; `plugins update @openclaw/whatsapp` exit 0; patching our owned paths onto the
migrated file keeps `meta` and validates; boot healthy, and after boot the file still holds our plugin
entries, heartbeat and the MCP relay (clobber guard satisfied).

Create path (after the review fix round, 2026-09-02): container created on an empty volume, then the
adapter's real `writeConfig` + `seedWorkspace` through dockerode, then start: the image seeds the
volume at the first mount, so `writeConfig` patches onto the prewarm config (`meta` kept, no
"missing-meta" anomaly); healthy in 6 s, 16 plugins, identity/heartbeat/relay present, AGENTS.md
owned by node 644. Note: the heartbeat fires once ~10 s after every boot (isolated, small), so a
restart costs one heartbeat turn.

Review round (two independent reviewers, 2026-09-02): findings fixed — image compared by id, guard
on every config write path (restart/pairing), start and restart rebuild stale containers, old
container kept until the migration succeeded, config + guidance written on every create/find,
restore migrates before patching, seed via read-merge-tar (one merge implementation), backup size
cap enforced inside the shell trap, runtime archive root dir skipped, one-off timer cleared,
`gateway` ownership narrowed to port/mode/bind/auth, ops script checks the boot line for loaded
plugins and only error-level doctor findings. Not adopted: a negative cache for Composio outages
in `resolveRelay` (per-bot lock already serializes; revisit if the relay ever queues), and moving
the tar-strip from python to TS (would lose `backup verify` after the strip).

Second-pass review (2026-09-02, on the fixes): one latent bug fixed — the reconciler can mark a row
stopped while a long rebuild runs, after which start was refused; `start`/`restart` now set the
row running unconditionally once the container is up, and `ContainerRuntime.start` treats Docker
304 (already running) as success. Also: `restart` records a failed rebuild as `error` with the
cause; a missing runtime image on the host surfaces as `UpstreamUnavailableError` instead of a raw
Docker 404; a backup restore wraps only the archive steps as `INVALID_BACKUP` (a doctor failure is
the host's); the boot path adopts a current-image container found under the bot's name (a crashed
rebuild the row does not know) and replaces a found container from another image after migrating
its volume; the ops doctor check ignores the exit code and reads `severity`/`level`. Known window
(documented, not changed): between the image flip and a tenant's recreate, a WhatsApp pairing on
that tenant fails closed (shown as expired until the recreate) and a Telegram disconnect on it
revokes the token before the 409; retrying after the recreate works.

Not rehearsed: a real multi-GB tenant volume's doctor run time (VM, stopped snapshot of שרוליק).

## 7. Production rollout — one maintenance window, before 2026-09-18

1. Deploy the new orchestrator and flip `AGENT_RUNTIME_IMAGE` together at the start of the window (the
   image-mismatch guard would otherwise fail users' config saves). Manual `agent-forall-data` snapshot first.
2. Per tenant (canary קוקי2, then שרוליק, then the rest) with `infra/ops/recreate-tenants.sh --image <digest>
   [--only <name>]`: it tars the volume to `/home/deploy/backups/<volume>-pre-<stamp>.tar.gz` (rollback of
   last resort) and calls the orchestrator's `recreate`, which does stop → remove → one-off doctor (fail
   closed) → one-off WhatsApp plugin update → create → patch config (relay bound if missing) → start →
   healthy → AGENTS.md seed. Then `rollout-plugin.sh` for `agentforall-media` (the `req.signal` change)
   and `agentforall-credit` (metadata only; optional).
   Prerequisites: build + push the image, put its GAR digest in `infra/variables.tf` and the VM's
   `.env.runtime` `AGENT_RUNTIME_IMAGE`, deploy the orchestrator from this branch, re-apply
   `infra/startup.sh` to the VM metadata.
3. Verify per tenant: healthy; `/startupz` 200; boot line lists `whatsapp`, `agentforall-credit`,
   `agentforall-media`; `plugins list --json` shows `whatsapp 2026.8.2`; `openclaw doctor --json` `ok: true`;
   `openclaw.json` keeps both plugin entries and the MCP relay (now on every bot) and the identity name;
   `AGENTS.md` carries the owned block; `cron list` shows heartbeat at 8h + dreaming daily;
   WhatsApp `linked: true` where creds exist; one round trip; one voice note.
4. After: update `DEPLOY_HANDOFF.md`; watch WhatsApp reconnects for a week.

Rollback: restore the pre-migration volume tarball into a fresh volume, recreate on the 7.1 digest
(`a81764a4…`). Sessions created on 8.2 are lost by design.

## 8. Accepted losses / follow-ups

- Pending claim-mode pairing requests are not imported.
- `web.reconnect` backoff tuning is gone.
- Weekly skill-collection review cannot be disabled by config.
- Doctor warns that `openclaw.json` holds plaintext secrets (gateway token, bot token): a later hardening
  pass can move the Telegram token to `TELEGRAM_BOT_TOKEN` in `.env` (env fallback is documented for the
  default account).
- Follow-up: image-owned plugin loading so image bumps upgrade plugins atomically.
- Tenant workspaces hold none of the runtime's default bootstrap files (`SOUL.md`, `IDENTITY.md`,
  `USER.md`, `BOOTSTRAP.md`): only `onboard`/`setup` seed them and both need a TTY, so a fresh bot's
  AGENTS.md is our block alone. Product decision: ship our own templates, or leave the agent to its
  memory files.
- Remove the `connect` bind-and-restart fallback once every bot has been recreated on 2026.8.2.
