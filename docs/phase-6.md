# Phase 6 Delivered

## Scope completed

- Customer web experience upgraded from shell to functional dashboard.
- Billing UI wired to Stripe checkout, PayPal subscription approval, and Stripe customer portal.
- Customer domain workflows wired to API: service-area checks, addresses, schedules, upcoming jobs, and history jobs.
- Entitlement-aware UX added: when API returns HTTP 402, the app now guides users to complete billing first.
- Frontend API client expanded with typed wrappers for domain and payment endpoints.

## Web app changes

- New customer workspace component with:
  - Billing action buttons
  - Service-area postal code checker
  - Address creation form
  - Schedule upsert form per selected address
  - Upcoming and historical job summaries
  - Address listing
- Added status-aware API error handling in client (`ApiError`) to support entitlement gating UX.
- Added responsive panel-based layout styles for desktop and mobile.

## Files added

- `apps/web/src/components/CustomerWorkspace.tsx`
- `docs/phase-6.md`

## Files updated

- `apps/web/src/App.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/styles.css`

## Validation

- `pnpm typecheck` passed.
- `pnpm test` passed.
- `pnpm build` passed.
