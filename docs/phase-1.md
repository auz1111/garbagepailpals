# Phase 1 Delivered

## Scope completed

- pnpm workspaces + Turborepo monorepo foundation.
- React 18 + Vite + TypeScript web app scaffold.
- Azure Functions v4 + TypeScript API scaffold.
- Shared package for Zod schemas and shared auth types.
- Prisma schema covering core domain models + seed script.
- Initial SQL migration artifact generated from schema.
- Baseline email/password auth with JWT access + refresh tokens.
- Unit test baseline with Vitest.

## How to run locally

1. Copy root `.env.example` to `.env` and fill Azure Postgres values.
2. Run `pnpm install`.
3. Generate client: `pnpm --filter @gpp/db generate`.
4. Apply migration to Azure-hosted Postgres:
   - `pnpm --filter @gpp/db prisma migrate deploy`
5. Seed sample data:
   - `pnpm --filter @gpp/db seed`
6. Start web and API in separate terminals:
   - `pnpm --filter @gpp/web dev`
   - `pnpm --filter @gpp/api dev`

## Notes

- Docker is intentionally not required.
- `func` (Azure Functions Core Tools) must be installed locally to run the API host command.
- Infrastructure and CI/CD are deferred to Phase 2.
