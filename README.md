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
