# Billing

Subscriptions in three tiers plus credit top-ups. Provider-agnostic core, one adapter per gateway, a mock gateway for local development. Everything lives in `apps/web/src/lib/billing/`.

## Shape

```
route (HTTP) ──▶ BillingService ──▶ repositories (Drizzle)
                      │
                      └─▶ PaymentProvider (port) ◀── MockPaymentProvider | <israeli-provider>
```

| Piece | File | Job |
|---|---|---|
| Port | `provider/types.ts` | The only surface an adapter implements. |
| Registry | `provider/registry.ts` | `PAYMENT_PROVIDER` picks the adapter for new checkouts; every configured adapter stays addressable so old subscriptions keep working after a switch. |
| Service | `service.ts` | Checkout, webhook ingestion, cancel/resume, entitlement. No Drizzle, no HTTP. |
| Entitlement | `entitlement.ts` | Pure: subscription state + grace windows + `betaAccess` + `BILLING_REQUIRED` → `{ entitled, reason }`. |
| Repositories | `repository.ts` | Only Drizzle here. Ports in `ports.ts`. |
| Mock gateway | `providers/mock/` | Hosted-page stand-in: redirect → local page → signed callback into the real webhook route. Refused in production. |

## Data model (`packages/db/src/schema/billing.ts`)

- `billing_checkout_sessions` — our correlation key. Its id is sent to the provider as custom data and echoed on callbacks; that is how a callback finds the user without trusting anything else in the body. Account deletion waits while one is pending (`checkout_pending`).
- `billing_subscriptions` — normalized state. `user_id` is `set null` on account deletion so the financial record survives.
- `billing_payments` — one row per applied charge, unique per provider payment id. Renewal extension happens only when a payment is newly recorded, so redelivered callbacks cannot extend twice. This is also where invoice generation will hook in.
- `billing_credit_grants`, `billing_credit_usage` — the credit ledger (below).
- `billing_events` — webhook inbox. Unique `(provider, provider_event_id)`; `failed` rows and rows abandoned in `received` for 10 minutes are handed to exactly one retrying delivery, up to `MAX_EVENT_ATTEMPTS`, after which the event is acknowledged so a poison message cannot loop.
- `billing_trial_claims` — one row per mailbox (hash of the folded email: case, `+tag`, Gmail dots) that ever received a trial. `set null` on deletion, so deleting and re-registering never earns a second trial.

## Event model

Israeli gateways (PayPlus, Grow, HYP) are charge-driven: you get a callback per charge, not a subscription snapshot. The port therefore speaks in charges and the service derives state:

| Provider event | Service effect |
|---|---|
| `payment.succeeded` | First one creates the subscription (`active`, period end = provider's date or `now + interval`). Later ones extend from `max(currentPeriodEnd, paidAt)`. |
| `payment.failed` | `past_due`; access continues for `PAST_DUE_GRACE_MS` (7 days). |
| `subscription.canceled` | `canceled`, access until `currentPeriodEnd`. |
| `checkout.failed` | Session marked failed, nothing else. |
| `subscription.snapshot` | For providers that own the lifecycle (Stripe-like): upsert if newer than what we hold. |

A `payment.succeeded` that cannot be applied — no session and no known subscription (`unresolved_user`), a one-time charge with no top-up session (`missing_subscription`), a plan code we don't sell (`unknown_plan`), an amount below the session's or, for a renewal, below what that order last paid (the catalogue price only if it never paid) or not in ILS (`amount_mismatch`) — writes **nothing**: the event row keeps the payload, is stored `failed` with that note, and the route answers 5xx so the provider redelivers. A later delivery that *can* resolve it (the creation callback arriving after a renewal) processes normally and extends the period in full. Failure events and cancellations older than the stored `provider_updated_at` are acknowledged with `stale_event`; an older *charge* still adds its month (money counts) but never revives a newer cancellation. Payment + subscription writes are one transaction (`recordFirstPayment` / `recordRenewal`); a renewal that loses a period race re-reads and retries. A first payment that lands while an older standing order is still live cancels that order at the provider (best-effort, logged), so a lapsed-then-renewed card never bills twice.

`active` with a `currentPeriodEnd` more than `ACTIVE_GRACE_MS` (3 days) in the past is treated as lapsed — charge-driven providers never send "expired".

## Credits

Users never see dollars. Every commercial number is in `pricing.ts` — nothing else hard-codes a price, rate, or allowance.

| Constant | Value | Meaning |
|---|---|---|
| `USD_CENTS_PER_CREDIT` | 0.5 | 1 credit = $0.005 of LiteLLM spend (a message ≈ 1–4 credits) |
| `AGOROT_PER_CREDIT` | 5 | ₪1 = 20 credits on a top-up |
| `SUBSCRIPTION_TIERS` | בסיסי ₪100 → 1,000 · סטנדרט ₪200 → 2,500 · פרו ₪400 → 6,000 | credits per paid period; expire with the period (+3-day grace) |
| `TRIAL_CREDITS` / `TRIAL_DAYS` | 400 / 7 | first bot of a brand-new user; no card |
| `TOPUP_MIN_ILS` / `TOPUP_MAX_ILS` / `TOPUP_PRESETS_ILS` | ₪20 / ₪500 / ₪50·₪100·₪200 | any whole amount in range; credits never expire, spent last |

**Ledger** (`credits/`): `billing_credit_grants` holds every allowance (trial / plan / top-up) with an idempotent `source_ref`; `billing_credit_usage` is a per-bot cursor into the gateway's cumulative spend. `CreditService.sync` reads spend via the orchestrator, converts the delta to credits, attributes it to grants that were live *at the previous sync* soonest-expiring-first (`allocation.ts`), persists cursor + attributions in one transaction guarded by the cursor version **and** by `used_credits + x <= credits` on every grant (a lost race writes nothing and retries), then pushes the bot's LiteLLM `max_budget` to `spend + available`. Spend going backwards is the only "counter restarted" signal — it covers a re-issued key; gateway-side resets are off (`LITELLM_DEFAULT_BUDGET_DURATION=`), and the orchestrator never resends `budget_duration` on a budget update because LiteLLM would rewrite `budget_reset_at`. A user with **no grants at all** (bots created before billing) is never read or capped — the gateway's own default budget applies until they subscribe.

**When sync runs:** on every subscription/top-up payment (best-effort — the ledger is already durable, so a gateway outage never makes the provider redeliver money), before/after bot creation (`BotService` → `BotLifecycleHooks`: the trial grant lands *before* the container exists), **before bot deletion** (`beforeBotDelete` → `settleBot` charges everything spent since the last sync; if the gateway cannot be read the deletion is refused, otherwise delete-and-recreate would reset the cap for free), on dashboard/settings page loads (`refreshStatus`, falling back to the ledger with `credits.stale=true` if the gateway is down), and daily via Vercel Cron (`/api/billing/cron/sync`, `CRON_SECRET`) over every user with a credit history, least recently synced first, so expired allowances are re-capped without a webhook.

**Trial:** `computeEntitlement` treats a user with no grants as `trial_available` (may create the bot), an unexpired trial grant as `trial`, anything else as used — after `BillingService` has checked `billing_trial_claims`: a mailbox that already claimed a trial under another account, deleted or not, reads as used. `beforeBotCreate` grants a trial only to a user who is *not* entitled without one: paid, beta, and enforcement-off users get no grant, so they stay on the gateway's default budget and are never capped to zero while still entitled. The claim is written before the grant and its result is honoured, so two alias accounts racing get one trial between them; a refused claim fails closed with `402 payment_required`.

**Over-consumption** (spend landing after the ceiling went stale) is recorded as `unallocated` and logged, never hidden.

**Bot statuses:** `destroying`, `destroyed`, and `error` bots are skipped by sync and by the delete-time settlement — the orchestrator revokes the key before removing the container, so an `error` bot has no key left to read and would otherwise block its own deletion forever.

**Changing tier** (`POST /api/billing/change-plan`): Israeli standing orders cannot be re-priced, so the current subscription is cancelled at its period end and a new checkout opens for the new tier. The new tier's first payment becomes the current subscription; remaining credits from the old tier stay usable until they expire.

**Landing page:** `components/Pricing.tsx` is mounted on the landing page (`#pricing`, between Comparison and the lead form) with a "מחירים" nav link. Every public price mention — layout metadata, terms, Comparison, Footer, LeadForm, FAQ, `site.ts` `PRICE_ILS_MONTHLY` — derives from `pricing.ts`, so a tier change never leaves stale copy. Pricing CTAs and the navbar's "האזור האישי" link go to `/app`, which sends a signed-out visitor to login and a signed-in one to the dashboard, keeping the landing static.

## Flow

1. `POST /api/billing/checkout` → session row → `provider.createCheckout` → `{ url }`; client redirects.
2. Provider redirects back to `/app/settings?checkout=success|failed&session=<id>`; the settings card polls `GET /api/billing/checkout/<id>` until the session settles (90s cap), then re-renders the page, and drops the query from the URL so a reload does not replay it.
3. Provider calls `POST /api/billing/webhooks/<provider>`. The adapter's `parseWebhook` must establish authenticity (signature or re-query) before the service touches anything. `4xx` = rejected, `500` = retry later.
4. `BILLING_REQUIRED=true` makes `POST /api/bot`, `import-url`, `import-complete` return `402 payment_required` unless entitled. Existing bots are never stopped by billing.
5. Account deletion cancels every live subscription at the provider first; a provider failure — or a checkout still pending — aborts the deletion. An unconfigured provider is cancelled locally so erasure never blocks on config.

## Adding the Israeli provider

1. `packages/db/src/schema/billing.ts`: add the name to `PAYMENT_PROVIDERS` (TS-only enum, no migration).
2. `providers/<name>/config.ts`: read env, throw `BillingUnavailableError` listing what is missing.
3. `providers/<name>/adapter.ts`: implement `PaymentProvider`. `parseWebhook` verifies (e.g. PayPlus: re-query `PaymentPages/ipn` by `transaction_uid`; never trust the posted body) and maps to `ProviderEvent`. Set `capabilities` honestly — the UI hides what the gateway cannot do.
4. `provider/registry.ts`: one line in `FACTORIES`.
5. `.env.example`: document the variables. Set `PAYMENT_PROVIDER=<name>` in Vercel.
6. Register the webhook URL `https://agentforall.co.il/api/billing/webhooks/<name>` at the provider.

Nothing in the service, routes, UI, or tests changes.

## Local development

```
PAYMENT_PROVIDER=mock
MOCK_PAYMENT_WEBHOOK_SECRET=<openssl rand -hex 32>
BILLING_REQUIRED=true
```

Apply migration `0010_billing`, then Settings → "הצטרפות למנוי" → mock page → "תשלום מוצלח". The mock signs a `checkout.completed` callback and pushes it through `BillingService.handleWebhook`, exactly the path a real gateway takes.

## Tests

`apps/web/test/billing/` — service (checkout, first payment, renewals, out-of-order and stale charges, redelivery, abandoned and poison events, failure/retry, amount and plan validation, top-ups, cancel/resume/plan change, second standing orders, trial claims, bot-delete settlement, account deletion), credits (attribution, races, restarts, expiry, ledger-less users, cron), allocation, entitlement, pricing conversions, schemas, mock adapter + HMAC, registry, trial-claim keys; `test/auth/` — cron authorization. Run with `npm run -w @agent-forall/web test`. The Drizzle repositories have a Postgres integration test in `apps/web/test-integration/`:

```
docker run -d --name af-billing-it -e POSTGRES_PASSWORD=it -e POSTGRES_DB=billing_it -p 55432:5432 postgres:16-alpine
DATABASE_URL=postgresql://postgres:it@localhost:55432/billing_it npm run -w @agent-forall/db db:migrate
BILLING_TEST_DATABASE_URL=postgresql://postgres:it@localhost:55432/billing_it npm run -w @agent-forall/web test:integration
```

## Not yet built

- Tax invoices (חשבונית מס) — required with an Israeli gateway; hook on `billing_payments`.
- Admin view of subscriptions and credits.
- Dunning emails on `past_due`; a "credits exhausted" reply from the bot instead of silence.
- Trial containers are not auto-destroyed when the trial lapses (VM capacity).
- Ceiling policy for a user with several bots: each bot is capped at `spend + all available credits`, so N bots could spend N× between syncs. Moot while `maxInstancesPerUser=1`; split the balance before raising that.
