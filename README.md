# agent-forall

Hebrew-first Israeli SaaS that gives each paying user (₪199/mo) their own private AI agent connected to their personal WhatsApp via Baileys.

## Architecture

Three things, in three places:

```
┌─────────────────┐         ┌─────────────────────────┐         ┌──────────────────┐
│  Vercel         │         │  Google Cloud VM        │         │  Supabase        │
│  Next.js        │ ──API──►│  Caddy + orchestrator   │────────►│  Postgres        │
│  landing + app  │         │  + per-tenant OpenClaw  │         │                  │
└─────────────────┘         └─────────────────────────┘         └──────────────────┘
```

- **`apps/web`** — Next.js landing + Better Auth dashboard (deployed on Vercel)
- **`apps/orchestrator`** — Fastify service that owns container lifecycle and pairing (deployed on the GCP VM)
- **`apps/whatsapp-pairing`** — Baileys sidecar, ephemeral, one per pairing flow
- **`packages/db`** — Drizzle schema + Postgres client, shared between web and orchestrator

## Project rules

- **`CLAUDE.md`** — code style, three-layer architecture, secrets/PII handling, validation rules. Read before contributing.
- **`SESSION_SUMMARY.md`** — session 5 product/architecture rationale (auth choice, hosting choice, WhatsApp ban-risk handling).
- **`DEPLOY_HANDOFF.md`** — current state of the production rollout, exact next steps, open issues. Single source of truth for "what's done, what's left."
- **`docs/security-todo.md`** — S-1..S-12, post-launch hardening backlog.

## Local dev

```bash
# Install deps (npm workspaces; one install at the root)
npm install

# Web — Next.js dev server with Turbopack
npm run -w @agent-forall/web dev

# Orchestrator — Fastify with hot reload
npm run -w @agent-forall/orchestrator dev

# DB — generate migration from schema diff
npm run -w @agent-forall/db generate

# DB — apply migrations to whatever DATABASE_URL points at
npm run -w @agent-forall/db migrate

# Typecheck everything
npm run -w @agent-forall/orchestrator typecheck
npm run -w @agent-forall/web typecheck

# Run focused regression tests
npm run test
```

`DATABASE_URL` is required everywhere. Each app has its own `.env.example` showing required vars.

## Production

Single GCP VM in `europe-west4` (Netherlands). Provisioned via Terraform (`infra/`). Images live in GAR. CI builds via GitHub Actions (Workload Identity Federation, no JSON keys). Secrets in Google Secret Manager (operator-created out-of-band; Terraform references via `data` source — never owns values).

Production deploys must use immutable image refs:

- Orchestrator: GAR digest or git-SHA tag, configured by `infra/variables.tf`.
- New bot creation currently defaults to OpenClaw: `AGENT_RUNTIME_KIND=openclaw`.
- OpenClaw: custom GAR image pinned to `europe-west4-docker.pkg.dev/agent-for-all/agent-forall/openclaw-browser@sha256:13f281ec9c8452b1f50d554edd1d2f6879195ecc956a463c99f01a79303a71bc` (`OpenClaw 2026.5.27`, WhatsApp plugin + Playwright Chromium prewarmed).
- Hermes: pinned smoke-tested digest, currently `nousresearch/hermes-agent@sha256:b6e41c155d6bfce5ad83c5d0fec670086db8a43250e4511c9474134be5482d33`.
- Do not set production runtime images to `:latest` or `:main`.
- Hermes containers follow the official Hermes Docker security contract; the generic tenant `CapDrop=ALL` / `no-new-privileges` profile is not applied to Hermes because it breaks `s6` supervision in newer images.
- Hermes gateway platform enablement is written to both Docker env and `config.yaml`; secrets stay in `.env`.
- Hermes WhatsApp defaults are consumer-facing: no approval prompts, no technical tool-progress messages, no compression/progress lifecycle notices, queued follow-up messages, no long-task heartbeat spam, and no runtime footer.
- TODO: evaluate whether to add a minimal consumer `SOUL.md`; the default Hermes `SOUL.md` is kept for now.
- Do not promote Hermes digest `7a47d19ed1d4fa98f178756fd33772c914d9853e414e8366c268773f55517944`; it failed the API-server smoke test on 2026-05-26.
- The VM housekeeping job prunes unused images/build cache only. It must not prune Docker volumes.

See `DEPLOY_HANDOFF.md` for the exact rollout steps.

## Repo layout

```
apps/
  web/                     # Next.js (Vercel)
  orchestrator/            # Fastify (VM)
  whatsapp-pairing/        # Baileys sidecar (per-pairing, ephemeral)
packages/
  db/                      # Drizzle schema + client
infra/
  main.tf                  # GCP VM, GAR, WIF, IAM, snapshots
  startup.sh               # VM bootstrap (idempotent, runs every boot)
  variables.tf
  outputs.tf
  terraform.tfvars         # gitignored, real values
  images/openclaw-browser/ # custom OpenClaw image with Chromium baked in
.github/workflows/
  build-and-push.yml       # auto-builds orchestrator + sidecar to GAR on push to main
docs/
  security-todo.md         # S-1..S-12 hardening backlog
```
