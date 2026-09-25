# Billing

Subscriptions in three tiers, monthly or yearly, plus credit top-ups. Provider-agnostic core, one adapter per gateway, a mock gateway for local development. Everything lives in `apps/web/src/lib/billing/`.

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
- `billing_events` — webhook inbox. Unique `(provider, provider_event_id)`; `failed` rows and rows abandoned in `received` for 10 minutes are handed to exactly one retrying delivery, up to `MAX_EVENT_ATTEMPTS`, after which the event is acknowledged so a poison message cannot loop. A redelivery that arrives while the first attempt is still `received` answers `409`, so the provider keeps retrying instead of taking it as done.
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
| `payment.refunded` | Full refund or chargeback: payment marked `refunded`, unspent credits of that charge's grant revoked (spent ones stay spent), bots re-capped. Partial refunds are noted `partial_refund` and left to a human. A refund for a charge we have not applied yet fails `unknown_payment` and is retried until it has. |

A `payment.succeeded` that cannot be applied — no session and no known subscription (`unresolved_user`), a one-time charge with no top-up session (`missing_subscription`), a plan code we don't sell (`unknown_plan`), an amount below the session's or, for a renewal, below both what that order last paid and the catalogue price of the plan the charge names, or not in ILS (`amount_mismatch`) — writes **nothing**: the event row keeps the payload, is stored `failed` with that note, and the route answers 5xx so the provider redelivers. A later delivery that *can* resolve it (the creation callback arriving after a renewal) processes normally and extends the period in full. Failure events and cancellations older than the stored `provider_updated_at` are acknowledged with `stale_event`; an older *charge* still adds its interval (money counts) but never revives a newer cancellation. Payment + subscription writes are one transaction (`recordFirstPayment` / `recordRenewal`); a renewal that loses a period race re-reads and retries. Every subscription charge, after its credits are granted, keeps one continuing order per user — the newest — and cancels the older ones at the provider, whichever of charge and snapshot arrived first; a failure fails the event (`standing_order_not_ended`) and the redelivery retries it. Two checkouts paid at once therefore leave exactly one. A `past_due` order whose provider cannot end it (`capabilities.cancelWhilePastDue: false`, Paddle) is left to the provider's dunning; if it recovers, its own renewal ends it. While the **current** order is in that state no subscription checkout opens and no old one is payable (`payment_overdue`), and cancel / account deletion refuse before touching anything; the settings card offers only the payment-method update. Providers that can end a past-due order keep the plain subscribe path.

`active` with a `currentPeriodEnd` more than `ACTIVE_GRACE_MS` (3 days) in the past is treated as lapsed — charge-driven providers never send "expired".

## Credits

Users never see dollars. Every commercial number is in `pricing.ts` — nothing else hard-codes a price, rate, or allowance.

| Constant | Value | Meaning |
|---|---|---|
| `USD_CENTS_PER_CREDIT` | 0.5 | 1 credit = $0.005 of LiteLLM spend (a message ≈ 1–4 credits) |
| `CREDITS_PER_ILS` | 40 | ₪1 = 40 credits on a top-up |
| `TIERS` | בסיסי ₪100 → 2,500 · סטנדרט ₪200 → 6,500 · פרו ₪400 → 14,500 | monthly price and credits per tier; plan credits expire with the paid period (+3-day grace) |
| `YEARLY_DISCOUNT_PERCENT` | 10 | each tier also has a `<tier>_yearly` plan: 12 months up front at 10% off (₪1,080 / ₪2,160 / ₪4,320), the whole year's credits granted with the payment |
| `TRIAL_CREDITS` / `TRIAL_DAYS` | 400 / 7 | first bot of anyone not paying whose mailbox never had one; no card |
| `TOPUP_MIN_ILS` / `TOPUP_MAX_ILS` / `TOPUP_PRESETS_ILS` | ₪20 / ₪500 / ₪50·₪100·₪200 | any whole amount in range; credits never expire, spent last |

**Ledger** (`credits/`): `billing_credit_grants` holds every allowance (trial / plan / top-up) with an idempotent `source_ref`; `billing_credit_usage` is a per-bot cursor into the gateway's cumulative spend. `CreditService.sync` reads spend via the orchestrator, converts the delta to credits, attributes it to grants that were live *at the previous sync* soonest-expiring-first (`allocation.ts`), persists cursor + attributions in one transaction guarded by the cursor version **and** by `used_credits + x <= credits` on every grant (a lost race writes nothing and retries), then pushes the bot's LiteLLM `max_budget` to `spend + available`. Spend going backwards is the only "counter restarted" signal — it covers a re-issued key; gateway-side resets are off (`LITELLM_DEFAULT_BUDGET_DURATION=`), and the orchestrator never resends `budget_duration` on a budget update because LiteLLM would rewrite `budget_reset_at`. Every live bot is metered, whatever its owner holds: with no credits its cap is what it has already spent, so it stops. Pre-billing bots were moved onto the ledger on 2026-09-23: cursor started at their spend, remaining monthly budget granted as a top-up (`legacy:<userId>`), and their key reset pushed to `36500d` because LiteLLM 1.83.14 drops `budget_duration: null` on `/key/update`.

**When sync runs:** on every subscription/top-up payment (best-effort, after the webhook response via `after()` — the ledger is already durable, so a gateway outage never makes the provider redeliver money), before/after bot creation (`BotService` → `BotLifecycleHooks`: the trial grant lands *before* the container exists), **before bot deletion** (`beforeBotDelete` → `settleBot` charges everything spent since the last sync; if the gateway cannot be read the deletion is refused, otherwise delete-and-recreate would reset the cap for free), on dashboard/settings page loads (`refreshStatus`, falling back to the ledger with `credits.stale=true` if the gateway is down), and daily via Vercel Cron (`/api/billing/cron/sync`, `CRON_SECRET`) over everyone with credits, a cursor or a live bot, least recently synced first, so expired allowances are re-capped without a webhook.

**Trial:** `computeEntitlement` treats a user with no trial grant as `trial_available` (may create the bot), an unexpired trial grant as `trial`, an expired one as used — after `BillingService` has checked `billing_trial_claims`: a mailbox that already claimed a trial under another account, deleted or not, reads as used. Top-ups and plan credits never use up the trial. `beforeBotCreate` starts the trial on the first bot of anyone who is not paying (beta and enforcement-off included); a user entitled without it (beta) whose mailbox already had one gets a bot with no credits until an admin grants some. The claim is written before the grant and its result is honoured, so two alias accounts racing get one trial between them; a refused claim fails closed with `402 payment_required`.

**Admin grant:** `/admin` → user → Credits → Add credits (`POST /api/admin/credits`, idempotent per client `ref`, 404 for an unknown user) adds a never-expiring top-up to anyone and re-caps their bots at once.

**Over-consumption** (spend landing after the ceiling went stale) is recorded as `unallocated` and logged, never hidden.

**Bot statuses:** `destroying`, `destroyed`, and `error` bots are skipped by sync and by the delete-time settlement — the orchestrator revokes the key before removing the container, so an `error` bot has no key left to read and would otherwise block its own deletion forever.

**Changing tier** (`POST /api/billing/change-plan`): a new checkout opens for the new tier and the current order keeps running; the new order's first charge ends the old one at its period end (above), so an abandoned change costs nothing. It is refused, and an open change checkout stops being payable, in the 2 hours before the current order renews (`renewal_imminent`): Paddle refuses to end an order 30 minutes before its renewal, which would bill it once more. A renewal takes the plan its charged price names (Paddle's price tag), so a change made at the provider by support is followed. Remaining credits from the old tier stay usable until they expire. Monthly → yearly works the same way; a yearly plan is never changed in the app (`YearlyPlanChangeError`, the UI links to support) because the prepaid year would keep running under the new plan's charges.

**Pricing UI:** one set of components in `components/pricing/` (plan card, monthly/yearly switch, business band, trust points) and one copy file, `content/plans.he.ts`, serve the landing page (`components/Pricing.tsx`), the dashboard subscribe card and `/app/settings`. Settings shows a trial or subscription card, plans or top-up, and manage rows; trial users also get a trial bar above the bot card. Every price and number derives from `pricing.ts`; the credits pace ("at your pace, about N days") is `credits/runway.ts`, never a message count. Exceptions to update by hand: `public/llms.txt` and the blog posts under `src/content/blog/`.

## Flow

1. `POST /api/billing/checkout` → session row → `provider.createCheckout` → `{ url }`; client redirects.
2. Provider redirects back to `/app/settings?checkout=success|failed&session=<id>`; the settings card polls `GET /api/billing/checkout/<id>` until the session settles (90s cap), then re-renders the page, and drops the query from the URL so a reload does not replay it.
3. Provider calls `POST /api/billing/webhooks/<provider>`. The adapter's `parseWebhook` must establish authenticity (signature or re-query) before the service touches anything. `4xx` = rejected, `500` = retry later.
4. `BILLING_REQUIRED=true` makes `POST /api/bot`, `import-url`, `import-complete` return `402 payment_required` unless entitled. Existing bots are never stopped by billing.
5. Account deletion cancels every live subscription at the provider first; a provider failure, a checkout still pending, or an overdue order (`payment_overdue`) aborts the deletion with a Hebrew reason. An unconfigured provider is cancelled locally so erasure never blocks on config.

## Adding the Israeli provider

1. `packages/db/src/schema/billing.ts`: add the name to `PAYMENT_PROVIDERS` (TS-only enum, no migration).
2. `providers/<name>/config.ts`: read env, throw `BillingUnavailableError` listing what is missing.
3. `providers/<name>/adapter.ts`: implement `PaymentProvider`. `parseWebhook` verifies (e.g. PayPlus: re-query `PaymentPages/ipn` by `transaction_uid`; never trust the posted body) and maps to `ProviderEvent`. Set `capabilities` honestly — the UI hides what the gateway cannot do. `createCheckout` gets the billing `interval` (`month` / `year`, null for a top-up); the standing order must charge on that interval.
4. `provider/registry.ts`: one line in `FACTORIES`.
5. `.env.example`: document the variables. Set `PAYMENT_PROVIDER=<name>` in Vercel.
6. Register the webhook URL `https://agentforall.co.il/api/billing/webhooks/<name>` at the provider.

Nothing in the service, routes, UI, or tests changes.

## Paddle (`providers/paddle/`)

Merchant of record, lifecycle-owning. `PAYMENT_PROVIDER=paddle` plus the `PADDLE_*` variables in `.env.example`.

- **Catalogue:** `npm run -w @agent-forall/web paddle:catalog` creates one product per tier, one price per plan code (ILS, VAT included, monthly or yearly cycle) and the top-up product from `pricing.ts`, idempotently, and prints `PADDLE_PRICE_IDS` / `PADDLE_TOPUP_PRODUCT_ID`. Every price is pinned to quantity 1 (Paddle otherwise lets the buyer pick up to 100). A price that no longer matches `pricing.ts` is reported, never edited (prices are immutable once charged).
- **Checkout:** `createCheckout` creates a transaction (catalogue price, or a non-catalogue price on the top-up product) with `custom_data.checkout_session_id`, and sends the user to `/pay?session=…`, which opens the Paddle.js overlay (`@paddle/paddle-js`). Set `https://<app>/pay` as the default payment link in Paddle; Paddle's own links (payment-method update, also in its emails) arrive there with `_ptxn` and work signed out; API-created transactions get no abandoned-checkout emails. `/pay` refuses a session already settled, overtaken by a newer subscription, or blocked by an overdue order (`isPayable`), on both the `session` and the `_ptxn` path (`_ptxn` is looked up by `provider_checkout_id`, unique per provider since migration `0024_checkout_provider_ref`; a transaction that is not one of our checkouts opens as is). The overlay locks the email (`allowLogout: false`) and hides the discount and tax-number fields: either could lower the total on our VAT-inclusive price below the amount check (the tax-number effect is undocumented; verify in sandbox before re-enabling it). A fully Paddle-hosted page needs separate approval on live.
- **Webhooks** (`/api/billing/webhooks/paddle`): `Paddle-Signature` HMAC over `ts:rawBody`, several `h1` during rotation, 5-minute window. `transaction.completed` from our checkout (`api`; a browser-built `web` one carries client-written custom data and is ignored) or a renewal (`subscription_recurring`) → `payment.succeeded` for `totals.total`; only the checkout charge carries the session (renewals copy it from the subscription and must not reuse it). `subscription.*` → `subscription.snapshot`, plan read from the price's `custom_data.agentforall_plan` (so retired prices keep resolving), then `PADDLE_PRICE_IDS`; a `past_due` subscription's paid access ends at the start of its unpaid period. Approved `refund` / `chargeback` / `chargeback_warning` adjustments → `payment.refunded`. Everything else, payment-method changes included, is `ignored`. Delivery order is not guaranteed; the service converges either way.
- **Manage:** cancel = `effective_from: next_billing_period`, resume = clear `scheduled_change`, portal session per customer, payment-method update transaction. Paddle refuses any change to a `past_due` subscription, so cancel (and account deletion) answer `payment_overdue` until the customer pays.
- **CSP:** `cdn.paddle.com` (script, style, frame), `sandbox-cdn.paddle.com` (style, frame), `buy.paddle.com` / `sandbox-buy.paddle.com` (frame), `*.paddle.com` (connect). Paddle's retention script (`public.profitwell.com`) stays blocked.
- **Dashboard, per environment:** default payment link `https://<app>/pay`; notification destination on API version 1, `traffic_source: platform`, events `transaction.completed`, `subscription.*`, `adjustment.*`; no discount codes, no plan-switch/discount/pause offers in cancellation flows, monthly-to-yearly auto-upgrade off (each changes the amount or plan behind our checks); end of dunning = cancel. API keys expire (90 days by default).

## Local development

```
PAYMENT_PROVIDER=mock
MOCK_PAYMENT_WEBHOOK_SECRET=<openssl rand -hex 32>
BILLING_REQUIRED=true
```

Apply migration `0010_billing`, then Settings → "הצטרפות למנוי" → mock page → "תשלום מוצלח". The mock signs a `checkout.completed` callback and pushes it through `BillingService.handleWebhook`, exactly the path a real gateway takes.

## Tests

`apps/web/test/billing/` — service (checkout, first payment, renewals, out-of-order and stale charges, redelivery, abandoned and poison events, failure/retry, amount and plan validation, top-ups, cancel/resume/plan change, second standing orders, trial claims, bot-delete settlement, account deletion), credits (attribution, races, restarts, expiry, users with no credits, cron), allocation, entitlement, pricing conversions, schemas, mock adapter + HMAC, registry, trial-claim keys; `paddle.test.ts` — the Paddle adapter; `test/auth/` — cron authorization, account deletion. Run with `npm run -w @agent-forall/web test`; the `*.db.test.ts` suites with `TEST_DATABASE_URL` via `test:db`. The Drizzle repositories have a Postgres integration test in `apps/web/test-integration/`:

```
docker run -d --name af-billing-it -e POSTGRES_PASSWORD=it -e POSTGRES_DB=billing_it -p 55432:5432 postgres:16-alpine
DATABASE_URL=postgresql://postgres:it@localhost:55432/billing_it npm run -w @agent-forall/db db:migrate
BILLING_TEST_DATABASE_URL=postgresql://postgres:it@localhost:55432/billing_it npm run -w @agent-forall/web test:integration
```

## Not yet built

- Tax invoices (חשבונית מס) — required with an Israeli gateway; hook on `billing_payments`.
- Admin view of subscriptions.
- A reconciliation job against the provider's list endpoints (Paddle recommends one); events past `MAX_EVENT_ATTEMPTS` are only visible as `failed` rows.
- `chargeback_reverse` / `chargeback_warning_reverse` (a won dispute) are ignored; the revoked credits are granted back by hand from `/admin`. Partial refunds revoke nothing and there is no admin revoke (the refund policy has no partial refunds).
- Account deletion does not cancel the user's still-open provider checkouts; one paid later (overlay left open over an hour) belongs to no one and must be cancelled by hand in the Paddle dashboard (its events fail `unresolved_user`).
- Dunning emails on `past_due`; a "credits exhausted" reply from the bot instead of silence.
- Trial containers are not auto-destroyed when the trial lapses (VM capacity).
- Ceiling policy for a user with several bots: each bot is capped at `spend + all available credits`, so N bots could spend N× between syncs. Moot while `maxInstancesPerUser=1`; split the balance before raising that.
