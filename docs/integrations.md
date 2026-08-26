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
| Manager | `services/integrations/manager.ts` | Ownership, catalog cache, connect/disconnect, relay auth |
| Relay | `routes/mcp-relay.ts` | `ALL /api/v1/mcp/:instanceId`, bearer-gated, streams MCP to the provider |
| Routes | `routes/integrations.ts` | Catalog, list, connect link, disconnect |
| Config rendering | `agent-runtime/openclaw/config.ts` `buildMcp` | `mcp.servers.agentforall` from `InstanceConfig.integrations` |
| Web | `lib/integrations/*`, `app/bot/connections/*` | Connectors page, return-URL construction, polling after OAuth |

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

1. Dashboard `/app/bot/connections` renders the catalog (`GET /api/integrations/catalog`, cached 1h in the
   orchestrator, served stale on provider errors) and the bot's connections.
2. **התחבר** → `POST /api/bot/:id/integrations/:app/connect` → orchestrator `connect`: ensure session
   (lazy — first connect creates it), bind the relay (`updateConfig` hot-applies `mcp.servers.agentforall`),
   create the hosted connect link. Browser navigates to it.
3. Provider redirects back to `/app/bot/connections?connected=<app>`; the page polls the list until that app
   is `active` (≤90s), shows a toast, and drops the query from history.
4. **ניתוק** → `DELETE /api/bot/:id/integrations/:ref` (ref must appear in the bot's own list).
5. Bot delete → `IntegrationSessions.revokeAll` (best-effort per step) before the container is removed.

If the provider forgets a session (404 on link creation) `connect` recreates it once. The relay passes
upstream 404 through so OpenClaw re-initializes its MCP session.

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

`apps/orchestrator/test/{composio-client,composio-adapter,integrations-manager,mcp-relay,crypto-config,instance-sanitize}.test.ts`
plus additions to the config-merge, adapter-redaction, channel-patch and destroy suites; `packages/db/test/migrations.test.ts`;
`apps/web/test/integrations/*`. The relay test runs real sockets (upstream `http.Server`, SSE streaming, client abort).

## Not yet built

Connection-expiry webhook (reconcile-on-read covers correctness), relay-token rotation, our own Google OAuth
app (brand on the consent screen; needs Google verification and CASA for Gmail read), a connections cache table.
