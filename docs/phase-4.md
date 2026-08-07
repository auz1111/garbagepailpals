# Phase 4 Delivered

## Scope completed

- Core domain APIs for service-area checks, addresses, schedules, holds, and job views.
- Scheduling engine with holiday shift, cadence logic, hold suppression, timezone-aware execution windows, and idempotent job upserts.
- Nightly scheduler and reminder timer triggers.
- Dev entitlement bypass flag to keep payments out of scope in this phase.
- Unit tests for scheduling behavior.

## New API routes

- `GET /api/service-areas/check?postalCode=...`
- `POST /api/addresses`
- `GET /api/addresses`
- `PATCH /api/addresses/{addressId}`
- `PUT /api/addresses/{addressId}/schedule`
- `POST /api/addresses/{addressId}/holds`
- `GET /api/addresses/{addressId}/holds`
- `GET /api/jobs/upcoming`
- `GET /api/jobs/history`

## Scheduler behavior

- Looks ahead `SCHEDULER_LOOKAHEAD_DAYS` (default 14).
- Uses per-address timezone and only processes addresses during local 02:00 hour.
- Applies holiday shift days from `HolidayCalendar` before day-of-week matching.
- Supports weekly and biweekly cadence with anchor date checks.
- Suppresses service generation when service holds cover a date.
- Enforces idempotency via unique job key and Prisma upsert.

## Timer triggers

- `nightly-job-generation` (hourly cadence, local-time-gated in logic)
- `reminder-sweep` (hourly at minute 30, placeholder counters for reminders/alerts)

## Dev entitlement flag

- `DEV_FAKE_ENTITLEMENT=true` allows protected customer-domain flows before payment integration.
- If set to `false`, the API requires an active entitlement record.

## Validation

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.
