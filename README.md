# Garbage Pail Pals

Phase 1 scaffold for a pnpm + Turborepo monorepo with React web app, Azure Functions API, shared contracts, and Prisma database package.

## Workspace

- apps/web: React + Vite client
- apps/api: Azure Functions (Node 20, TypeScript)
- packages/shared: Shared Zod schemas and types
- packages/db: Prisma schema, client, seed
- infra: Bicep templates (to be implemented in Phase 2)

## Prerequisites

- Node.js 20+
- Corepack enabled (`corepack enable`)
- Azure-hosted PostgreSQL connection string in `.env`

## Quick start

1. `corepack pnpm install`
2. Copy `.env.example` to `.env` and fill values.
3. `corepack pnpm --filter @gpp/db prisma migrate dev --name init`
4. `corepack pnpm --filter @gpp/db seed`
5. `corepack pnpm dev`

## Notes

- Docker is optional and not required in this setup.
- Authentication currently uses local email/password with JWT access and refresh tokens.

## Deployment & configuration

Pushing to `main` triggers `.github/workflows/deploy.yml`, which deploys **to production**: infra (Bicep), the API (`func-gpp-prod`), and the web SPA (`swa-gpp-prod`). A push to `main` is a prod deploy — branch and open a PR for anything you don't want live.

### App settings are owned by Bicep

The Function App's application settings are declared authoritatively in `infra/modules/functionapp.bicep`, so **every infra deploy replaces the entire app-settings collection**. Any setting added by hand (`az functionapp config appsettings set ...`) will be **wiped on the next deploy**.

To add or change a runtime setting durably, it must flow through Bicep:

1. Add a GitHub Actions **repo secret**, e.g. `ORS_API_KEY_PROD`, `PAYPAL_CLIENT_ID_PROD`, `JWT_ACCESS_SECRET_PROD` (and `_DEV` equivalents).
2. It's read in `infra/prod.bicepparam` (or `dev.bicepparam`) via `readEnvironmentVariable(...)` into an `@secure()` param.
3. `deploy.yml`'s "Deploy Bicep" step maps the GitHub secret into the environment.
4. `infra/modules/functionapp.bicep` emits it into `configAppSettings`.

Non-secret behaviour flags (`PAYPAL_ENV`, `DEV_FAKE_ENTITLEMENT`) are set as plain values directly in the `*.bicepparam` files. An unset secret falls back to `''` and is simply omitted (the API then uses its own default from `apps/api/src/lib/env.ts`).

Prod runs with `cheapMode = true`, which **skips the Key Vault and managed-identity modules**, so secrets are passed as secure params → app settings (same pattern as the DB password) rather than via Key Vault references.

### Database migrations are NOT automated

The deploy pipeline builds and ships the API bundle but **does not run migrations**. After adding a Prisma migration, apply it to prod manually before/with the deploy:

```bash
# from repo root — local.settings.json points DATABASE_URL/DIRECT_URL at psql-gpp-prod
export DATABASE_URL=... DIRECT_URL=...
cd packages/db && npx prisma migrate deploy
```

Shipping code that expects tables from an unapplied migration will break prod.
