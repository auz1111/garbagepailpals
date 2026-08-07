# Phase 8 Delivered

## Scope completed

- Replaced reminder placeholder counters with real notification delivery flow.
- Added notification provider abstraction with `mock` (default) and `resend` support.
- Implemented reminder and overdue alert fan-out with cooldown-based dedupe.
- Added audit-log tracking for notification sent/failed events.
- Added unit tests for cooldown behavior.

## Notification behavior

- Upcoming reminders:
  - Scans `SCHEDULED` jobs in the next 24 hours.
  - Sends customer reminder email.
  - Applies 12-hour cooldown per job to prevent duplicate sends.
- Overdue alerts:
  - Scans `SCHEDULED` jobs older than now.
  - Sends customer alert email and optional escalation copy.
  - Applies 24-hour cooldown per job.
- For both paths:
  - Writes audit logs on sent and failed attempts.
  - Includes provider, message ID, and failure metadata where available.

## Configuration added

- `NOTIFICATION_PROVIDER` (`mock` or `resend`)
- `NOTIFICATION_FROM_EMAIL`
- `NOTIFICATION_ESCALATION_EMAIL` (optional)
- `RESEND_API_KEY` (required only for `resend` provider)

## Files added

- `apps/api/src/services/notifications.ts`
- `apps/api/src/services/notifications.test.ts`
- `docs/phase-8.md`

## Files updated

- `apps/api/src/services/reminders.ts`
- `apps/api/src/lib/env.ts`
- `apps/api/local.settings.example.json`
- `.env.example`

## Validation

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.
