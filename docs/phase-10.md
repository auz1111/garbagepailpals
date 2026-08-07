# Phase 10 Delivered

## Scope completed

- Added auth endpoint abuse protection through in-memory rate limiting.
- Applied per-endpoint throttles for register, login, and refresh token flows.
- Added `429` responses with `Retry-After` headers for temporary blocks.
- Added test coverage for limiter behavior and client IP extraction.

## Auth hardening behavior

- Endpoints protected:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/refresh`
- Rate-limit key format: `<scope>:<client-ip>`.
- Client IP resolution order:
  - `x-forwarded-for` first value
  - `x-real-ip`
  - fallback `unknown`
- When over limit:
  - Returns HTTP `429` with payload message and `retryAfterSeconds`.
  - Sets HTTP `Retry-After` response header.

## New configuration

- `AUTH_RATE_LIMIT_WINDOW_MS` (default `60000`)
- `AUTH_RATE_LIMIT_LOGIN_MAX_ATTEMPTS` (default `10`)
- `AUTH_RATE_LIMIT_REGISTER_MAX_ATTEMPTS` (default `20`)
- `AUTH_RATE_LIMIT_REFRESH_MAX_ATTEMPTS` (default `40`)

## Files added

- `apps/api/src/lib/rateLimiter.ts`
- `apps/api/src/lib/rateLimiter.test.ts`
- `docs/phase-10.md`

## Files updated

- `.env.example`
- `apps/api/local.settings.example.json`
- `apps/api/src/lib/env.ts`
- `apps/api/src/routes/auth.ts`

## Validation

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.
