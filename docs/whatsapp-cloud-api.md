# WhatsApp Business (Meta Cloud API)

A second WhatsApp channel, `whatsapp_cloud`, for **business** clients: customers write to the client's
own business number and the bot answers as the business. It sits next to the Baileys channel
(`type: "whatsapp"`), which stays the personal-assistant channel — Meta's Business Platform bans
general-purpose AI assistants (policy effective 2026-01-15) but allows customer service, orders, bookings
and FAQ.

Status: **built 2026-09-09 (uncommitted), reviewed and hardened the same day (§14), not yet run against a
live gateway or Meta.** Design revised 2026-09-02 against OpenClaw 2026.8.2 and Meta's current docs. Everything marked *verify in build* is an
assumption that must be proven on the real gateway before it ships; everything else is sourced (§13).
What exists: migration `0012_whatsapp_cloud`; orchestrator domain/config/relay/manager/dispatcher with
tests; web ingress, connect flow, dashboard row and page with tests; the channel plugin package
`packages/openclaw-channel-whatsapp-cloud` (written against the shipped 2026.8.2 SDK typings and the
official `@openclaw/whatsapp` plugin's structure, its SDK-facing files untested until the rehearsal);
Dockerfile, Caddy guard and rollout script updated. See §15 for the rehearsal checklist.

## 1. Why not Baileys for business clients

| | Baileys (today) | Cloud API |
|---|---|---|
| Legality | violates Meta TOS | official |
| Ban risk | permanent, no appeal | none |
| Stability | 408/405 reconnect storms, session expiry, first-message-lost | HTTPS webhooks, at-least-once, retried up to 7 days |
| Groups | yes | no (1:1 only) |
| Cost | free | free inside the 24h service window; templates billed to the client's WABA |
| Owner UX | QR scan, phone must stay online | Facebook popup, nothing on the phone |

## 2. Constraints that shaped the design (all verified)

| Fact | Consequence |
|---|---|
| OpenClaw sandboxing runs tools in Docker containers the gateway spawns; it needs the Docker socket. Tenant containers run `CapDrop: ["ALL"]`, `no-new-privileges`, no socket. | **No `sandbox.mode`.** Privilege separation uses `tools.toolsBySender` (per-sender policy, first match wins in order channel+id → id → e164 → username → name → `*`; cannot grant back global denials; MCP tools are named `<server>__<tool>`). |
| `tools.message.crossContext` is a single boolean `allowAcrossProviders` (+ `marker`). The per-route whitelist (issue #22725) was closed, not built. | Never enable it. Owner→customer replies use the owner-only `whatsapp_cloud_reply` tool. Escalation is a Telegram Bot API message from the orchestrator (the gateway's `/hooks/agent` runs an isolated turn that skips `toolsBySender`). |
| Meta webhooks: one callback URL per app; HMAC-SHA256 over the raw body in `X-Hub-Signature-256`; retried with decreasing frequency for up to 7 days (Cloud API webhooks; the generic Graph page says 36 h); batched (≤1000 updates); "your server should handle deduplication". | A durable, idempotent inbox keyed by `wamid`, not a synchronous forward. |
| The Embedded Signup `code` has a 30-second TTL and is exchanged with the **app secret** (`GET /oauth/access_token?client_id&client_secret&code`) for a business-integration system-user token scoped to the client's WABA. The webhook check needs the same secret. | The Meta **app** identity (app id/secret, signature verification, code exchange) lives on the web. Per-tenant **business tokens** live on the orchestrator. One secret, one owner. |
| `instances.config` is encrypted jsonb; it cannot be queried by `phone_number_id`. | A plain `whatsapp_cloud_numbers` lookup table. |
| OpenClaw channel plugins own inbound ingestion; `api.registerHttpRoute` exists, but so does the Telegram-style polling loop. Plugins live in the tenant **volume**; image bumps do not refresh them (`rollout-plugin.sh`). | The plugin **pulls** from the orchestrator (long-poll, bearer). No inbound network path into containers, one credential per container, survives restarts on both sides. |
| 2026.8.2 `/readyz` is channel-aware: 503 while any configured account is unlinked/blocked. Health monitor reads `channels.status` → `channelAccounts[channel][0]`. | The plugin implements `status.probeAccount` honestly (`linked` = credentials present, `connected` = relay reachable). |
| Hot reload: `channels.*`, `tools`, `hooks`, `plugins.entries.*`, `session` apply without a gateway restart. `plugins.load`/installs do not. | Connect/disconnect and policy changes are restart-free. Only the one-time plugin install per tenant needs a restart. |
| `agents.entries` is deliberately not orchestrator-owned; `tools` and `session` are. | One agent. No second agent, no `bindings`. |

## 3. Shape

```
customer ──▶ Meta ──POST (batched, signed)──▶ agentforall.co.il/api/webhooks/whatsapp-cloud   (Vercel)
                                                │ HMAC verify · Zod · phone_number_id → instance
                                                │ INSERT whatsapp_cloud_inbox ON CONFLICT (wamid) DO NOTHING
                                                │ 200
                                                ▼
                                          Supabase (inbox, conversations, numbers)
                                                ▲ NOTIFY wake (+ 500 ms fallback poll) / lease / ack
                                                │
                       orchestrator on the tenant's host ── GET  /api/v1/whatsapp-cloud/:id/inbox (long-poll)
                       (private, tenant-net)               ── POST /api/v1/whatsapp-cloud/:id/inbox/ack
                                                           ── POST /api/v1/whatsapp-cloud/:id/send   ──▶ graph.facebook.com
                                                           ── GET  /api/v1/whatsapp-cloud/:id/media/:mid ──▶ graph.facebook.com
                                                ▲ Bearer <channel relay token>
                                                │
                       openclaw + agentforall-whatsapp-cloud (channel plugin, in the tenant container)

dashboard ──FB.login popup──▶ Meta ──code + ids──▶ web (exchange with app secret) ──token──▶ orchestrator connect
```

### The six decisions

1. **Ingress on Vercel, and it only writes.** Meta needs one fixed URL. The route verifies, parses,
   inserts, answers 200. It never talks to an orchestrator, so host topology is irrelevant to it: a
   tenant on VM 7 is served because VM 7's orchestrator polls for its own instances. Multi-VM needs no
   per-host public hostnames for this path. The route mirrors `app/api/billing/webhooks/[provider]`
   (raw body, `timingSafeEqual`, body cap, `maxDuration`).
2. **Durable inbox, at-least-once end to end.** `wamid` is unique; Meta's retries and our own become
   no-ops. Rows are leased to a consumer and acked after the agent turn finished. That is a deliberate
   choice: a container restart mid-turn can repeat one reply, whereas acking first would lose the
   customer's message. On ack the payload is cleared and the wamid row stays 8 days as a dedupe marker.
   Nothing customer-written persists beyond delivery except the conversation ledger (§5).
3. **Plugin pulls; orchestrator serves.** Long-poll with the channel relay token. The orchestrator leases
   rows only for bots whose plugin is long-polling *right now* (woken by `NOTIFY` from the ingress insert,
   500 ms fallback tick, one partial-index query per waiting bot, at most 50 rows per bot per tick so a
   busy number cannot starve the others), feeding in-memory
   waiters per instance. Ordering is per customer by `(wa_timestamp, id)`; the plugin runs customers side
   by side and each customer strictly in order. Pull was chosen over `api.registerHttpRoute` push because
   it needs no route into containers, no gateway-token use on a hot path, and resumes by itself after
   either side restarts — the Telegram long-poll model OpenClaw channels already embody.
4. **Outbound through the orchestrator, not from the container.** The container holds no Meta
   credential. The send relay resolves the instance from its bearer, derives `phone_number_id` from the
   channel (a config bug cannot make bot A send as client B), enforces the 24-hour customer-service window
   from the conversation ledger (a jailbroken "send this to 500 numbers" fails deterministically), rate
   limits per caller and bot, and writes one audit row per send. Token rotation and revocation never touch
   a container. With the plugin already holding a bearer to the orchestrator for inbound, direct sending
   would add a credential to the container and buy nothing.
5. **One agent, privilege by identity.** `tools.toolsBySender`: the owner's identities get an empty
   policy (first match, no restriction); `*` (everyone else) is denied every policy group 2026.8.2
   defines — runtime, fs, sessions, messaging, automation, web, ui (browser, canvas), media (image/music/
   video/tts generation), agents, plugins, nodes, memory, openclaw — plus every MCP tool and the two
   owner-only channel tools. Same persona, same `SOUL.md`; strangers can only talk and escalate.
   `commands.ownerAllowFrom` + `session.identityLinks` fold the owner across channels, and the sender key
   `channel:whatsapp_cloud:<+E164>` makes the owner writing to their own business number still the owner.
6. **Deterministic owner loop, no model-initiated cross-channel sends.** Escalation and human handoff
   are plugin/orchestrator logic on explicit state. The owner is told by a plain Telegram Bot API message
   sent by the orchestrator with the tenant's own bot token — no agent turn anywhere on the owner's side,
   so customer text can never become an instruction (the gateway's `/hooks/agent` was rejected: a hook
   turn is "isolated" and skips `toolsBySender` entirely). The owner replies into a customer conversation
   with the owner-only tool `whatsapp_cloud_reply`. `allowAcrossProviders` stays off forever.

## 4. Components

| Piece | Where | Job |
|---|---|---|
| Ingress | `apps/web/src/app/api/webhooks/whatsapp-cloud/route.ts` → `lib/whatsapp-cloud/{ingress,service,repository}.ts` | GET handshake; POST: HMAC, Zod, number lookup, idempotent inbox insert, ledger upsert |
| Connect (web) | `app/api/bot/[id]/whatsapp-cloud/{connect,disconnect,status}/route.ts` → `lib/whatsapp-cloud/service.ts` → `lib/whatsapp-cloud/meta-oauth.ts` | Exchange `code` (30s TTL) with the app secret; forward token + ids (+ optional PIN) to the orchestrator; status; disconnect |
| Connect (orchestrator) | `routes/whatsapp-cloud.ts` → `services/whatsapp-cloud/manager.ts` → `services/whatsapp-cloud/graph-client.ts` + `storage/whatsapp-cloud-repository.ts` | Conflict check first, then `subscribed_apps`, `register` (PIN), number facts, bind, channel, event |
| Delivery relay | `routes/whatsapp-cloud-relay.ts` (prefix `/api/v1/whatsapp-cloud`, `skipGlobalAuth`, bearer per instance, `rateLimit` keyed by the socket peer via `routes/relay-rate-limit.ts`) | `inbox` long-poll, `inbox/ack`, `send`, `read`, `media/:id`, `escalate`, `conversations/:waId[/mode]` |
| Inbox dispatcher | `services/whatsapp-cloud/inbox-dispatcher.ts` | Lease for bots that are waiting on a NOTIFY wake or the 500 ms fallback tick, per-instance waiters, sweeper |
| Inbox listener | `storage/whatsapp-cloud-listener.ts` | One `LISTEN whatsapp_cloud_inbox` connection on the orchestrator's own `DATABASE_URL` (session pooler or direct; refused on Supabase's transaction pooler); wakes the dispatcher for the bot in the payload; 10 s connect timeout, reconnects with 1–30 s backoff |
| Send rate | `services/whatsapp-cloud/token-bucket.ts` | 80 msg/s token bucket per phone number, answered 429 before Meta's `130429` |
| Channel plugin | `packages/openclaw-channel-whatsapp-cloud/` (`agentforall-whatsapp-cloud`) | Poll loop with per-customer lanes, `dispatchInboundDirectDmWithRuntime`, outbound adapter → relay, `status.probeAccount`, `whatsapp_cloud_escalate` / `whatsapp_cloud_handoff` / `whatsapp_cloud_reply` tools |
| Config rendering | `agent-runtime/openclaw/config.ts` | `channels.whatsapp_cloud`, `plugins.entries.agentforall-whatsapp-cloud`, `tools.toolsBySender`, `.env` `WHATSAPP_CLOUD_RELAY_TOKEN` |
| Dashboard | `app/app/bot/whatsapp-business/*`, `BotCard.tsx` third channel row | FB JS SDK popup, PIN prompt when Meta asks for one, connect state, disconnect |

## 5. Data model — migration `0012_whatsapp_cloud`

`instances.config.channels[]` gains one variant (encrypted by `encryptChannel` like the Telegram token):

```ts
{ type: "whatsapp_cloud";
  wabaId: string; phoneNumberId: string; businessId: string;
  displayPhoneNumber: string; verifiedName: string;
  accessToken: string;      // business-integration system-user token, WABA-scoped
  pin: string;              // 6 digits: ours for a fresh number, the client's for a migrated one (§6 Connect)
  relayToken: string;       // 32 random bytes hex; the container's bearer for the relay
  relayUrl: string }        // http://orchestrator:3000/api/v1/whatsapp-cloud/<instanceId>
```

`CHANNEL_TYPES` gains `"whatsapp_cloud"`; `sanitizeInstance` masks `accessToken`, `pin`, `relayToken`;
`encryptConfig` covers all three.

Tables (Drizzle, `packages/db/src/schema/whatsapp-cloud.ts`):

| Table | Columns | Why |
|---|---|---|
| `whatsapp_cloud_numbers` | `phone_number_id` PK, `instance_id` FK unique **nullable** (set null on destroy), `waba_id`, `pin_encrypted`, `created_at`, `updated_at` | The only way the ingress can map a webhook to a bot, and the guarantee that one live number serves one bot. The row outlives a disconnect with `instance_id = null`: Meta keeps the number's two-step PIN, so a reconnect must present the same one |
| `whatsapp_cloud_inbox` | `id` bigserial PK, `wamid` unique, `instance_id` FK (cascade), `wa_timestamp`, `payload` jsonb nullable (`{ from, profileName, message }`, `message` being Meta's own object), `received_at`, `attempts`, `leased_until`, `acked_at`, `dropped_at`; partial index `(instance_id, wa_timestamp, id) WHERE acked_at IS NULL AND dropped_at IS NULL`; per-table autovacuum at 2% | Queue. Payload cleared on ack; the wamid row stays as a dedupe marker until the sweeper retires it (8 days) |
| `whatsapp_cloud_conversations` | `(instance_id, wa_id)` PK, `profile_name`, `last_inbound_at`, `last_outbound_at`, `mode` `bot\|human`, `updated_at` | 24h-window enforcement, handoff state, "מי כתב היום" |
| `whatsapp_cloud_sends` | `id`, `instance_id`, `wa_id`, `wamid`, `kind` `reply\|owner`, `created_at` | Audit of every outbound |

Retention: the sweeper (every 60s) marks unacked rows older than 7 days as dropped with event
`whatsapp_cloud.inbound_dropped` (attempts are telemetry, never a drop reason) and deletes acked or dropped
rows after 8 days — one day past Meta's 7-day retry window, so a late retry still hits the dedupe marker.
`payload` is customer-written text at rest in the same store that already holds leads' phones and emails,
for seconds under normal operation. No message body is ever logged.

Why the index is partial and the vacuum is tuned: the lease query only ever looks at pending rows, so the
index holds just those (a few, not the 8-day history) and stays in cache. Every row is inserted, updated
on lease and on ack, then deleted; Postgres keeps the old versions until autovacuum runs, and the default
20%-of-table trigger is too lazy for a small churny table, so the inbox vacuums and re-analyses at 2%.
The `ALTER TABLE ... SET (autovacuum_*)` line was appended to migration 0012 by hand — drizzle-kit does
not model storage parameters, so a future `generate` will not re-emit it.

Host scoping: none needed. A row is leased only while its bot's plugin is long-polling *this*
orchestrator, so each VM serves exactly its own tenants without a `host_id` join.

## 6. Flows

### Connect

1. Dashboard loads the FB JS SDK, calls `FB.login(cb, { config_id, response_type: "code",
   override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: "3" } })` and listens
   for the `message` event from `https://www.facebook.com` / `https://web.facebook.com` only (exact
   origin match, `lib/whatsapp-cloud/signup-origin.ts`): `type: "WA_EMBEDDED_SIGNUP"`, `event: "FINISH"`,
   `data: { phone_number_id, waba_id, business_id }`. `CANCEL` resets the flow.
2. On `FINISH` + callback `code`, the browser immediately POSTs `{ code, phoneNumberId, wabaId,
   businessId, pin? }` to `/api/bot/:id/whatsapp-cloud/connect` (the code dies in 30s).
   `authenticatedHandler`, Zod, `requireEntitlement`.
3. Web `WhatsappCloudService.connect` exchanges the code (`GET /oauth/access_token`, app id + secret,
   retry only on 5xx/429, secret scrubbed from errors), then calls the orchestrator
   `POST /instances/:id/whatsapp-cloud/connect { accessToken, phoneNumberId, wabaId, businessId, pin? }`
   with the service token + `x-act-as-user`. The token crosses exactly one TLS hop and is never stored on
   the web.
4. Orchestrator `WhatsappCloudManager.connect` (serialised per bot, refused before any Meta call while the
   bot is provisioning or being destroyed): (a) a bot that already has this number re-runs the Meta steps
   with the fresh token and stores it (step 5); a bot with a different number → `ConflictError`; (b) `whatsapp_cloud_numbers` lookup —
   a number live on another bot → `ConflictError` **before any Meta call**; (c) PIN = the user's entry,
   else the PIN retained for this number, else a fresh 6-digit one; (d) `POST /{waba_id}/subscribed_apps`
   → `POST /{phone_number_id}/register { pin }` → `GET /{phone_number_id}?fields=display_phone_number,
   verified_name`; (e) bind the number (upsert, encrypted PIN); (f) `updateChannels` with the new variant
   (on failure the number is released again); (g) event `whatsapp_cloud.connected` (ids only).
   Meta answers `133005` (two-step PIN mismatch: the number was registered elsewhere with a PIN we do not
   know) → `ChannelPinRequiredError` 409 `CHANNEL_PIN_REQUIRED` → web `pin_required` → the dashboard shows
   a PIN field and the user runs the popup again with it. Each Graph step is idempotent, so a
   half-finished connect is simply retried by the user.
5. The response is the connected view; the dashboard shows it at once. The relay token lands in the
   container's `.env`, so `applyConfig` restarts the container once (seconds); `channels.whatsapp_cloud`
   and the plugin entry are set on the live config in the same step. Connecting the **same** number again
   (the popup minted a new token — a revoked one is the usual reason) re-runs the Meta steps with the new
   token and replaces it in the channel (`whatsapp_cloud.reconnected`).

Prerequisite the UI says in Hebrew before the popup: the number cannot be in the WhatsApp app
(coexistence is a later option, §12). Payment method is added by the client inside Meta's flow.

### Inbound

1. Meta → ingress. `GET`: `hub.mode=subscribe` + `hub.verify_token` equals `META_WEBHOOK_VERIFY_TOKEN` →
   echo `hub.challenge`. `POST`: body ≤ 1 MiB (413 otherwise); `X-Hub-Signature-256` recomputed with the
   app secret over the raw body, compared with `timingSafeEqual` (401 otherwise — Meta does not retry on
   4xx, so a 401 is also an alert); Zod `WebhookEnvelope`; only `changes[].field === "messages"` with a
   `messages[]` array is processed — `statuses` are ignored (and not subscribed).
2. For each `entry[].changes[].value`: `metadata.phone_number_id` → `whatsapp_cloud_numbers` (live rows
   only) → `instance_id`. Unknown or released number → 200 + `log.warn` with ids (never 4xx, or Meta
   retries for 7 days). For each message: `INSERT ... ON CONFLICT (wamid) DO NOTHING`; upsert the
   conversation ledger (`last_inbound_at = greatest`, `profile_name`); one `pg_notify('whatsapp_cloud_inbox',
   instance_id)` per bot that got a fresh row. One transaction per webhook POST (the notification fires
   only on commit). 200 only after commit; any DB failure → 500 so Meta retries.
3. Orchestrator dispatcher: on a NOTIFY for a bot whose plugin is waiting on `GET /inbox`, or every 500 ms
   as the fallback for a dropped listener connection, for each waiting bot
   lease up to 50 unacked, unleased (or lease-expired) rows oldest first (`FOR UPDATE SKIP LOCKED`,
   `leased_until = now() + 60s`, `attempts + 1`) and resolve that bot's waiter. A plugin that never acks
   sees the row again after the lease; after 7 days the sweeper drops it.
4. Plugin loop: `GET /inbox?wait=25000` → `[{ id, wamid, from, profileName, timestamp, message }]`. Each
   customer gets a lane (messages in order); up to 8 lanes run side by side. Per message: if the
   conversation is in `human` mode, forward it to the owner (§ Escalation, `kind: "forward"`) and ack;
   else send the read receipt + typing indicator through the relay and call
   `dispatchInboundDirectDmWithRuntime({ channel: "whatsapp_cloud", peer: { kind: "direct", id: "+"+from },
   senderId: "+"+from, rawBody, inboundAccessAuthorized: true, deliver })`. Ack when the turn finished.
   A wamid already in flight (a lease that expired mid-turn) is ignored, not re-run; a wamid already
   finished (LRU of 500) is acked again without a turn. Text, button and interactive replies become the
   customer's words; image/audio/video/document/sticker/location/reaction are described in Hebrew (kind,
   caption, filename) — the relay's `GET /media/:id` already streams the bytes for a later media pass.
5. The reply is delivered by the outbound adapter (below); the customer sees it quoted to their message.

### Outbound

Plugin `createChatChannelPlugin.outbound` = `base: { deliveryMode: "direct" }` (the runtime's own chunking
never runs on the direct `deliver` path, so the plugin's `chunkText` splits at 4,096 UTF-16 units, never
inside a surrogate pair) + `attachedResults.sendText` → `POST /send { to, text,
replyToId?, kind }` with the bearer. The relay: resolve instance by bearer (SHA-256 + `timingSafeEqual`)
→ channel must exist and instance `isLive` → `to` must have `last_inbound_at` within 24h in the ledger,
else `CustomerWindowClosedError` (409, surfaced to the agent as "the customer must write first") →
`POST graph.facebook.com/{version}/{phone_number_id}/messages { messaging_product:"whatsapp", to,
type:"text", text:{ body }, context?:{ message_id } }` (never retried — a second attempt after an
ambiguous failure would be a second message) → ledger `last_outbound_at` → `whatsapp_cloud_sends` row →
return `wamid`. Relay traffic is limited to 600 requests/min per socket peer (one container, one bucket).
The plugin keeps the produced chunks in a per-message reply queue until the relay accepted each one, so a
redelivery after a failed send resends what is left and never asks the model again (in memory only: a
gateway restart re-runs that one turn).

Graph errors map to domain errors: `190` token invalid → `ChannelCredentialError` (409), event
`whatsapp_cloud.token_invalid` and one Telegram notice to the owner, both once per orchestrator process
per bot and only once the notice was actually delivered, `status.health = "token_invalid"` (probed at
most once a minute per bot); a bare HTTP 401 counts the same; `131047` re-engagement →
`CustomerWindowClosedError`; `130429` / `131056` / `80007` / `131048` / `4` / `17` / `32` / `613` (Meta's
rate, pair-rate, throughput, spam-rate, app and user limits) →
`UpstreamRateLimitedError` (429, "later", not "no"); `133005` → `ChannelPinRequiredError`; other 4xx →
`ValidationError` with the Meta code; 5xx/network → `UpstreamUnavailableError`. Only the graph client
knows Meta's API version; bump in one place.

Owner-initiated replies ("תגיד לו 350 ₪") are the owner's session calling `whatsapp_cloud_reply({ waId,
text })` — allowed only for owner keys via `toolsBySender`, delivered by the same relay, same window rule,
audited as `kind: "owner"`.

### Escalation and handoff (explicit state, no timers)

- Customer sessions have one action tool: `whatsapp_cloud_escalate({ summary })` (plugin-registered,
  `alsoAllow`ed for `*`). The customer is derived from the session key the gateway minted, never from a
  parameter. It posts `{ waId, summary, kind: "request" }` to the relay. The orchestrator requires a
  ledger row for `waId` (no row = not a customer of this bot → 404, which also covers a Baileys-side
  stranger whose per-peer session key looks the same), then sends the owner a plain Telegram message
  through the tenant's own bot token (`TelegramBotApi.sendMessage`): three lines — lead, "מי: <profile
  name flattened and capped> (+E164)", "מה: <summary flattened, ≤3500 chars>". Nothing on the owner's
  side runs a model. One request per customer per 2 minutes and 60 messages per bot per minute of any
  kind; a throttled call returns `{ notified: false }` and the tool tells the model the owner already
  knows. The throttle is stamped only after Telegram accepted the message, so a Telegram outage does not
  eat the retry.
- The owner takes over with "אני לוקח את 052-…" → owner-only tool `whatsapp_cloud_handoff({ waId, mode })`
  → ledger `mode = human` (refused when the bot has no Telegram owner to hand to). While `human`, inbound
  is not dispatched to the agent; the plugin forwards it to the owner the same way (`kind: "forward"`,
  per-bot cap only), and the owner answers with `whatsapp_cloud_reply`. "תמשיך" → `mode = bot`. If the
  relay cannot say which mode a conversation is in, the message stays unacked rather than reaching a bot
  the owner silenced.
- Both owner tools are denied to `*`; all three write ledger state through the relay, so the state is
  orchestrator-owned and survives container recreation.

### Disconnect / destroy

`POST /instances/:id/whatsapp-cloud/disconnect`: release the number first (`instance_id = null`, row and
PIN kept, so the ingress stops queueing at once) → only if the number is still ours or free:
`DELETE /{waba_id}/subscribed_apps` and `POST /{phone_number_id}/deregister` (best effort, warn) — a stale
channel whose number moved to another bot must not deregister that bot's number → strip the channel (`buildChannels` omits the
block → `ownedPaths` deletes `channels.whatsapp_cloud` and the plugin entry whole) → purge inbox,
conversations and sends for the instance → event `whatsapp_cloud.disconnected`. The `.env` change restarts
the container once. Destroy runs release → Meta → purge before the container is removed; the FK sets the
number row's `instance_id` to null if anything is left. The token is discarded; Meta invalidates it when
the client removes the app from their business.

## 7. Security model

- **Two credentials, two owners.** Meta app id/secret + webhook verify token: Vercel env (GSM
  `meta-app-secret`, `meta-webhook-verify-token`; app id and Embedded Signup config id are public,
  `NEXT_PUBLIC_*`). Business tokens + PINs + relay tokens: orchestrator DB, AES-256-GCM via
  `services/crypto.ts`, redacted from logs and `sanitizeInstance`.
- **Containers hold no Meta credential.** Only `WHATSAPP_CLOUD_RELAY_TOKEN` in `.env` (0600, excluded
  from backups like today's `.env`); the relay URL and number ids sit in the channel block.
- **Relay reachability.** `/api/v1/whatsapp-cloud/*` is reachable on `tenant-net` only; Caddy answers
  404 for it exactly like `/api/v1/mcp/*` (`infra/startup.sh` renders the Caddyfile — add the block
  there, not by hand; see the startup-script drift warning in DEPLOY_HANDOFF).
- **Sender identity comes from the adapter, never from message text** (the `toolsBySender` doc's own
  rule). The plugin sets `senderId` from Meta's `from`; the owner's identities are rendered by the
  orchestrator from what the dashboard verified.
- **Blast radius of a jailbreak:** a customer session can read the conversation it is in, call
  `whatsapp_cloud_escalate` (about itself, at most once per 2 minutes), and reply to itself inside the 24h
  window. It cannot run code, read files, read other sessions, touch memory, open the browser or canvas,
  generate media, reach integrations, message anyone else, or spawn agents. What reaches the owner from an
  escalation is three lines of flattened text in a Telegram message; no model reads it on the owner's side.
- **Relay rate limit is per socket peer + bot, and runs before the bearer lookup.** Keyed on
  `socket.remoteAddress`, not `request.ip` (with `trustProxy` on, a container could mint buckets via
  `X-Forwarded-For`); the bearer check is a `preHandler`, so an unauthenticated burst is 429'd before it
  costs a config decrypt (`routes/relay-rate-limit.ts`, shared with the MCP relay).
- **Media proxy** only follows URLs on Meta's CDN hosts over https and caps the stream at 100 MB, so the
  WABA bearer is never sent elsewhere.
- **Not fixed here, pre-existing:** tenant containers can reach each other on `tenant-net` (ICC on). Nothing
  in this feature listens inside a container, so it adds no new target; disabling ICC is an infra change
  to make on its own.
- **Signature failures, unknown numbers, window violations, token errors** each emit a structured warn
  with ids only.

Known limits, accepted for v1:

- Mexico and Argentina `wa_id`s may carry a legacy extra digit (`521…`, `549…`), so an owner writing from
  such a number may not match `channel:whatsapp_cloud:<+E164>`; they keep their Telegram identity.
- An owner known only through Telegram has no business-number identity: writing to the business number
  from their own phone is a customer session.
- One phone number is one peer session key across Baileys and the business number
  (`agent:main:direct:+E164`), so a customer who is also a Baileys contact shares a session.
- A disconnect that fails half-way (Meta unreachable after the row is released) leaves a live Meta
  subscription until the next disconnect or connect converges it; no message can reach a bot meanwhile
  because the number map is already empty.
- The plugin's reply queue lives in memory: a gateway restart between a failed send and its redelivery
  re-runs that one turn (one possible duplicate). A turn that never settles is presumed dead after two
  timeouts (20 minutes); if it does finish after that, the redelivery may have answered already.
- `relayUrl` is written into the channel at connect time from `ORCHESTRATOR_INTERNAL_URL`, like the MCP
  relay binding; changing that URL means reconnecting the number.

## 8. Config rendered by the orchestrator

Owned paths added: `["plugins","entries","agentforall-whatsapp-cloud"]`; `CHANNEL_OWNED_PATHS.whatsapp_cloud`
= the whole block (it is ours end to end). `["tools"]` and `["session"]` are already owned.

```json5
channels: {
  whatsapp_cloud: {
    enabled: true, dmPolicy: "open", allowFrom: ["*"], defaultAccount: "default",
    accounts: { default: { enabled: true, phoneNumberId: "<id>", displayPhoneNumber: "+9725…",
                           relayUrl: "http://orchestrator:3000/api/v1/whatsapp-cloud/<instanceId>" } }
  }
},
plugins: { entries: { "agentforall-whatsapp-cloud": { enabled: true } } },
session: { dmScope: "per-peer",
           identityLinks: { owner: ["telegram:<id>", "whatsapp:<+E164>", "whatsapp_cloud:<+E164>"] } },
commands: { ownerAllowFrom: [/* same */] },
tools: {
  exec: { security: "deny" },                  // exec is on the gateway host once sandbox is off — never for anyone
  toolsBySender: {
    "channel:telegram:<id>": {},              // owner: first match, unrestricted
    "e164:<owner E164>": {},
    "channel:whatsapp_cloud:<owner +E164>": {}, // the plugin reports senders as +E.164, so this is the key that matches
    "*": { deny: ["group:runtime", "group:fs", "group:sessions", "group:messaging", "group:automation",
                  "group:web", "group:ui", "group:media", "group:agents", "group:nodes", "group:memory",
                  "group:openclaw", "bundle-mcp", "agentforall__*", "intent",
                  "whatsapp_cloud_handoff", "whatsapp_cloud_reply"],
           alsoAllow: ["whatsapp_cloud_escalate"] }
  }
}
```

The deny list names every policy group in 2026.8.2's `POLICY_TOOL_GROUPS` (`group:web` is only
`web_search`/`web_fetch`/`x_search`; the browser lives in `group:ui`, generation in `group:media`), plus
`bundle-mcp` (every MCP server, whatever the tenant named it) and the plugin tools one by one (`intent`,
our two owner tools). **Never `group:plugins`**: it expands to every plugin-registered tool including the
escalation, and deny beats `alsoAllow`. `whatsapp-cloud-config.test.ts` asserts the exact array so a new
group in a later release is a deliberate edit. There is no `hooks` block: the gateway's webhook endpoint
is not opened. `.env` addition: `WHATSAPP_CLOUD_RELAY_TOKEN` only. Because `.env` changes, connect and disconnect
restart the container once; everything else in the block hot-applies. *Verify in build:* (a) an empty `{}`
policy on the owner keys is "no restriction"; (b) memory-core's recall still reaches customer turns with
`group:memory` denied (§15 item 7).

Integrations for customers stay **off** in v1 (`agentforall__*` denied). The v2 path is verified-consistent
with OpenClaw naming: a second Composio Tool Router session per bot (same `user_id`, `toolkits`/`tools`
filters) mounted as `mcp.servers.agentforall-customers`, then `*` denies `agentforall__*` and the owner
denies `agentforall-customers__*`.

## 9. Plugin contract (`agentforall-whatsapp-cloud`)

Layout and packaging mirror `packages/openclaw-plugin-credit` (ESM JS, `openclaw.plugin.json`, `npm pack`
→ `openclaw plugins install "npm-pack:…" --force --accept-capabilities` in the Dockerfile; existing
tenants via `infra/ops/rollout-plugin.sh --plugin agentforall-whatsapp-cloud --sentinel …`). Manifest:
`id`, `channels: ["whatsapp_cloud"]`, `channelConfigs.whatsapp_cloud.schema`, `contracts.tools`. TypeBox
(the same package the bundled channels use) is bundled with the tarball; the peer range is pinned to
`>=2026.8.2 <2026.9.0` because 2026.9 renames SDK symbols.

- `defineChannelPluginEntry` + `createChatChannelPlugin` over `createChannelPluginBase({ id:
  "whatsapp_cloud", config: { listAccountIds, resolveAccount, … } })`, `security.dm.defaultPolicy: "open"`.
- `gateway.startAccount` starts the poll loop (`poll-loop.js`: backoff 1s → 30s on relay errors; 401 stops
  the loop and reports `lifecycle: "blocked"`; one lane per customer, 8 lanes in flight; ack after the
  turn; in-flight and LRU dedupe by wamid); `stopAccount` aborts it and waits for running lanes.
- `status.probeAccount` → `{ connected, lastPollAt }` and `buildAccountSnapshot` sets `lifecycle` — so
  `/readyz` and the health monitor see the truth.
- Inbound: `dispatchInboundDirectDmWithRuntime` per message (`channel.js`), senders as `+E.164`.
- Outbound: `outbound.base { deliveryMode: "direct" }`, `chunkText` at 4,096 UTF-16 units, per-message reply queue + `attachedResults.sendText`
  → relay (`kind: "owner"` when the owner's session sends).
- Tools (`tools.js`): `whatsapp_cloud_escalate({ summary })`, `whatsapp_cloud_handoff({ waId, mode })`,
  `whatsapp_cloud_reply({ waId, text })`.
- Tests (`node --test`): inbound description, relay client shapes and errors, poll loop (order, lanes,
  in-flight dedupe, backoff, 401), manifest ids and session-key parsing.

## 10. Failure modes and operations

| Situation | Behaviour |
|---|---|
| Orchestrator down / deploying | Ingress still inserts (Vercel + Supabase); plugin poll fails → `connected:false` → bot `degraded`; polling resumes, rows are delivered in order. Nothing lost. |
| Vercel or Supabase down | Ingress 5xx → Meta retries for up to 7 days. |
| Listener connection lost (pooler restart, network) | Wake-ups pause, the 500 ms poll carries delivery, the listener reconnects with 1–30 s backoff. `DATABASE_URL` on Supabase's transaction pooler (port 6543) → warn at boot, no listener, poll only. |
| Container restarting | Leases expire (60s); rows redelivered. A turn that finished but never acked repeats once — at-least-once by choice (§3 decision 2). |
| Agent turn hangs | The plugin gives up after 10 minutes, leaves the row unacked and holds that customer's lane; the loop keeps serving other customers. |
| One message of a customer fails | The rest of that customer's lane waits unprocessed; after the lease expires the whole run comes back in order. |
| Long outage of the model provider | Rows wait in the inbox up to 7 days (age is the only drop reason; attempts are telemetry). |
| One number sends faster than 80/s | Per-number token bucket in the orchestrator answers 429 before Meta's `130429`; the plugin surfaces the failure like any other send error. |
| Duplicate webhook | `ON CONFLICT DO NOTHING`. |
| Customer writes during a 40s turn | Queued in that customer's lane; other customers are not blocked. |
| One customer floods | At most 50 rows leased per bot per tick; other bots on the host unaffected. |
| Token revoked by the client | Graph `190` → `ChannelCredentialError`; event `whatsapp_cloud.token_invalid` + one Telegram notice to the owner; `/status` shows `health: "token_invalid"`. |
| Number already live on another bot | `ConflictError` before any Meta call. |
| Number carries a two-step PIN we do not know | Meta `133005` → `CHANNEL_PIN_REQUIRED` → the dashboard asks for the PIN and the user runs the popup again. |
| Model escalates in a loop, or a container spams `/escalate` | One request per customer per 2 minutes, 60 owner messages per bot per minute of any kind; repeats are told "already notified". |
| Dashboard polls `/status` | Meta is probed at most once a minute per bot. |
| Meta throttles (`130429`, `131056`, `80007`, `131048`, `4`, `17`, `32`, `613`) | `UpstreamRateLimitedError` 429 to the plugin; no automatic retry of a send. |
| Idle ledger rows / old audit rows | Sweeper deletes conversations idle 30 days (never one in `human` mode) and sends older than 90 days (customer phone numbers are PII); it also releases numbers still bound to destroyed bots and logs a warning per bot whose oldest unacked row is over an hour old. |
| A tenant destroyed with the number still bound | `findNumber`, `bindNumber` and the ingress lookup treat a binding to a `destroying`/`destroyed` bot as free; the sweeper nulls it within a minute. |
| Feature switched off (`WHATSAPP_CLOUD_ENABLED` unset on Vercel) | The webhook still answers (so the Meta app can be registered and rehearsed); the dashboard row and the connect page are hidden and `POST /connect` is 503, while a number already connected keeps showing with its disconnect. |
| Container hangs up mid media download | The relay aborts the CDN stream on the request's `close`; a stalled CDN body is aborted after 60 s without a chunk. |
| Plugin missing on an old tenant | `plugins.entries` for an absent plugin is inert ("stale config entry ignored") and the gateway still starts; the rollout order is image build → `rollout-plugin.sh --plugin agentforall-whatsapp-cloud` for that tenant → connect. |

Runbook additions: GSM secrets `meta-app-secret`, `meta-webhook-verify-token` (+ Vercel env);
orchestrator `DATABASE_URL` in session mode or direct (on Supabase's transaction pooler, port 6543, the
listener stays off and the poll carries delivery); web `WHATSAPP_CLOUD_ENABLED=true`
once the rehearsal passed; `rollout-plugin.sh` without `--require-gateway` (this plugin needs no LiteLLM);
`NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID`; Caddy 404 block in
`infra/startup.sh`; migration 0012 applied before the orchestrator that renders the channel; Vercel
deployed before the webhook URL is registered in the Meta app; `rollout-plugin.sh` for the 12 live tenants
only when a client actually connects (the channel is opt-in; no plugin is loaded for bots without it).
Dashboards: inbox depth per host, oldest unacked age, sends per instance, Graph error rate by code.

## 11. Tests

Orchestrator (`node:test` + `tsx`, `apps/orchestrator/test/`): `whatsapp-cloud-manager.test.ts` (connect
idempotency and re-bind, conflict before Meta, PIN reuse / user PIN / `133005`, disconnect order, bearer,
window rule, Meta code mapping incl. throttles, dead-token once, escalation fencing and throttle, handoff),
`whatsapp-cloud-relay.test.ts` (real Fastify: bearer on every route, long-poll, ack bigints, send + 409,
media streaming, validated bodies, rate-limit key), `inbox-dispatcher.test.ts` (waiters, replacement,
stop, sweep events), `meta-graph-client.test.ts` (retry policy, no retry on send, error envelope),
`whatsapp-cloud-config.test.ts` (channel block, exact deny list, owner keys, no hooks block, `.env`),
`whatsapp-cloud-secrets.test.ts` (encryption round-trip, `sanitizeInstance`). Web
(`apps/web/test/whatsapp-cloud/`): `ingress.test.ts` (signature, challenge, envelope, unknown number,
dedupe), `service.test.ts` (code exchange, secret scrubbing, retry, body schema incl. PIN),
`signup-origin.test.ts`. DB: migration shape test. Plugin: §9.

**Database-backed tests** (`*.db.test.ts`, skipped unless `TEST_DATABASE_URL` is set; they refuse a URL
that looks like Supabase or prod, drop and recreate `public` plus the migrator's `drizzle` schema, apply
every migration, then run the real SQL): orchestrator `whatsapp-cloud-repository.db.test.ts` (number
claim/re-claim/conflict/destroyed-bot release, lease order + per-bot cap + `SKIP LOCKED` against a second
connection + expiry + attempts, malformed rows dropped, sweep drop/retire/backlog/release) and web
`repository.db.test.ts` (routing only for live bots, idempotent batch, ledger `greatest`/`coalesce`,
mode preserved, one `NOTIFY` per bot on commit). Run them before any change to the repositories or the
migration:

```
docker run -d --rm --name af-test-pg -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:16-alpine
TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/postgres npm run -w @agent-forall/orchestrator test:db
TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/postgres npm run -w @agent-forall/web test:db
docker rm -f af-test-pg
```

`infra/ops/test-set-runtime-env.sh` (plain bash) covers the boot script's env writer. Their first run
(2026-09-10) found three defects the unit tests could not: Drizzle's raw `execute` returns
timestamps as text, so the lease parser rejected every row (nothing would have been delivered); the backlog
aggregate was text too (the sweep would have thrown every minute); the ingress lookup still routed to a
destroyed bot. One end-to-end rehearsal against Meta's **test number** (5 recipients, no verification
needed) remains the acceptance gate and doubles as the app-review screencast.

## 12. Meta track

App **Agent For All** `1116647830699409` on portfolio `agentforall_il` (`1586169975794890`), created
2026-09-02; WhatsApp use case added; Independent Tech Provider onboarding started (0/2). Portfolio details
corrected (website `agentforall.co.il`, tax id on file).

1. **Business verification** — pending submission; portfolio admin uploads an authority-issued document
   (אישור ניכוי מס במקור or תעודת עוסק מורשה); legal name must match the document.
2. **Access verification** (Tech Provider) — separate ~5-day review after (1); without it advanced-access
   calls "will begin to be blocked".
3. **App review** — Advanced Access to `whatsapp_business_messaging` + `whatsapp_business_management`,
   screencast of the working flow; needs §9 built. Standard Access already works for numbers owned by our
   own portfolio, which is enough to build and rehearse.
4. **Embedded Signup v4** configuration → `config_id` (v2 deprecated 2026-10-15).

Client-side facts: no partner status and no verification needed to start (unverified WABA: 2 numbers, 250
business-initiated conversations/24h; **service replies inside the 24h window are unlimited and free**);
Meta bills the client's WABA, never the Tech Provider; the number must be off the WhatsApp/WA Business
app. **Coexistence** (number stays in the WA Business app; 180-day history sync; no groups; 20 msg/s) is
supported for Tech Providers — country eligibility for Israel unconfirmed. The "Meta-hosted Embedded
Signup link" seen on the onboarding page is unverified as to where credentials land; v1 uses the JS SDK
popup, which is fully documented.

## 13. Sources and verification status

OpenClaw (docs.openclaw.ai, 2026.8.2): `plugins/sdk-channel-plugins`, `plugins/sdk-channel-inbound`,
`plugins/sdk-channel-message`, `plugins/sdk-overview`, `plugins/manifest`, `gateway/sandboxing`,
`gateway/config-tools` (`toolsBySender`), `tools/multi-agent-sandbox-tools` (precedence, MCP naming),
`concepts/session-tool` (`conversations_send` owner-only), `concepts/channel-routing` (session keys),
`gateway/configuration` (hot reload), `automation/cron-jobs#webhooks` (hooks), `help/faq` (crossContext).
Meta: `graph-api/webhooks/getting-started` (handshake, signature, batching, dedupe), Cloud API webhooks
overview (7-day retry),
`whatsapp/cloud-api/webhooks/components` (payload), `embedded-signup/implementation` (FB.login, event,
30s code TTL), `embedded-signup/onboarding-customers-as-a-solution-partner` (`oauth/access_token`,
`subscribed_apps`, `register`). Repo: `docs/openclaw-2026.8.2-upgrade.md`, `docs/integrations.md`,
`agent-runtime/openclaw/config.ts`, `routes/mcp-relay.ts`, `services/integrations/manager.ts`,
`app/api/billing/webhooks/[provider]/route.ts`.

Checked against releases through 2026.9.3 (2026-09-08): nothing changes the design. Notes: 2026.9.2 makes
session tools default to all-session visibility (helps the owner; customers have `group:sessions` denied);
2026.9.3 renames `buildChannelTurnMediaPayload` → `buildChannelInboundMediaPayload` — the plugin targets the
SDK of the core we deploy and pins `peerDependencies` to it.

Open, to be settled in build: `conversations_send` across providers; empty `{}` owner policy semantics;
memory-core write tool names; Israel coexistence eligibility; business-token expiry (documented as
long-lived; handle `190` regardless).

## 14. What changed in this revision

- Dropped `sandbox.mode: non-main` (needs Docker in the tenant container) → `tools.toolsBySender`.
- Dropped `crossContext.routes` (never existed) → `conversations_send` + gateway hooks; `allowAcrossProviders` stays off.
- Ingress no longer forwards to a host; it writes a durable idempotent inbox. Plugin pulls. Multi-VM needs nothing extra.
- Outbound through the orchestrator relay (window enforcement, no Meta token in containers) instead of direct.
- Meta app secret and code exchange on the web; business tokens on the orchestrator.
- Added `whatsapp_cloud_numbers` (encrypted config is not queryable), conversation ledger, audit table, retention.
- Escalation/handoff as explicit orchestrator-owned state with deterministic owner delivery.
- Plugin implements `status.probeAccount` so 2026.8.2's channel-aware `/readyz` stays truthful.
- Meta-hosted signup link demoted to unverified; JS SDK popup is v1.

Review pass 2026-09-09 (fresh reviewer against the built code and the 2026.8.2 dist):

- Stranger policy now denies `group:ui` and `group:media` too (browser and media generation were open) and
  `group:openclaw`; the config test pins the exact list.
- Owner key `channel:whatsapp_cloud:<+E164>` added; the `e164:` bucket never matches our plugin's senders.
- Relay rate limit keyed by caller IP + bot (was bot only, spendable by any container before auth).
- PIN retained per number (`pin_encrypted`, row survives disconnect); `133005` → `CHANNEL_PIN_REQUIRED`
  and a PIN field in the dashboard.
- Conflict check before any Meta call; number released before Meta on disconnect; bind is an upsert.
- Poll loop: per-customer lanes, 8 in flight, in-flight dedupe; `textChunkLimit: 4096` on outbound.
- Escalation: customer from the session key only, 2-minute throttle per customer.
- Per-bot lease cap; Meta throttle codes → 429; dead token → event + one owner notice.
- Embedded Signup `message` origin: exact allowlist.
- Dead code removed (`findBinding`, `mediaUrl`, `activeLoop`, `qualityRating`, `sizeBytes`, `system` send kind).

Second review pass 2026-09-09 (two fresh reviewers, security and correctness, against the dist):

- **Gateway hooks dropped.** A `/hooks/agent` turn is "isolated" and skips `toolsBySender`, so the owner
  notification ran with every tool and customer text as input. Owner delivery is now a plain Telegram Bot
  API message from the orchestrator; `hooksToken`, the `hooks` block and its owned path are gone.
- **`group:plugins` removed from the deny list** — it expanded to the escalation tool too, and deny beats
  `alsoAllow`, so customers could not escalate at all. Replaced by `bundle-mcp` + `intent` + the two owner tools.
- Relay limiter keyed on the socket peer (was `request.ip` behind `trustProxy`) and ordered before the
  bearer lookup (auth is a `preHandler`).
- Escalation requires a ledger row for the customer; per-bot cap of 60/min for every kind; throttle stamped
  only after delivery; handoff to `human` refused without a Telegram owner.
- Reconnecting the same number stores the fresh token (was silently dropped); disconnect leaves Meta only if
  the number is still ours; a stale row for a previous number no longer blocks a new one.
- Poll loop: 10-minute cap on a turn, abort-aware room wait, a failed message holds its customer's lane so
  order survives redelivery, start-after-stop chains instead of orphaning; human-mode lookup fails closed.
- Inbox: dropped by age only (36h); attempts are telemetry; stale queued batches are not handed out past the
  lease; ledger rows idle 30d and sends older than 90d are swept.
- Media proxy: Meta CDN hosts only, 100 MB cap. Health probe cached 60s. Meta 401 without a code and
  codes 4/17/32/613 mapped. Verify-token compare timing-safe. Meta 5xx on the code exchange → 502, not
  "code rejected". SDK load failure and a dead token surface in the dashboard with a reconnect path.

Third review pass 2026-09-10 (two fresh reviewers, dist-verified):

- Owner delivery falls back to the bot (`fallbackToBot`) when the owner has no Telegram or blocked the
  bot (403) — a customer in `human` mode is never left unanswered; escalation caps enforced per bot
  (60/min) and per customer (2 min), stamped only after delivery.
- Plugin: replies over 4,096 code points chunked at paragraph/sentence cuts; a failed message holds its
  lane head until that wamid is redelivered; a turn that finishes after the 10-minute cap still acks;
  8 lanes in flight; a delivery failure that is retryable (relay 429/5xx/network) rethrows so the row is
  redelivered, a rejected one (4xx) acks.
- Ingress: one malformed contact or message is rejected and counted, the rest of the batch lands;
  `received_at` (not Meta's timestamp) drives the 24h window; `INVALID_STATE` → `bot_not_ready`.
- Dashboard shows `token_invalid` with a reconnect path; media proxy gets a 60 s header timeout;
  credential codes 10/102/2xx mapped; `human`-mode ledger rows are never swept.

Research-driven 2026-09-10 (sourced comparison against Solid Queue, pg-boss, Graphile Worker, SQS,
Telegram `getUpdates`; verdict: keep the Postgres queue + long poll, add the wake):

- `LISTEN/NOTIFY` wake: the ingress `pg_notify`s the bot id inside the insert transaction; the
  orchestrator holds one direct connection (`DATABASE_LISTEN_URL`, `storage/whatsapp-cloud-listener.ts`)
  and wakes a tick only for a bot that is waiting. The 500 ms poll stays as the fallback.
- Retention 7 days drop / 8 days marker (Meta retries for 7 days, not 36 h).
- Partial index on pending rows; per-table autovacuum at 2% (appended to migration 0012 by hand).
- 80 msg/s token bucket per phone number in the send path.

Fourth review pass 2026-09-10 (three fresh reviewers: orchestrator core, plugin + web, cross-cutting):

- **Redelivery never re-runs the model.** The plugin keeps a per-message reply queue; a failed send is
  resumed on redelivery and a dead token costs one relay call a minute, not one model turn.
- **Shutdown releases long-polls first**, so `app.close()` drains within the forced-exit budget.
- **A number bound to a destroyed bot no longer blocks anyone**: the number lookups treat such a binding
  as free, the sweeper nulls it, and the config patch route can no longer strip the business channel.
- **Meta-accepted sends are never reported as failures** when our own bookkeeping fails afterwards.
- **One set-based lease query** (`unnest` + `LATERAL ... FOR UPDATE SKIP LOCKED`) for every waiting bot,
  and a NOTIFY wakes a query for that bot only; malformed rows are dropped, not delivered.
- Listener: stop during connect, double start, dropped clients closed, backoff kept for short-lived
  connections, TCP keepalive. Dispatcher: merged batches keep the older lease clock; stale batches purged.
- Escalation slot reserved before the Telegram call (concurrent escalations respect the cap); bidi and
  other format characters stripped from owner messages; media host rejection is a 400, oversized media a
  413; media downloads follow the caller's connection and time out per chunk.
- Connect serialised per bot, refused before Meta for a bot that cannot take a channel; the row's PIN wins
  over a lagging channel copy.
- Plugin: chunks measured in UTF-16 units like the relay's validation; owner-only tools refuse a customer
  session outright; a failed head is released after the turn timeout and a hung turn is abandoned after a
  second one; relay errors logged as status + code; empty texts get no turn; start/stop serialised.
- Web: the FB SDK iframe hosts added to `frame-src`; the code-before-FINISH race waited out; a NUL in a
  message no longer fails the batch; rejected webhooks logged; a 2xx Meta cannot be read is not retried
  with the single-use code; `WHATSAPP_CLOUD_ENABLED` gates the dashboard row and connects.
- Infra: a missing `database-listen-url` secret no longer aborts the VM boot; `rollout-plugin.sh` gates
  the gateway skip behind `--require-gateway`; `secretsOf` redacts the three channel secrets from gateway
  errors; sweep indexes on the inbox, ledger and audit tables; `package-lock.json` re-synced.
- Removed: `listConversations` route, `META_ERROR_TOKEN_INVALID`, `MetaGraphError.subcode`,
  `WebhookEnvelope`, `mediaIdOf`, three copies of `extractBearer`, duplicated error helpers.

Fifth pass 2026-09-10 (one fresh reviewer scoped to the round-four diff, plus the first Postgres-backed
run of the repositories; every fix below was made test-first — the failing test is named in the suite):

- **The real SQL had never run.** Drizzle's raw `execute` returns timestamps as text, so the lease parser
  rejected every row: no message would ever have reached a plugin. Same for the sweep's backlog aggregate
  (it would have thrown every minute). Both now decode through the driver's own parser / `mapWith`; the
  ingress lookup also joins `instances` so a destroyed bot's number routes nowhere.
- Escalation reservations are identity tokens in one array per bot, so a failed Telegram delivery under
  load frees exactly its own slot (the filtered-copy version left the bot capped for a minute).
- Destroy cleanup takes the same per-bot lock as connect, so a connect racing a destroy cannot leave the
  number registered at Meta with no channel to deregister it.
- Dispatcher: a `wait()` after `stop()` resolves at once (shutdown no longer waits on a fresh long-poll);
  the lease clock is taken before the query, never after a slow one.
- Media downloads clean up their idle timer and abort listener on consumer cancel and on the byte cap.
- Plugin: the turn logic lives in `inbound-turn.js` with the dispatcher injected, so `handleInbound` is
  tested end to end (redelivery flushes without a turn, 5xx holds the row, 4xx drops the reply, human-mode
  forward / fallback / throttle); a reply quotes only the customer's own message (a model-invented
  `reply_to` would be a Meta 400); `deliver` never throws, the post-dispatch check fails the turn; `stop()`
  waits at most 5 s for a running turn (the late ack still lands).
- Web: a relaunch of the Meta popup inside the 5 s ids grace no longer loses its ids to the old timer.
- Infra: `set_runtime_env` writes values through awk's `ENVIRON`, so a connection string with `&`, `|` or
  `\` lands byte for byte (`infra/ops/test-set-runtime-env.sh` proves it); an empty secret fetch never
  blanks the previous value.
- Accepted as is: the listener reconnect test uses real one-second timers; the 6-digit PIN redaction can
  also redact an unrelated 6-digit run in gateway prose (harmless, PII-safe).

Sixth change 2026-09-10 (simplification after checking production): the separate `DATABASE_LISTEN_URL` and its GSM
secret are gone. The listener uses the orchestrator's own `DATABASE_URL`, which in production is Supabase's session
pooler on 5432 (checked on the live VM). A probe through that pooler delivered a NOTIFY between two connections in
67 ms; the same probe through the transaction pooler (6543) delivered nothing, so `canListenOn` refuses exactly that
host and port. The listener's connect times out after 10 s and a client that cannot be created is retried like any
failed connect, so neither can hang start-up; start-up no longer waits for the listener at all.

## 15. Rehearsal checklist (before any tenant sees it)

Run on the built `openclaw-browser` image with Meta's test number, in this order; each line is a thing
the code assumes and the SDK typings could not prove.

1. `openclaw plugins list --json` shows `agentforall-whatsapp-cloud` loaded; `channels status --probe
   --json` lists `whatsapp_cloud` with `linked:true, connected:true` once the relay answers, and
   `/readyz` is 200. If the account shows `not configured`, the `.env` token or `accounts.default`
   block is not reaching `resolveAccount`.
2. Send a text from a test recipient: the ingress row lands (`whatsapp_cloud_inbox`), the plugin acks
   it, the agent answers through `POST /send`, the customer sees the reply quoted to their message.
   Confirms `dispatchInboundDirectDmWithRuntime` params (`inboundAccessAuthorized`, `peer`, `deliver`).
3. From the owner's Telegram: "מה שאלו היום?" reads the customer session (`sessions_history`), and a
   reply via `whatsapp_cloud_reply` lands (`toolsBySender` owner key resolves; empty `{}` policy is
   unrestricted). From a customer: `whatsapp_cloud_handoff` and `whatsapp_cloud_reply` are absent,
   `whatsapp_cloud_escalate` is present and the owner receives a plain Telegram message from the
   tenant's bot (three lines, no agent turn on the owner's side).
4. Handoff: owner sets `human`, the next customer message reaches the owner and the bot stays silent;
   `bot` restores replies.
5. Kill the orchestrator for a minute mid-conversation: the plugin backs off and resumes, nothing is
   lost, the row is redelivered once and deduped.
6. Disconnect from the dashboard: `channels.whatsapp_cloud` and the plugin entry vanish from the live
   config (one restart for the `.env` change); a later webhook for that number is a 200 with
   `unknownNumbers:1`.
7. Memory: `group:memory` is denied to customers. Confirm memory-core's automatic recall still
   injects the owner's taught knowledge into customer turns; if recall is tool-driven, allow the read
   tools back and keep only the writes denied.
8. From a customer: ask the bot to open a web page or generate an image — both tools must be absent
   (`group:ui`, `group:media`). Ask for a 5,000-character answer: it arrives as two messages.
9. Owner writes to the business number from their own phone: `whatsapp_cloud_reply` is available in that
   session (`channel:whatsapp_cloud:+E164` matched).
10. Disconnect, then connect the same number again: `register` succeeds with the retained PIN. Then
    register the number on a second app with a different PIN and connect again: the dashboard asks for
    the PIN (Meta `133005`), and the entered one works.
11. Escalate twice within a minute from the same customer: the owner gets one Telegram message and the
    model is told the owner already knows. From the owner's Telegram, confirm the message arrived from the
    tenant's own bot, verbatim, and that nothing ran in the agent (no new session, no tool calls).
12. Revoke the token in Meta Business, wait for the next customer message: the owner gets the "reconnect"
    notice once, the dashboard shows the connect button with the expiry text, and connecting the same
    number again replaces the token (`whatsapp_cloud.reconnected`) and the bot answers again.
13. Send a message and read the orchestrator log: the tick runs at once on `NOTIFY` (a `wake` before the
    next 500 ms boundary), and the plugin sees the row within ~100 ms of the Vercel 200.
14. Kill the listener connection (restart the pooler or revoke the session): the warn "listener dropped"
    appears, delivery continues on the poll, and "listener connected" returns within 30 s.
15. Start a gateway whose volume lacks the plugin: it boots with the stale-entry warning only, and the
    other channels work.
16. With `WHATSAPP_CLOUD_ENABLED` unset on Vercel the dashboard shows no WhatsApp Business row and
    `/app/bot/whatsapp-business` says the channel is unavailable, while the webhook handshake succeeds.
17. In the browser console during the popup: no CSP report for `staticxx.facebook.com` or
    `www.facebook.com` frames, and the `code` callback fires (the FB SDK relays it through its hidden
    iframe, which `frame-src` now allows).
18. Kill the relay (stop the orchestrator) after the model answered but before the send: on restart the
    customer gets the reply once, and the orchestrator log shows no second model turn for that wamid.

## 16. Plain-language Q&A (2026-09-10)

Answers given to the founder while reviewing; kept here so the reasoning is not lost.

- **Is the queue a hack instead of a message broker?** No. A Postgres table with `SKIP LOCKED` leases is
  the standard pattern (Rails 8 Solid Queue default, pg-boss, Graphile Worker, River, Oban; Basecamp/HEY run
  millions of jobs a day on it). Our peak is a few messages per second, orders of magnitude below where it
  stops fitting. A broker (Pub/Sub, SQS, NATS) would add a component, a second secret path and a second
  at-least-once model, and we would still need the Postgres row for Meta's `wamid` dedupe.
- **Is there a library?** pg-boss and Graphile Worker are the Node ones. Not used: neither can express
  "hand a message out only when that bot's plugin is waiting on this VM", which is what stops a dead
  container from burning retries. Our queue is ~200 tested lines in the repository.
- **Is the plugin busy-waiting?** No. It is HTTP long polling (Telegram `getUpdates`, GitHub Actions
  runners, SQS, Temporal all do this): one request held open up to 25 s, the process idles, the next
  request follows the answer. Each bot with a business number keeps exactly one such request open.
- **Does the orchestrator poll?** The `NOTIFY` wakes it in milliseconds; the 500 ms poll (one partial-index
  query, only while a plugin is waiting) stays as the safety net for a dropped listener connection.
  Postgres delivers a notification only to connections listening at that instant, which is why every
  library keeps both.
- **What is the inbox listener?** One extra Postgres connection per orchestrator, on the
  orchestrator's own `DATABASE_URL`, that does nothing but `LISTEN whatsapp_cloud_inbox`. When a notification
  arrives with a bot id, it wakes that bot's tick if its plugin is waiting and ignores it otherwise. If the
  connection drops it reconnects with 1–30 s backoff; while it is down the poll carries delivery. Nothing is
  ever lost because the rows are in the table either way.
- **What is the token bucket?** Meta allows 80 messages per second per phone number. The orchestrator
  keeps a small per-number counter that refills continuously at that rate; a send that finds it empty gets
  429 from us instead of a `130429` from Meta and a possible quality-rating hit. Idle numbers are forgotten.
- **Who notifies?** Postgres itself: the ingress insert ends with `NOTIFY` carrying the bot id; every
  orchestrator `LISTEN`s and acts only on bots whose plugin is waiting on it. Many orchestrators = one
  listening connection each; if that ever grows to dozens, switch to a per-VM channel (one line each side).
- **Cost on Supabase?** Charged by compute size, not per query; ~170k trivial index lookups a day is
  noise, and zero when no business number is connected. Memory/CPU on both sides: one idle socket, a
  sub-millisecond query.
- **What changes in the database?** In the same unapplied migration: a partial index on pending inbox rows
  only (`WHERE acked_at IS NULL AND dropped_at IS NULL` — the lease query never looks at anything else, so
  the index stays tiny and cached), autovacuum tuned for the churny inbox table (rows are inserted, updated
  on lease and ack, deleted later; Postgres leaves old versions behind, and the default cleaner waits for
  20% of the table to be dead — 2% here), and dedupe retention raised to 8 days because Meta retries for 7,
  not 36 h. Nothing manual in the Supabase dashboard; `drizzle-kit migrate` applies it.
- **Pooler vs direct connection?** Supabase offers the pooler in transaction mode (port 6543, a connection
  lent per transaction, no `LISTEN`), the pooler in session mode (port 5432, the connection stays yours) and a
  direct connection. The orchestrator already uses session mode on 5432 (checked on the live VM 2026-09-10),
  so the listener can reuse its connection string and no second secret is needed. Since 2026-09-10 that is the default:
  the listener uses `DATABASE_URL` and refuses only the transaction pooler.
- **What is an escalation?** The bot handing a customer to the human owner: the customer session's only
  tool posts to the relay, the orchestrator sends the owner a plain Telegram message from the tenant's own
  bot. No agent turn on the owner's side.
- **How does the bot stop and resume answering one customer?** A `mode` flag (`bot`/`human`) per customer
  in `whatsapp_cloud_conversations`. The plugin checks it before every turn; `human` forwards the text to
  the owner and skips the agent. Owner tools flip it; the flag lives in the orchestrator's DB, not the
  container.
- **Multi-VM?** Works as built: the ingress writes to shared Postgres; each orchestrator leases only for
  bots long-polling it; `SKIP LOCKED` covers two orchestrators racing.
- **Vercel cost for the ingress?** Verify + one insert per POST, Meta batches; roughly $1–2 per million
  messages. Portable to Cloud Run: the route is an HTTP shell over `ingress.ts`/`repository.ts`, keep
  raw-body reading.
- **Do we have an OAuth flow with Meta?** Yes, Embedded Signup: the popup returns a 30-second code, the web
  server trades it with the app secret for a token scoped to the client's WABA, the orchestrator stores it
  encrypted. No "log in with Facebook" for our users; business verification and app review come first.
- **Which webhook?** The URL Meta calls for every customer message,
  `https://agentforall.co.il/api/webhooks/whatsapp-cloud`, set once in the Meta app with a verify token that
  matches Vercel's `META_WEBHOOK_VERIFY_TOKEN`, subscribed to `messages` only.
- **What are conversations and sends?** Conversations: one row per customer (last inbound for the 24h rule,
  bot or human mode, profile name), deleted after 30 idle days unless in human mode. Sends: an audit row per
  outgoing message, deleted after 90 days.
- **Why does a database need connections, and what is a pooler?** A connection keeps state (a transaction,
  locks, a `LISTEN`) and costs a server process, so Postgres allows few and programs reuse them. A pooler lets
  many callers share a few real connections; transaction mode lends one per transaction, session mode keeps it.
- **Why was a second secret asked for?** It was assumed production used transaction mode; it was not checked.
  It uses session mode, so the existing connection string is enough.
- **Who handles races between two connections?** Postgres: row locks (`SKIP LOCKED`), unique indexes (`wamid`,
  the number binding) and transactions, the same in every connection mode.
- **What is the Caddy rule?** Caddy is the VM's front door. `@wacloud path /api/v1/whatsapp-cloud/*` +
  `respond @wacloud 404` keeps the container-only relay unreachable from the internet (bearer auth still applies).
- **Can we deploy to a test environment?** There is none (one VM, one Supabase, one Vercel project), so the
  feature went to production dark on 2026-09-10 with `WHATSAPP_CLOUD_ENABLED` off until the rehearsal passes.
