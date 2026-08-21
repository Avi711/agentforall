# Agent For All — Session Summary (updated 2026-04-22, session 5)

> **Newer handoff doc lives at `DEPLOY_HANDOFF.md`** — covers session 6 work (production rollout setup: GCP project, Terraform infra, GAR + WIF, Secret Manager pattern, Vercel build fix, LLM provider refactor, OpenClaw browser image, network/container renames, cleanup pass). Read that first if resuming the deploy. This file (SESSION_SUMMARY.md) covers product/architecture decisions through session 5; the architectural rationale is still authoritative and has not been undone.

## Project Vision

**Agent For All** makes [OpenClaw](https://github.com/openclaw/openclaw) — an open-source AI agent framework — accessible to everyone. A doctor who needs a secretary that never sleeps. A parent who forgets anniversaries. A freelancer drowning in WhatsApp tabs.

Per-tenant isolated OpenClaw container, user brings their own WhatsApp number (via QR or 8-digit pairing code), we host it. Hebrew RTL, Israeli market, priced ₪199/mo.

---

## Session 5: WhatsApp-first MVP (what this document primarily covers)

Session 4 shipped the landing page + first Reel ad. Session 5 built the actual product: user auth, bot provisioning, WhatsApp pairing, dashboard UI. Code is complete across 5 PRs; not yet deployed.

### The end-to-end flow now implemented

```
User → Google OAuth → /app
  ↓ Create bot → consent gate (Hebrew WhatsApp risk disclosure)
  ↓ Orchestrator provisions OpenClaw container (resumable provisioning)
  ↓ Orchestrator spawns ephemeral Baileys sidecar container
  ↓ Dashboard polls → shows QR + 8-digit code tabs
  ↓ User scans QR / enters code → Baileys auths
  ↓ Sidecar POSTs creds blob to orchestrator /internal/pair/:id/completed
  ↓ Orchestrator encrypts creds in Postgres, injects into main container, restarts
  ↓ Sidecar exits 0, volume removed
  ↓ Dashboard redirects to /app?paired=1 → toast + BotCard
User ↔ their OpenClaw agent on their WhatsApp number
```

---

## Architecture decisions (with rationale — DO NOT UNDO without understanding why)

### Hosting: GCE VM + Docker + custom orchestrator. NOT Kubernetes.

Per-tenant stateful containers with PVC-per-user is a well-known K8s antipattern (slow provisioning, PVCs billed when idle, API server strain past ~2k tenants, no auto-stop). Fly.io, Render, Railway, Heroku all built their own orchestrators on VMs/microVMs for this exact shape.

Our orchestrator already has the right domain model (`Instance` as first-class, `ContainerRuntime` abstraction, `PortAllocator`, `Reconciler`, `HealthMonitor`). Extending it cost ~one PR; K8s migration would cost weeks for no benefit at <1000 tenants.

### Auth: Better Auth, not Supabase Auth, not Auth.js

- Avraimi rejected Supabase Auth (vendor lock-in).
- Auth.js/NextAuth maintainers joined Better Auth in Sept 2025; Auth.js is effectively in maintenance mode.
- Better Auth v1.6.5 shipped April 16, 2026 — actively developed, TypeScript-first, uses our Postgres + Drizzle directly, no vendor dependency.

**Flow:** Google OAuth primary (one click, ~95% of Israeli users have Gmail) + magic link fallback via Resend (Hebrew email template). Session stored in Postgres via Better Auth's Drizzle adapter.

### WhatsApp: Baileys + ephemeral sidecar. Ban risk accepted with disclosure.

The 2026 reality:
- Meta's WhatsApp Business Policy (effective Jan 15 2026) **bans general-purpose AI chatbots even on the official Cloud API**.
- Unofficial path (Baileys) has documented active ban waves.
- **No ToS-safe path exists** for an Israeli personal-assistant-on-WhatsApp product.

Our mitigations:
- Per-tenant isolation: one user's ban affects only that user, not the platform.
- Mandatory consent modal (Hebrew) before pairing — names Meta policy + Baileys ban risk + user responsibility.
- eSIM partner card prominently recommending a dedicated number.
- Consent versioned (`users.consent_version`) so we can re-prompt on policy updates.

### Two containers per tenant, not supervisord

The existing `ContainerRuntime` abstraction is "one container = one job". Supervisord inside one container couples orchestrator lifecycle to in-container PID management — a smell. Instead:
- `openclaw-<shortId>` — long-lived, the actual agent
- `pairing-<shortId>` — ephemeral Baileys sidecar, spawned on `POST /pair`, exits 0 after success or 10-min idle

Both join `agent-forall-net`; sidecar calls back to the orchestrator by container name.

### Durable provisioning via `instance_events` + state-driven resume. NOT DBOS/Temporal.

The old `InstanceManager.provision()` was linear try/catch, not crash-safe mid-flow. We refactored to a resumable pattern:
- `reserveIdentity()` — insert the row with deterministic container name, retry on port conflicts
- `resumeProvisioning()` — idempotent; inspects side effects at each step and skips if already done. Each step emits an event to `instance_events`.
- Reconciler's `resumeStaleProvisioning()` calls this for any row stuck in `provisioning` for >5 min.

Events: `provision.requested`, `provision.container_created`, `provision.started`, `provision.running`, `provision.failed`, `pair.requested`, `pair.qr_served`, `pair.authenticated`, `pair.cancelled`, `pair.timeout`.

### Trusted-service-token impersonation for dashboard ↔ orchestrator

The orchestrator's original auth was bearer-per-user (API_KEYS map). That doesn't scale for a server-side dashboard that acts on behalf of many users.

Added a second auth path (standard AWS STS / GCP SA impersonation pattern):
- Bearer in `SERVICE_TOKENS` (comma-separated list, ≥32 chars each) → trusted service caller
- `X-Act-As-User` header → the effective user id (validated against `USER_ID_PATTERN`)
- Per-user API keys still work unchanged for CLI / direct integrators

### Encryption: envelope (AES-256-GCM) in Postgres. NOT Google Secret Manager.

Postgres already hosts encrypted gateway tokens and configs via the existing `crypto.ts`. Extended it to encrypt `whatsapp_creds` (the Baileys multi-file auth tarball) the same way. Secret Manager can come later if compliance demands it; right now it's one more moving part without clear benefit.

### Ubuntu 24.04 LTS, NOT Container-Optimized OS

The previous Terraform provisioned COS but the startup script assumed Debian/Ubuntu (apt installs, writable `/usr/local`, cron). Switching to Ubuntu fixed the mismatch AND unlocks gVisor / rootless Docker / custom runtimes later.

---

## Code map

### `packages/db/` — Drizzle schema

- `src/schema/auth.ts` — Better Auth tables (`user`, `session`, `account`, `verification`). User extended with app columns: `consented_whatsapp_at`, `consent_version`, `beta_access`.
- `src/schema/instances.ts` — `user_id` is now `text` FK → `user.id` (cascade delete). Added pairing columns: `pairing_status`, `whatsapp_account_id`, `whatsapp_creds (bytea)`, `last_seen_at`. Pairing status is orthogonal to `INSTANCE_STATUSES`; don't merge them.
- `src/schema/instance-events.ts` — append-only audit log, indexed on `(instance_id, created_at desc)`.
- `src/schema/leads.ts` — unchanged.
- Migration: `drizzle/0003_uneven_richard_fisk.sql` — destructive (column type change). Run with `npm run db:migrate`.

**Drizzle-kit bug fix**: bumped from 0.30.0 to 0.31.10. 0.30 couldn't resolve `.js` extensions on TS imports under NodeNext.

### `apps/orchestrator/` — Fastify backend

New files:
- `src/services/event-log.ts` — `EventLog.append()` / `.recent()`
- `src/services/pairing-manager.ts` — Owns sidecar lifecycle. Per-pair session token in memory (restart-safe via reconciler). Methods: `startPairing`, `proxyToSidecar`, `completePairing`, `cancelPairing`, `expireStale`, `validateAuthToken` (constant-time).
- `src/routes/pair.ts` — User-facing pair routes + `/internal/pair/:id/completed` webhook.

Modified files:
- `src/middleware/auth.ts` — two auth paths: API key OR trusted service token + `X-Act-As-User`.
- `src/services/container-runtime.ts` — added `createSidecar`, `ensureVolumeExists`, `removeVolume`, `findContainerByName`, `putArchiveBuffer`, `isRunning`. `VolumeMount` supports bind-as-named-volume syntax.
- `src/services/instance-manager.ts` — `provision()` refactored into idempotent `resumeProvisioning()`. `start()` injects persisted WA creds via `putArchiveBuffer` before `docker start`. `destroy()` wipes WA creds + account id on destruction.
- `src/services/config-generator.ts` — WhatsApp channel now emits `WHATSAPP_ENABLED=true` + `WHATSAPP_SESSION_PATH=/home/node/.openclaw/whatsapp-session`.
- `src/services/reconciler.ts` — `ReconcilerDeps` struct now injects manager + pairingManager. Extensions: `resumeStaleProvisioning`, `expireStalePairings`.
- `src/storage/instance-repository.ts` — `updatePairing()`, `getDecryptedWhatsappCreds()`, `findByPairingStatus()`, `findStalePairings()`. `Instance` domain type exposes `hasWhatsappCreds: boolean` (never leaks the Buffer).
- `src/domain/types.ts` — re-exports `PAIRING_STATUSES`; `Instance` extended with pairing fields.
- `src/config.ts` — added `SERVICE_TOKENS`, `PAIRING_IMAGE`, `PAIRING_PORT`, `PAIRING_IDLE_TIMEOUT_MS`, `PAIRING_REQUEST_TIMEOUT_MS`, `PAIRING_STALE_THRESHOLD_MS`, `PAIRING_LOG_LEVEL`, `ORCHESTRATOR_INTERNAL_URL`. `extractPairingConfig()` exported for PairingManager.
- `src/server.ts` — global auth hook skips `/internal/*`; registered `application/octet-stream` content-type parser for the creds callback.
- `src/main.ts` — wires `EventLog` + `PairingManager` + pair routes + internal pair routes; pulls sidecar image on startup alongside openclaw image.
- `.env.example` — new, fully documented.

### `apps/whatsapp-pairing/` — new package, ephemeral sidecar

- `src/config.ts` — strict env validation, throws on missing required vars
- `src/baileys-session.ts` — wraps `makeWASocket` + `useMultiFileAuthState` from `baileys@6.17.16` (stable, non-RC). State machine via EventEmitter. Emits `authenticated` and `failed`.
  - **Important**: Uses **named import** `{ makeWASocket }` not default — TypeScript NodeNext interop with Baileys' CJS gets confused by the default export wrapper.
- `src/routes/pair.ts` — `GET /pair/qr` (PNG data URL), `POST /pair/code` (8-digit), `GET /pair/status`
- `src/routes/health.ts` — auth-bypassed `/healthz`
- `src/completion.ts` — tars the multi-file auth directory (`tar-fs`), POSTs blob to orchestrator
- `src/server.ts` — Fastify with bearer-token middleware, idle watchdog, graceful shutdown via SIGTERM/SIGINT. Idle timer resets on every authenticated request.
- `Dockerfile` — multi-stage, expects **monorepo-root build context**: `docker build -f apps/whatsapp-pairing/Dockerfile -t ghcr.io/agentforall/whatsapp-pairing:latest .`

### `apps/web/` — Next.js dashboard

**Server-only libraries:**
- `src/lib/db.ts` — singleton Postgres pool + Drizzle instance (globalThis-cached for HMR safety)
- `src/lib/auth/server.ts` — `betterAuth()` config with Drizzle adapter, Google OAuth, magic link (Resend, Hebrew HTML template), consent fields via `additionalFields`
- `src/lib/auth/client.ts` — React client with `magicLinkClient`
- `src/lib/auth/session.ts` — `getServerSession()`, `requireSession(redirectTo)`
- `src/lib/auth/api.ts` — `authenticatedHandler({ bodySchema }, handler)` wrapper: session check → Zod body parse → maps errors (ZodError, OrchestratorError) to stable error codes
- `src/lib/orchestrator/client.ts` — `OrchestratorClient` singleton. Reads env, injects `Authorization: Bearer <service token>` + `X-Act-As-User: <userId>` on every call. Zod-validates responses. `OrchestratorError` with `.isClientError`. 10s timeout via `AbortSignal.timeout`.
- `src/lib/orchestrator/types.ts` — shared Zod schemas (Instance, PairStatus, etc.)
- `src/lib/consent.ts` — `getConsentStatus(userId)`, `recordConsent(userId)`, `CURRENT_CONSENT_VERSION = 1`

**API routes** (`src/app/api/bot/`):
- `route.ts` — `GET` (active bot) + `POST` (create, idempotent, consent-gated)
- `[id]/route.ts` — `GET` + `DELETE`
- `[id]/pair/route.ts` — `POST` (start) + `DELETE` (cancel)
- `[id]/pair/qr/route.ts` — `GET` (proxy)
- `[id]/pair/code/route.ts` — `POST` with phone validation
- `[id]/pair/status/route.ts` — `GET` (no-cache)
- `consent/route.ts` — `GET` + `POST` (version-locked)
- `api/auth/[...all]/route.ts` — Better Auth handler

**Pages** (`src/app/`):
- `(auth)/login/page.tsx` + `LoginForm.tsx` — Google button + magic link form
- `(app)/layout.tsx` — session-gated shell with header and sign-out
- `(app)/page.tsx` — dashboard home: active bot card OR create-bot form OR error panel; includes `PairedToast` suspense
- `(app)/BotCard.tsx` — client component with status badge + contextual CTA + inline delete confirmation
- `(app)/CreateBotForm.tsx` — form; redirects to `/app/bot/pair` on success
- `(app)/PairedToast.tsx` — 5s success banner triggered by `?paired=1`
- `(app)/SignOutButton.tsx`
- `(app)/bot/pair/page.tsx` — server: consent gate or PairingFlow; redirects home on `paired`
- `(app)/bot/pair/ConsentGate.tsx` — client; POSTs consent, refreshes
- `(app)/bot/pair/PairingFlow.tsx` — client: auto-starts pairing, 2s polling with AbortController cleanup, QR + code tabs, friendly Hebrew error messages for every orchestrator error code
- `content/whatsapp-consent.he.tsx` — versioned consent body (Hebrew, names Meta Jan 2026 policy + Baileys ban risk)

**Components:**
- `components/ESimCard.tsx` — affiliate card (hidden if `NEXT_PUBLIC_ESIM_PARTNER_URL` unset)

### `infra/` — Terraform + startup

- `main.tf` — VM image switched from COS to Ubuntu 24.04 LTS, removed `cos-metrics-enabled` metadata.
- `startup.sh` — full rewrite of the bootstrap:
  - Installs Docker Engine + Compose plugin via official apt repo on first boot
  - Installs `cron` (not in Ubuntu minimal)
  - Auto-creates `deploy` user
  - Generates `.first-api-key` + `.dashboard-service-token` on first deploy, writes both to `/home/deploy/agent-forall/` for the operator to retrieve
  - `.env.runtime` now includes all pairing env vars
  - `docker-socket-proxy` config adds `VOLUMES: 1` and `DELETE: 1` for sidecar volume lifecycle
  - Warms image cache (openclaw + whatsapp-pairing) on boot

---

## Data model

### `user` (Better Auth + app extensions)
- Standard Better Auth: `id text PK`, `name`, `email`, `email_verified`, `image`, `created_at`, `updated_at`
- App: `consented_whatsapp_at timestamptz`, `consent_version int default 0`, `beta_access bool default false`

### `session`, `account`, `verification`
Better Auth defaults — singular names (their convention, don't pluralize).

### `instances`
`user_id` is now `text` FK → `user.id` (cascade). New pairing columns:
- `pairing_status` — `none | awaiting_qr | awaiting_code | paired | expired | failed`
- `whatsapp_account_id varchar(64)` — the JID after auth (e.g., "972501234567")
- `whatsapp_creds bytea` — envelope-encrypted multi-file auth tarball
- `last_seen_at timestamptz`

**`INSTANCE_STATUSES` FSM is unchanged and orthogonal** to pairing status. Pairing is about WhatsApp session state; `status` is about container state.

### `instance_events`
Append-only audit. One row per state transition. Indexed on `(instance_id, created_at desc)` for fast "latest event" queries.

### `leads`
Unchanged from session 4.

---

## Auth model (subtle — read before touching)

### Dashboard → Orchestrator (server-to-server)

```
Vercel Next.js server (lib/orchestrator/client.ts)
  ↓ Authorization: Bearer <ORCHESTRATOR_SERVICE_TOKEN>
  ↓ X-Act-As-User: <better-auth user.id>
Orchestrator middleware/auth.ts
  ↓ bearer matches a hash in SERVICE_TOKENS → trusted path
  ↓ reads X-Act-As-User, validates pattern, sets request.authenticatedUserId
```

The dashboard is trusted to only pass ids of Better-Auth-authenticated users. Standard PaaS pattern.

### Sidecar → Orchestrator (server-to-server, narrow)

```
Sidecar baileys-pairing container
  ↓ POST /internal/pair/:id/completed
  ↓ Authorization: Bearer <per-pair-session-token>  # minted by orchestrator
  ↓ content-type: application/octet-stream (tarball)
Orchestrator (global auth hook skips /internal/*)
  ↓ route handler validates token via PairingManager.validateAuthToken(id, token)
  ↓ constant-time comparison against in-memory Map<instanceId, token>
```

If the orchestrator restarts mid-pair, the in-memory map empties — the sidecar's callback will 401 and its Baileys process times out, reconciler tears the orphan down, user retries. This is acceptable because pairings are ephemeral (<10 min).

### CLI / direct integrators (legacy, still works)

Per-user API keys in `API_KEYS` env map. Bearer → fixed `userId`. Unused by the dashboard.

---

## Pairing flow end-to-end (reference)

1. Dashboard `POST /api/bot` (consent required) → `OrchestratorClient.createBot()` → orchestrator inserts row with deterministic container name, reserves port, emits `provision.requested`
2. `resumeProvisioning()` → creates container → emits `container_created` → starts → emits `started` → marks running → emits `running`
3. Dashboard redirects to `/app/bot/pair` → `PairingFlow` mounts
4. `PairingFlow` → `POST /api/bot/:id/pair` → `OrchestratorClient.startPairing()` → `PairingManager.startPairing()`:
   - Ensures named volume `wa-creds-<shortId>`
   - Creates sidecar container `pairing-<shortId>` with env: `PAIRING_AUTH_TOKEN=<token>`, `ORCHESTRATOR_BASE_URL=http://agent-forall:3000`, `ORCHESTRATOR_SERVICE_TOKEN=<same token>`, `INSTANCE_ID=<id>`, volume mount `/data/session`
   - Starts sidecar, stores `<instanceId> → token` in memory
   - Updates `pairing_status='awaiting_qr'`, emits `pair.requested`
5. Sidecar boots → Baileys emits QR → sidecar `GET /pair/qr` returns data URL
6. Dashboard polls `/api/bot/:id/pair/status` every 2s → when `qrAvailable: true`, fetches `/api/bot/:id/pair/qr`
7. User scans on phone. Sidecar's Baileys gets `connection: open` → tars `/data/session` → POSTs `/internal/pair/:id/completed`
8. Orchestrator validates token, decrypts tar, persists to `instances.whatsapp_creds` (envelope-encrypted), `putArchiveBuffer` into main container at `/home/node/.openclaw/whatsapp-session`, restarts main container, removes sidecar + volume, emits `pair.authenticated`
9. Sidecar exits 0
10. Dashboard polls → phase `authenticated` → redirects to `/app?paired=1` → `PairedToast` + `BotCard` shows connected state

### On subsequent container restarts (VM reboot, orchestrator upgrade, etc.)

`InstanceManager.start()` checks `hasWhatsappCreds`; if true, decrypts `whatsapp_creds`, `putArchiveBuffer` at the session path **before** `docker start`. OpenClaw's own session loader sees a normal multi-file auth dir and resumes. No fragility.

---

## Known gotchas + limitations

### 1. `<img src>` with data URL in React

`PairingFlow.tsx` uses `<img>` (not `next/image`). This is correct — data URLs don't benefit from Next image optimization. Next's lint may warn; ignore.

### 2. React Strict Mode double-invocation of `startPairing`

`PairingFlow` POSTs `/pair` in a `useEffect`. React Strict Mode calls effects twice in dev. The orchestrator's `startPairing` is idempotent — returns `{ status: 'already_active' }` on the second call. Safe.

### 3. Baileys import (NodeNext CJS interop)

Use `import { makeWASocket } from "baileys"` — **named import**. Default import (`import makeWASocket from "baileys"`) doesn't work under NodeNext because Baileys is CJS and the default-export wrapper isn't callable.

### 4. WhatsApp ban risk is unresolvable

- Meta policy bans general AI chatbots on official Cloud API since Jan 15 2026.
- Baileys has active ban waves.
- We cannot eliminate this. We disclose it, recommend eSIM, accept per-tenant blast radius.
- When a user is banned, they need to re-pair with a new number. The re-pair flow goes through the same UI (PairingFlow has no distinct code path; it's just another pair).

### 5. Drizzle-kit vs NodeNext

`.js` extensions on TS imports required a drizzle-kit bump to 0.31.10. If future schema files fail to generate, check the loader fix.

### 6. `PAIRING_IMAGE` needs to exist in a registry the VM can pull from

Startup script tries to pull `ghcr.io/agentforall/whatsapp-pairing:latest`. Build + push this image before Terraform apply:
```
docker build -f apps/whatsapp-pairing/Dockerfile -t ghcr.io/agentforall/whatsapp-pairing:latest .
docker push ghcr.io/agentforall/whatsapp-pairing:latest
```
(Same for the orchestrator image `ghcr.io/agent-forall/agent-forall:latest`.)

### 7. `docker exec` for pg_dump in cron uses host docker CLI

The cron entry runs `docker exec agent-forall-postgres` on the host; it talks to `/var/run/docker.sock` directly, NOT through `docker-socket-proxy`. Works because the proxy is only for the orchestrator container's access. Don't remove the cron expecting the proxy to cover it.

### 8. Sidecar callback requires DNS name `agent-forall` to resolve on `agent-forall-net`

Docker Compose auto-aliases service `agent-forall` on every network it joins. The compose file lists `agent-forall-net` under `networks:` for that service. If anyone refactors the compose file, preserve this.

### 9. Consent versioning

`CURRENT_CONSENT_VERSION = 1` in `lib/consent.ts` and mirrored as `WHATSAPP_CONSENT_VERSION = 1` in `content/whatsapp-consent.he.tsx`. When policy changes meaningfully, bump both. The `users.consent_version` column tracks the version the user accepted; `getConsentStatus().stale` flags users who need to re-accept.

### 10. No tests yet

Minimal test suite deferred. Three planned Vitest files (in PR 3 plan): `provision.resume`, `pairing.happy-path`, `pairing.crash-mid`. Not written. Add when ship cadence demands it.

---

## What you (Avraimi / operator) need to do to go live

### 1. Google Cloud Console (DONE per conversation)
- OAuth 2.0 Web Client ID
- Redirect URIs: both `https://agentforall.co.il/api/auth/callback/google` and `https://www.agentforall.co.il/...` and `http://localhost:3000/...`
- App home / privacy / terms = `https://agentforall.co.il/...` (no www, matches the canonical `siteUrl` in layout.tsx)

### 2. Resend account
- Verify sender `login@agentforall.co.il`
- Get API key

### 3. Database migration
```
cd D:/Projects/agent-forall
npm run db:migrate
```
This applies `0003_uneven_richard_fisk.sql` to Supabase. **Destructive** (changes `user_id` column type; drops any existing instances rows — none exist yet per confirmation).

### 4. Build and push container images
```
# orchestrator image
docker build -f apps/orchestrator/Dockerfile -t ghcr.io/agent-forall/agent-forall:latest .
docker push ghcr.io/agent-forall/agent-forall:latest

# pairing sidecar image (build context = monorepo root)
docker build -f apps/whatsapp-pairing/Dockerfile -t ghcr.io/agentforall/whatsapp-pairing:latest .
docker push ghcr.io/agentforall/whatsapp-pairing:latest
```

### 5. Terraform apply
```
cd infra
terraform apply
```
Provisions the Ubuntu 24.04 VM + attaches daily snapshots policy. Startup script runs on first boot — takes ~3-5 min to install Docker + pull images + start the stack.

### 6. Retrieve secrets from VM
```
gcloud compute ssh agent-forall --zone=<zone>
sudo cat /home/deploy/agent-forall/.dashboard-service-token  # plug into Vercel as ORCHESTRATOR_SERVICE_TOKEN
sudo cat /home/deploy/agent-forall/.first-api-key  # optional, for CLI debugging
```

### 7. Point orchestrator DNS
Either a separate subdomain (e.g., `orchestrator.agentforall.co.il` → VM IP) — recommended for clarity — OR reuse `agentforall.co.il` on the VM (but then Vercel can't host the dashboard there).

Simpler: `orchestrator.agentforall.co.il` → VM static IP (already allocated in Terraform as `google_compute_address.platform`), dashboard at `agentforall.co.il` on Vercel.

### 8. Vercel env vars
```
BETTER_AUTH_SECRET=<openssl rand -hex 32>
BETTER_AUTH_URL=https://agentforall.co.il
NEXT_PUBLIC_APP_URL=https://agentforall.co.il
GOOGLE_CLIENT_ID=<from step 1>
GOOGLE_CLIENT_SECRET=<from step 1>
RESEND_API_KEY=<from step 2>
AUTH_EMAIL_FROM=login@agentforall.co.il
ORCHESTRATOR_BASE_URL=https://orchestrator.agentforall.co.il
ORCHESTRATOR_SERVICE_TOKEN=<from step 6>
ORCHESTRATOR_PROVIDER=anthropic
ORCHESTRATOR_PROVIDER_API_KEY=<your Anthropic API key>
ORCHESTRATOR_PROVIDER_MODEL=claude-opus-4-7
NEXT_PUBLIC_ESIM_PARTNER_URL=<affiliate link, optional>
```

### 9. Vercel deploy
Push to main or redeploy from dashboard.

### 10. Smoke test
- Visit `https://agentforall.co.il/login`
- Sign in with Google (fresh account)
- On `/app`, type a bot name → "יצירת הסוכן וחיבור WhatsApp"
- Accept the Hebrew consent modal
- Pairing screen shows QR within ~5-10s
- Scan with a **throwaway** WhatsApp number (NOT your primary)
- `/app?paired=1` → toast → BotCard shows "מחובר ופעיל"
- Message the bot on that WhatsApp number → verify OpenClaw responds

---

## What's deferred (explicitly out of scope, don't build unless asked)

- **Telegram as secondary channel** (task #1, pending). Bot token input in dashboard → existing orchestrator's Telegram channel already works; needs ~100 lines of UI.
- **Embedded OpenClaw UI in customer dashboard**. OpenClaw's docs explicitly say "do not expose the dashboard publicly." If asked later, the pattern is Caddy + subdomain-per-tenant + forward_auth to Next.js. See the plan file.
- **gVisor / encrypted per-tenant PDs / Squid egress proxy**. Defense-in-depth layers. Add when there's a real threat model / compliance ask.
- **Multi-VM sharding**. Orchestrator can already target multiple docker hosts. Add when VM 1 hits 80%.
- **Tests**. Three focused Vitest files planned; write when cadence demands.
- **DBOS / Temporal**. Explicitly rejected. Our Postgres state machine + reconciler is the shape.
- **Kubernetes migration**. Explicitly rejected. Not needed until >>1000 tenants.
- **Fly.io migration**. Researched, rejected because Avraimi wants to stay on GCP.
- **Per-tenant admin UI** beyond what's in `/app`. Future.
- **Billing integration**. `beta_access` flag on `user` table gates paid features for now; add Stripe or Paddle later.
- **Admin panel for instance operations**. Use `psql` + runbook until it hurts.

---

## What's in place from earlier sessions (do not duplicate)

- Landing page at agentforall.co.il (Hebrew RTL, Meta Pixel + CAPI, 10-digit phone validation, Meta Ads published)
- Brand assets (brand/): logos, 22 social posts, 9 IG stories, color palette (cream, espresso, terra, sage)
- Remotion project at `D:\Projects\remotion-vid` — first Reel published to FB + IG (session 4)
- MBS: FB page + IG `@agentforall_il` connected, Meta Pixel ID `803144279101703`
- Phone validation enforcing 10-digit Israeli mobile format
- Admin panel at `/admin` with Bearer-token auth

---

## Design preferences (consistent across sessions)

- Palette: cream (`#FBF8F3`), espresso (`#2C1810`), terra (`#C7522A`), sage (`#6B8F71`). Avoid generic blue SaaS.
- No "2024 AI slop" — no dark gradients, no generic tech aesthetics
- No camera (Avraimi doesn't appear on camera)
- No hashtags on social media
- Hebrew RTL for all user-facing content
- Fonts: Heebo (body), Secular One (display)
- Don't change code without being asked. If user asks "is this optimal?", answer first — don't rewrite.
- Don't guess values — research platform specs and compute.

---

## Open tasks (for the next agent)

Re-read the TaskList at session start:
- #1 Phase 2: Telegram as secondary channel — pending, deferred
- All others — completed

Nothing is blocked. The system is shovel-ready for deployment. The likely next work is one of:
1. Deploy + smoke test + iterate
2. Add Telegram channel UI
3. Write the focused Vitest suite
4. Add observability (structured logs → GCP Cloud Logging, metrics to Cloud Monitoring)

---

## Git state at end of session 5

All changes are uncommitted on branch `main`. Per memory: never commit or push without explicit authorization in the current turn.

Files changed: 23 modified, 16 new files / directories. Run `git status` to see the full list. Nothing committed yet.
# Production image policy

- Never deploy production images from floating tags (`:latest`, `:main`).
- Current orchestrator ref: `europe-west4-docker.pkg.dev/agent-for-all/agent-forall/orchestrator@sha256:3e38351f4eb1e9e368a8558e15ed79bc7e6c95d4f722549ed1daf0f0e91cb133`.
- Current Hermes ref: `nousresearch/hermes-agent@sha256:b6e41c155d6bfce5ad83c5d0fec670086db8a43250e4511c9474134be5482d33`.
- Hermes containers follow the official Hermes Docker security contract; do not force generic `CapDrop=ALL` / `no-new-privileges` onto Hermes without smoke-testing the exact digest.
- Hermes config now mirrors gateway platforms in both Docker env and `config.yaml`. Do not promote Hermes digest `7a47d19ed1d4fa98f178756fd33772c914d9853e414e8366c268773f55517944`; it failed the API-server smoke test on 2026-05-26.
- Hermes WhatsApp UX is intentionally quiet for non-technical users: approvals off, tool progress off on WhatsApp, interim lifecycle messages off, busy input queued, long-task heartbeat disabled, runtime footer disabled, and busy ack disabled. TODO: evaluate custom `SOUL.md` later; default Hermes identity remains unchanged for now.
- Image refs live in `infra/variables.tf` and are rendered into `infra/startup.sh`; update them only after smoke-testing the exact digest.
- Docker cleanup may prune unused images/build cache only. Do not automate `docker volume prune`.
> 2026-05-27 operational update: `DEPLOY_HANDOFF.md` is the current source of truth for the LiteLLM Cloud SQL cutover, generic per-bot usage endpoint, web usage UI commit, and deployed orchestrator digest.
