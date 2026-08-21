# CLAUDE.md — agent-forall

Personal-AI-agent platform. Monorepo:
- `apps/orchestrator` — Fastify/TS service that owns container lifecycle and pairing
- `apps/web` — Next.js landing + dashboard
- `apps/whatsapp-pairing` — Baileys sidecar
- `packages/db` — Drizzle schema + Postgres client

## Commands
Run from repo root.
- `npm run -w @agent-forall/orchestrator dev` — orchestrator hot reload
- `npm run -w @agent-forall/orchestrator build` / `typecheck`
- `npm run -w @agent-forall/web dev` — Next.js dev server
- `npm run -w @agent-forall/web build` / `typecheck`
- `npm run -w @agent-forall/db generate` — Drizzle migration from schema diff

`DATABASE_URL` is required everywhere. See `apps/*/.env.example`.

## Architecture rules — IMPORTANT

Three layers, one job each. **No exceptions.**

1. **Route handler / controller** — HTTP only. Parse with Zod → call a service → respond.
   MUST NOT contain business logic, Drizzle calls, or external API calls.
2. **Service** — business logic. Coordinates repositories, applies rules, dispatches events.
   MUST NOT import Drizzle.
3. **Repository** — the only place Drizzle/SQL lives. Returns plain domain objects, never raw row types.
   Lives in `apps/orchestrator/src/storage/` and `apps/web/src/lib/<domain>/repository.ts`.

Reference implementations to mirror:
- Orchestrator: `routes/instances.ts` → `services/instance-manager.ts` → `storage/instance-repository.ts`
- Web: `app/api/leads/route.ts` → `lib/leads/service.ts` → `lib/leads/repository.ts`

## Code style — MUST

- TS strict mode is ON in every package. Never use `any`; use `unknown` and narrow.
- ESM only (`import`/`export`). Never `require` or `module.exports`.
- Named exports only. No `export default` in backend code.
- Async functions handle errors via try/catch or a Result. Never swallow exceptions silently.
  Empty `catch {}` is allowed only for documented sentinel patterns (health probes, best-effort cleanup) with a one-line comment explaining why.
- **Comments: short or none.** Code should be self-explanatory. Only write a comment when the WHY is non-obvious (hidden constraint, subtle invariant, workaround). One line max — no multi-line JSDoc preambles, no "explains what the code does" comments, no SQL file banners. Applies to `.ts`, `.tsx`, `.sql`, everywhere.

## Validation & errors — MUST

- Zod schemas at every API boundary. Never trust `request.json()`, `req.body`, or `searchParams` without `.parse` / `.safeParse`.
- Orchestrator: throw a `DomainError` subclass from `domain/errors.ts`; the Fastify error middleware emits the standard `{ code, message, details? }` shape.
- Next.js: use `errorJson(code, status, details?)` from `lib/auth/api.ts`. Authenticated routes go through `authenticatedHandler`.
- External calls (`fetch`, third-party SDKs) wrapped in try/catch. For idempotent calls, retry transient 429/503 with exponential backoff — see `lib/meta-capi/client.ts` for the pattern.

## Database — MUST

- All Drizzle queries live in a repository. No Drizzle imports in `services/`, `routes/`, or `app/api/**`.
- No raw SQL outside migrations. Drizzle's `sql\`` builder is fine; bare `db.execute("<string>")` is not.
- Schema changes: edit `packages/db/src/schema/*.ts`, run `npm run -w @agent-forall/db generate`. Never edit a generated migration after it's been applied to a deployed env.
- Web uses the singleton `getDb()` from `apps/web/src/lib/db.ts`. Never instantiate a fresh `Pool` in a route or repository.

## Secrets & PII

- Never log raw request bodies — they contain PII (emails, phones).
- WhatsApp creds and gateway tokens are encrypted at rest via `services/crypto.ts`. The repository encrypts/decrypts; callers see plaintext domain objects only.
- IP attribution: rightmost X-Forwarded-For value (Vercel pattern). Leftmost is client-spoofable. See `lib/http/client-ip.ts`.

## Workflow

- After changes: run the relevant `typecheck` script before reporting work complete.
- Don't commit or push without explicit authorization in the current turn — prior approvals don't carry forward.
- Reels, design assets, and ad copy: don't change without asking.
