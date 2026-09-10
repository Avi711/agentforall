# Integrations

One-click third-party app connections (Gmail, Google Calendar, Notion, Slack, …) for every bot. The
provider (Composio in v1) owns the OAuth apps and tokens; the orchestrator owns the session per bot and a
relay that keeps the provider's project key out of tenant containers. Code lives in
`apps/orchestrator/src/services/integrations/` and `apps/web/src/lib/integrations/`.

## Shape

```
dashboard ──/api/bot/:id/integrations/*──▶ web IntegrationsService ──▶ orchestrator routes/integrations.ts
                                                                         │ IntegrationsManager ──▶ IntegrationProvider (composio | mock)
                                                                         │       └─ IntegrationSessions ──▶ IntegrationSessionRepository
                                                                         └ InstanceManager.updateConfig({integrations}) ──▶ OpenClaw mcp.servers.agentforall
container ──Bearer relayToken──▶ routes/mcp-relay.ts ──x-api-key──▶ provider MCP endpoint (streamed both ways)
```

| Piece | File | Job |
|---|---|---|
| Port | `services/integrations/provider.ts` | What the platform needs from any vendor; domain types only |
| Composio adapter | `services/integrations/composio/{client,adapter}.ts` | REST v3.1 Tool Router sessions, zod-validated, retries on idempotent calls |
| Mock adapter | `services/integrations/mock/adapter.ts` | Dev/test; OAuth is a redirect straight back to the callback |
| Registry | `services/integrations/registry.ts` | `INTEGRATIONS_PROVIDER` → adapter, or `null` (feature off) |
| Sessions | `services/integrations/sessions.ts` | One provider session per bot; `revokeAll` on destroy |
| Manager | `services/integrations/manager.ts` | Ownership, catalog cache, stale-attempt prune, connect/disconnect, relay auth |
| Catalog search | `services/integrations/catalog-search.ts` | Pure slug lookup / name search over the cached catalog |
| Relay | `routes/mcp-relay.ts` | `ALL /api/v1/mcp/:instanceId`, bearer-gated, streams MCP to the provider |
| Routes | `routes/integrations.ts` | Catalog, list, connect link, disconnect |
| Config rendering | `agent-runtime/openclaw/config.ts` `buildMcp` | `mcp.servers.agentforall` from `InstanceConfig.integrations` |
| Web | `lib/integrations/*`, `app/bot/connections/*` | Connectors page, return-URL construction, live refresh, tile state (`connections.ts`) |

## Security model

- The provider's project API key authenticates *every* session's MCP endpoint. A container holding it could
  reach every tenant's connected accounts, so it lives only in the orchestrator (`COMPOSIO_API_KEY`).
- Each bot gets a random 32-byte **relay token** in `InstanceConfig.integrations` (encrypted at rest,
  redacted from logs and from `sanitizeInstance`). OpenClaw sends it as `Authorization: Bearer` to
  `http://orchestrator:3000/api/v1/mcp/<instanceId>`; the relay compares it in constant time, then forwards
  with the provider key. Provider `user_id` = instance id, so a bot can only ever see its own accounts.
- Caddy answers 404 for `/api/v1/mcp/*`; the relay is reachable only from `tenant-net`.
- Return URLs must be on `DASHBOARD_ORIGIN`; the web builds them server-side.
- The agent may hand out connect links in chat (`manage_connections.enable`) but cannot remove
  connections (`enable_connection_removal: false`); removal is a dashboard action.

## Data model (`packages/db/src/schema/integrations.ts`)

- `integration_sessions` — one row per bot: provider, provider session id, encrypted upstream MCP URL.
  Exists so destroy can revoke every connection and the session. Connections themselves are read from
  the provider on demand (no cache table in v1).

## Flow

1. Dashboard `/app/bot/connections` renders one list, composed by `IntegrationsService.overview`: the apps
   this bot is connected to, then the curated ones (`catalog.he.ts` — the only Hebrew copy we own), then the
   catalog. The full catalog (~1,400 apps, ~440 KB) never leaves the orchestrator: it is cached there for 1h
   (served stale on provider errors) and queried server-side via
   `GET /integrations/catalog?q=&slugs=&limit=&offset=` (`catalog-search.ts`), which answers
   `{ data, total }`. Search and browse are the same paged query — an empty `q` is the whole catalog — so
   "עוד אפליקציות" pages through it and the search box (debounced) narrows the same list. Provider names are
   English, so a Hebrew query is also matched against the curated copy client-side (`searchFeatured`) and
   those hits are hoisted; provider descriptions are never rendered. Older orchestrators omit `total`; the
   web client falls back to the page length, so deploy the orchestrator first if you want paging on the
   first render. The page header names the bot: connections belong to one bot, and a user with several
   accounts can otherwise mistake one bot's list for another's.
2. **התחבר** → `POST /api/bot/:id/integrations/:app/connect` → orchestrator `connect`: ensure session
   (lazy — first connect creates it), bind the relay (`updateConfig` hot-applies `mcp.servers.agentforall`),
   create the hosted connect link. Browser navigates to it.
3. Provider redirects back to `/app/bot/connections?connected=<app>`; `useLiveConnections` polls the list
   until that app is `active` (≤90s), shows a toast, and drops the query from history. Links handed out by the
   bot in chat land on the bare page instead, so the hook also refreshes on `visibilitychange` (which
   browsers fire on bfcache restores too) and polls (5s, ≤90s) while any connection is `pending`. The watched
   app is latched in state and cleared once an outcome is reported, so a later disconnect cannot re-arm it. The list is newest-first; a tile reflects the best
   account for its app (active → pending → newest).
   Before a new link is created for an app, that app's `expired`/`failed` accounts are revoked (best-effort):
   Composio expires abandoned consent flows after 10 minutes, and they would otherwise accumulate forever.
   Because an abandoned flow and a dead token both surface as `expired`, the tile shows it as neutral
   ("פג תוקף"); only `failed`/`inactive` are flagged red.
   **Several accounts per app** (e.g. work and personal Gmail): sessions are created with Composio's
   `multi_account` on, capped at `INTEGRATION_MAX_ACCOUNTS_PER_APP` (3). Connect takes an optional `label`,
   sent as the Composio `alias`; `PATCH /instances/:id/integrations/:ref` renames one. Labels are compared
   NFC, trimmed and case-insensitively, with direction marks stripped at the route. Before a link is made,
   a connect replaces that app's non-active attempts under the same label (so a retry after an abandoned
   consent never hits the cap or its own name) and sweeps unnamed expired/failed ones; it then refuses
   `ACCOUNT_LIMIT_REACHED` or `ACCOUNT_LABEL_TAKEN` (both 409). An unnamed connect therefore also replaces an
   unnamed pending attempt, including one started from a chat link. If a replaced attempt cannot be revoked,
   the connect fails as upstream-unavailable rather than blaming the owner's name or cap; a Composio 409 on
   an alias maps to `ACCOUNT_LABEL_TAKEN`. Adding to an app that already has an account first PATCHes the
   session's `multi_account` block, which upgrades sessions created before this lazily.
   `require_explicit_selection` is on: once an app has two live accounts the agent must pass `account` (alias
   or id) on every call, so it asks rather than silently sending from the newest account. With one live
   account nothing changes.
   The dashboard keeps the one-account tile as it was plus a quiet "חשבון נוסף" link; an app shows its
   accounts as rows only once it has two. Adding a second account also asks to name the first. Every account
   the cap counts is shown (only unnamed expired/failed ones, which the next connect sweeps, are hidden).
   **Deploy the orchestrator before the web**: an older orchestrator rejects `label` (strict body) and has no
   rename route.
4. **ניתוק** → `DELETE /api/bot/:id/integrations/:ref` (ref must appear in the bot's own list).
5. Bot delete → `IntegrationSessions.revokeAll` (best-effort per step) before the container is removed.

If the provider forgets a session (404 on link creation) `connect` recreates it once. The relay passes
upstream 404 through so OpenClaw re-initializes its MCP session.

OpenClaw 2026.7.1 wires new `mcp.servers` entries only at gateway startup (the config-apply RPC accepts
them but the running gateway ignores them), so the first connect on a bot triggers a detached container
restart — it completes while the user is on the provider's consent page. Later connects don't restart.

## Environment

Orchestrator: `INTEGRATIONS_PROVIDER` (`composio` | `mock` | unset), `COMPOSIO_API_KEY`, `COMPOSIO_BASE_URL`,
`DASHBOARD_ORIGIN`. `mock` is refused in production; `composio` without a key fails startup.
Prod: GSM secret `composio-api-key` (operator-created), read by `infra/startup.sh`.
Local: the orchestrator runs on the host, so set `ORCHESTRATOR_INTERNAL_URL=http://host.docker.internal:3000`
or containers cannot reach the relay.

Composio project settings: keep `require_mcp_api_key: true`; scope the project key to Sessions,
Connected accounts and Toolkits only.

## Adding a provider

1. `packages/db/src/schema/integrations.ts`: add the name to `INTEGRATION_PROVIDERS` (TS-only, no migration).
2. `services/integrations/<name>/adapter.ts`: implement `IntegrationProvider`; map statuses to the domain
   vocabulary; throw `SessionGoneError` when the upstream session is gone; return the headers the relay must add.
3. `services/integrations/registry.ts`: one case in the switch.
4. `config.ts` + `.env.example`: the provider's credentials.

Nothing in the manager, relay, routes, UI, or tests changes.

## Tests

`apps/orchestrator/test/{composio-client,composio-adapter,integrations-manager,catalog-search,mcp-relay,crypto-config,instance-sanitize}.test.ts`
plus additions to the config-merge, adapter-redaction, channel-patch and destroy suites; `packages/db/test/migrations.test.ts`;
`apps/web/test/integrations/*`. The relay test runs real sockets (upstream `http.Server`, SSE streaming, client abort).

## Not yet built

Connection-expiry webhook (reconcile-on-read covers correctness), relay-token rotation, our own Google OAuth
app (brand on the consent screen; needs Google verification and CASA for Gmail read), a connections cache table.
