# Solana Memecoin Intelligence

Solana Memecoin Intelligence is a live market analysis and monitoring dashboard for discovering token momentum, reviewing contract risk, saving watchlist items, and configuring alerts.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/solana-intel` — responsive React/Vite dashboard and routes
- `artifacts/api-server/src/routes/monitoring.ts` — market, token, watchlist, and alert endpoints
- `artifacts/api-server/src/lib/market.ts` — market ingestion, risk scoring, chain enrichment, and analysis
- `lib/api-spec/openapi.yaml` — source of truth for API contracts
- `lib/db/src/schema/monitoring.ts` — persisted watchlist and alert tables

## Architecture decisions

- Live market data is cached briefly in the API process to keep the dashboard responsive while avoiding repeated upstream calls during navigation.
- Chain and model enrichment are optional server-side capabilities; the deterministic risk engine remains available when those credentials are not configured.
- Watchlist and alert rules are persisted in PostgreSQL so they survive reloads and server restarts.
- The UI uses generated OpenAPI hooks instead of hand-written fetch contracts.

## Product

- Market overview with tracked volume, new-pair flow, risk alerts, active wallet activity, and a recent event stream
- Searchable token scanner with momentum, volume, liquidity, sparkline, and contract-risk signals
- Token detail pages with explainable analysis and signal-level breakdowns
- Persistent watchlist and alert-rule management

## User preferences

- Keep the platform focused on Solana memecoin analysis and monitoring.
- Do not expose underlying data-provider details in user-facing product copy.

## Gotchas

- Vite builds require `PORT` and `BASE_PATH` in the environment; managed workflows provide them automatically.
- Run API codegen after changing `lib/api-spec/openapi.yaml`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
