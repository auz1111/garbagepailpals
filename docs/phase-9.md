# Phase 9 Delivered

## Scope completed

- Hardened outbound notification delivery with retry/backoff controls for transient provider failures.
- Expanded admin dashboard metrics to include notification send/failure health over the last 24 hours.
- Extended audit metadata to capture notification delivery attempt count.
- Added unit tests for retry policy behavior and backoff timing.

## Retry and backoff behavior

- Retry logic applies when `NOTIFICATION_PROVIDER=resend`.
- Transient HTTP statuses are retried: `408`, `425`, `429`, and `5xx`.
- Non-transient client errors (for example `400`/`401`/`422`) fail fast.
- Backoff is exponential:
  - Attempt 1 delay: `baseDelayMs`
  - Attempt 2 delay: `2 * baseDelayMs`
  - Attempt 3 delay: `4 * baseDelayMs`
- Attempt count is included in successful delivery metadata.

## New configuration

- `NOTIFICATION_MAX_RETRIES` (default `2`, min `0`, max `5`)
- `NOTIFICATION_RETRY_BASE_DELAY_MS` (default `300`, min `50`, max `5000`)

## Admin metrics expansion

- Added notification metrics to `GET /api/admin/dashboard`:
  - `remindersSentLast24h`
  - `remindersFailedLast24h`
  - `overdueSentLast24h`
  - `overdueFailedLast24h`
- Metrics are sourced from `AuditLog` actions created by reminder sweeps.
- Admin web dashboard now renders a dedicated "Notifications (24h)" panel.

## Files updated

- `.env.example`
- `apps/api/local.settings.example.json`
- `apps/api/src/lib/env.ts`
- `apps/api/src/services/notifications.ts`
- `apps/api/src/services/reminders.ts`
- `apps/api/src/routes/adminDashboard.ts`
- `apps/api/src/services/notifications.test.ts`
- `packages/shared/src/index.ts`
- `apps/web/src/components/AdminWorkspace.tsx`

## Validation

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.
