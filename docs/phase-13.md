# Phase 13 Delivered

## Scope completed

- Added incident acknowledgement workflow for admin operations.
- Extended incident feed entries with acknowledgement metadata.
- Added admin API endpoint to acknowledge incidents with optional note.
- Wired admin dashboard to acknowledge incidents and refresh feed state.
- Added test coverage for acknowledgement mapping in incident feed composition.

## New API route

- `POST /api/admin/ops/incidents/{incidentId}/acknowledge`

### Access

- Requires `ADMIN` role.

### Request body

- Optional:
  - `note` (string, max 400)

### Response

- `incidentId`
- `acknowledged` (always `true`)
- `acknowledgedAt`
- `acknowledgedByUserId`

## Incident feed enhancements

- `GET /api/admin/ops/incidents` now includes:
  - `acknowledgedAt` (nullable)
  - `acknowledgedByUserId` (nullable)
- Acknowledgements are sourced from `AuditLog` entries:
  - `action = incident.acknowledged`
  - `entityType = AdminIncident`
- Most recent acknowledgement per incident ID is applied.

## Admin UI updates

- Incident cards now display acknowledgement status.
- Unacknowledged incidents show an `Acknowledge` action button.
- Acknowledging an incident invalidates and refreshes the incident feed.

## Files updated

- `apps/api/src/routes/adminOps.ts`
- `apps/api/src/index.ts`
- `apps/api/src/services/incidents.ts`
- `apps/api/src/services/incidents.test.ts`
- `packages/shared/src/index.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/components/AdminWorkspace.tsx`
- `docs/phase-13.md`

## Validation

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.
