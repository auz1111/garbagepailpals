# Phase 12 Delivered

## Scope completed

- Added an admin incident feed endpoint for faster operational triage.
- Aggregated incidents from failed service jobs, failed notification deliveries, and stale unprocessed webhook events.
- Added shared API contracts and web client integration for incident feed retrieval.
- Added admin dashboard incident panel rendering recent incidents with severity, source, details, and timestamps.
- Added unit tests for incident feed composition and ordering.

## New API route

- `GET /api/admin/ops/incidents`

### Access

- Requires `ADMIN` role.

### Incident sources

- `JOB` incidents:
  - `ServiceJob` records with status `FAILED` over the last 7 days.
  - Severity: `CRITICAL`.
- `NOTIFICATION` incidents:
  - `AuditLog` actions `notification.reminder.failed` and `notification.overdue.failed` over the last 7 days.
  - Severity: `WARN`.
- `WEBHOOK` incidents:
  - `WebhookEvent` records older than 15 minutes that remain unprocessed (`processedAt = null`) within last 7 days.
  - Severity: `WARN`.

### Response shape

- `generatedAt`
- `incidents[]` with:
  - `id`
  - `source` (`JOB` | `NOTIFICATION` | `WEBHOOK`)
  - `severity` (`WARN` | `CRITICAL`)
  - `title`
  - `detail`
  - `occurredAt`
  - `entityType`
  - `entityId`

## Files added

- `apps/api/src/services/incidents.ts`
- `apps/api/src/services/incidents.test.ts`
- `docs/phase-12.md`

## Files updated

- `apps/api/src/routes/adminOps.ts`
- `apps/api/src/index.ts`
- `packages/shared/src/index.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/AdminWorkspace.tsx`

## Validation

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.
