# Phase 14 Delivered

## Scope completed

- Upgraded incident operations from acknowledge-only to full lifecycle management.
- Added lifecycle states and transitions: `OPEN`, `ACKNOWLEDGED`, and `RESOLVED`.
- Added incident ownership assignment and persisted lifecycle events in `AuditLog`.
- Added SLA aging fields and breach flags to incident feed records.
- Added incident feed filtering by state, source, severity, and owner.
- Upgraded admin dashboard with incident lifecycle controls and triage counters.

## New lifecycle action routes

- `POST /api/admin/ops/incidents/{incidentId}/acknowledge`
- `POST /api/admin/ops/incidents/{incidentId}/assign`
- `POST /api/admin/ops/incidents/{incidentId}/resolve`
- `POST /api/admin/ops/incidents/{incidentId}/reopen`

### Access

- All routes require `ADMIN` role.

### Persistence model

- Lifecycle events are stored in `AuditLog` with:
  - `entityType = AdminIncident`
  - actions:
    - `incident.acknowledged`
    - `incident.assigned`
    - `incident.resolved`
    - `incident.reopened`

## Incident feed enhancements

- `GET /api/admin/ops/incidents` now supports filters:
  - `state`
  - `source`
  - `severity`
  - `ownerUserId`
- Feed now returns lifecycle and triage fields per incident:
  - `state`
  - `stateUpdatedAt`
  - `ownerUserId`
  - `openMinutes`
  - `breachedSla`
  - `acknowledgedAt` / `acknowledgedByUserId`
  - `resolvedAt` / `resolvedByUserId`

## SLA behavior

- SLA thresholds are computed from `occurredAt`:
  - `CRITICAL`: breach at 5+ open minutes
  - `WARN`: breach at 15+ open minutes
- Resolved incidents are not marked as breached.

## Admin UI updates

- Added lifecycle-aware incident board controls:
  - Acknowledge
  - Assign to me
  - Resolve
  - Reopen
- Added triage counters:
  - Open
  - Acknowledged
  - Resolved
  - Breached SLA
- Added feed filters:
  - State
  - Source
  - Severity
  - Owner (All/Mine/Unassigned)
- Prioritized incident ordering in UI:
  - Open before acknowledged before resolved
  - Critical before warn
  - Newest first within each priority band

## Files updated

- `packages/shared/src/index.ts`
- `apps/api/src/services/incidents.ts`
- `apps/api/src/services/incidents.test.ts`
- `apps/api/src/routes/adminOps.ts`
- `apps/api/src/index.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/AdminWorkspace.tsx`
- `docs/phase-14.md`

## Validation

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.
